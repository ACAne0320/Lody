import { LoroMap } from 'loro-crdt';
import { updateTestHistory } from './history-port-fixture';
import { describe, expect, it, vi } from 'vitest';
import { Effect, SubscriptionRef } from 'effect';
import type { RoomStatus } from 'loro-repo/effect';

import { WorkspaceRepoLegacy } from '@lody/shared/workspace-data/repo-legacy';
import { v4 as uuidv4 } from 'uuid';
import { FileSystemStorageAdaptor } from 'loro-repo/storage/filesystem';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SessionDocument } from '../src/lib/loro/doc';
import type { MessageContent, SessionHistoryInput, SessionId } from '@lody/shared';

const createUserEntry = (id: string, text: string): SessionHistoryInput => ({
  id,
  role: 'user',
  items: [{ type: 'text', text }] satisfies MessageContent[],
  timestamp: new Date().toISOString(),
  status: 'pending',
  read: false,
  userId: undefined,
});

describe('SessionDocument auto read', () => {
  it('rejects an explicit room rejoin without a route instead of parking readiness', async () => {
    const repo = await WorkspaceRepoLegacy.create({});
    const session = new SessionDocument(repo, uuidv4() as SessionId, async () => {});
    try {
      await session.initOffline({ history: [] });
      session.docSub = await repo.joinDocRoom(session.roomId);
      await expect(session.rejoinDocRoom()).rejects.toMatchObject({ _tag: 'RepoUnsupported' });
    } finally {
      await session.destroy({ preserveStatus: true });
      await repo.destroy();
    }
  });
  it.each(['reconnect', 'readiness'] as const)(
    'retires its own room during %s while another borrower survives',
    async (phase) => {
      const repo = await WorkspaceRepoLegacy.create({});
      const session = new SessionDocument(repo, uuidv4() as SessionId, async () => {});
      const entered = Promise.withResolvers<void>();
      const reconnect = Promise.withResolvers<void>();
      await session.initOffline({ history: [] });
      await repo.addTransport('streams', {
        kind: 'native-workspace-transport',
        make: (id) =>
          Effect.succeed({
            id,
            authority: 'server',
            connect: Effect.void,
            disconnect: Effect.void,
            join: () =>
              Effect.gen(function* () {
                return {
                  status: yield* SubscriptionRef.make<RoomStatus>('joining'),
                  close: Effect.void,
                  sync: Effect.succeed('confirmed' as const),
                };
              }),
          }),
      });
      const room = await repo.joinDocRoom(session.roomId);
      const other = await repo.joinDocRoom(session.roomId);
      session.docSub = room;
      vi.spyOn(repo, 'reconnect').mockImplementation(async () => {
        if (phase === 'reconnect') {
          entered.resolve();
          await reconnect.promise;
        }
        return { ok: true, rooms: [], failed: [] };
      });
      if (phase === 'readiness') {
        const awaitSynced = room.native.awaitSynced;
        vi.spyOn(room.native, 'awaitSynced').mockImplementation((id) =>
          Effect.gen(function* () {
            entered.resolve();
            yield* awaitSynced(id);
          })
        );
      }
      const rejoining = session.rejoinDocRoom();
      const settled = rejoining.then(
        () => undefined,
        (error: unknown) => error
      );
      try {
        await entered.promise;
        await session.destroy({ preserveStatus: true });
        reconnect.resolve();
        const result = await settled;
        if (phase === 'readiness') expect(result).toBeInstanceOf(Error);
        else expect(result).toBeUndefined();
        expect(session.isDestroyed).toBe(true);
        expect(session.docSub).toBeNull();
        expect(room.signal.aborted).toBe(true);
        expect(other.signal.aborted).toBe(false);
        expect(other.native.replica.kind).toBe('doc');
        if (other.native.replica.kind === 'doc') {
          other.native.replica.lease.doc.getText('survivor').insert(0, 'still writable');
          expect(other.native.replica.lease.doc.getText('survivor').toString()).toBe(
            'still writable'
          );
        }
      } finally {
        reconnect.resolve();
        other.unsubscribe();
        await session.destroy({ preserveStatus: true });
        await repo.destroy();
      }
    }
  );
  it.each(['destroy', 'reinitialize'] as const)(
    'invalidates its local room after a failed save and retries on %s',
    async (retry) => {
      const baseDir = await mkdtemp(join(tmpdir(), 'lody-session-close-'));
      const adapter = new FileSystemStorageAdaptor({ baseDir });
      const save = adapter.save.bind(adapter);
      let blocked = false;
      adapter.save = async (payload) => {
        if (blocked && (payload.type === 'doc-update' || payload.type === 'doc-snapshot'))
          throw new Error('synthetic session save failure');
        await save(payload);
      };
      const repo = await WorkspaceRepoLegacy.create({ storageAdapter: adapter });
      const boundRooms = new Set<string>();
      const session = new SessionDocument(repo, uuidv4() as SessionId, async (id) => {
        boundRooms.delete(id);
      });
      try {
        await session.initOffline({ history: [] });
        boundRooms.add(session.roomId);
        session.handle!.doc.getText('synthetic').insert(0, 'kept');
        session.handle!.doc.commit();
        blocked = true;
        await expect(session.destroy({ preserveStatus: true })).rejects.toThrow();
        expect(boundRooms.size).toBe(0);
        expect(session.isDestroyed).toBe(true);
        expect(session.handle).toBeNull();
        blocked = false;
        if (retry === 'reinitialize') {
          await session.initOffline();
          expect(session.handle?.doc.getText('synthetic').toString()).toBe('kept');
        }
        await session.destroy({ preserveStatus: true });
        const reopened = await repo.acquireDoc(session.roomId);
        expect(reopened.doc.getText('synthetic').toString()).toBe('kept');
        await reopened.release();
      } finally {
        blocked = false;
        await session.destroy({ preserveStatus: true });
        await repo.destroy();
        await rm(baseDir, { recursive: true, force: true });
      }
    }
  );

  it('acknowledges from shallow fields without reading assistant bodies on notifications', async () => {
    const repo = await WorkspaceRepoLegacy.create({});
    const session = new SessionDocument(repo, uuidv4() as SessionId);
    try {
      await session.initOffline({
        history: [
          createUserEntry('user', 'hello'),
          {
            id: 'assistant',
            role: 'assistant',
            timestamp: 'synthetic',
            items: [{ type: 'text', text: 'long body' }],
          },
        ],
      });
      const bodies: string[] = [];
      const original = LoroMap.prototype.toJSON;
      const spy = vi.spyOn(LoroMap.prototype, 'toJSON').mockImplementation(function () {
        const id = this.get('id');
        if (typeof id === 'string') bodies.push(id);
        return original.call(this);
      });
      try {
        const doc = session.handle!.doc;
        (doc.getList('history').get(1) as LoroMap).set('finished', true);
        doc.commit();
        expect(bodies).toEqual([]);
        expect(session.sessionData.history.readDirectory(0, 1)[0]?.scalars?.status).toBe('seen');
        expect(session.sessionData.history.readDirectory(1, 2)[0]?.scalars?.finished).toBe(true);
      } finally {
        spy.mockRestore();
      }
    } finally {
      await repo.destroy();
    }
  });

  it('marks latest user entry as read on history updates', async () => {
    const repo = await WorkspaceRepoLegacy.create({});
    try {
      const sessionId = uuidv4() as SessionId;
      const doc = new SessionDocument(repo, sessionId);
      await doc.initOffline({ history: [] });

      await updateTestHistory(doc, (history) => history.concat(createUserEntry('h1', 'hi')));
      // Auto-read is a background port command now: wait for the accepted write
      // instead of assuming a single microtask.
      await vi.waitFor(async () => {
        expect((await doc.sessionData.history.readAll())[0]!.status).toBe('seen');
      });

      const history = await doc.sessionData.history.readAll();
      expect(history).toHaveLength(1);
      expect(history[0]!.role).toBe('user');
      expect(history[0]!.status).toBe('seen');
      expect(history[0]!.read).toBe(true);
    } finally {
      await repo.destroy();
    }
  });

  it('only marks the latest user entry when multiple are unread', async () => {
    const repo = await WorkspaceRepoLegacy.create({});
    try {
      const sessionId = uuidv4() as SessionId;
      const doc = new SessionDocument(repo, sessionId);
      await doc.initOffline({ history: [] });

      await updateTestHistory(doc, (history) =>
        history.concat([createUserEntry('h1', 'first'), createUserEntry('h2', 'second')])
      );
      await vi.waitFor(async () => {
        const current = await doc.sessionData.history.readAll();
        expect(current.find((entry) => entry.id === 'h2')?.status).toBe('seen');
      });

      const history = await doc.sessionData.history.readAll();
      expect(history).toHaveLength(2);
      const first = history.find((entry) => entry.id === 'h1');
      const second = history.find((entry) => entry.id === 'h2');
      expect(first?.status).toBe('pending');
      expect(first?.read).not.toBe(true);
      expect(second?.status).toBe('seen');
      expect(second?.read).toBe(true);
    } finally {
      await repo.destroy();
    }
  });

  it('can mark the latest user entry as read for existing history', async () => {
    const repo = await WorkspaceRepoLegacy.create({});
    try {
      const sessionId = uuidv4() as SessionId;
      const doc = new SessionDocument(repo, sessionId);
      await doc.initOffline({ history: [] });
      await updateTestHistory(doc, () => [
        createUserEntry('h1', 'first'),
        createUserEntry('h2', 'second'),
      ]);
      await vi.waitFor(async () => {
        const current = await doc.sessionData.history.readAll();
        expect(current.find((entry) => entry.id === 'h2')?.status).toBe('seen');
      });

      const before = await doc.sessionData.history.readAll();
      expect(before).toHaveLength(2);
      const beforeFirst = before.find((entry) => entry.id === 'h1');
      const beforeSecond = before.find((entry) => entry.id === 'h2');
      expect(beforeFirst?.status).toBe('pending');
      expect(beforeFirst?.read).not.toBe(true);
      expect(beforeSecond?.status).toBe('seen');
      expect(beforeSecond?.read).toBe(true);

      await doc.markLatestUserHistoryAsSeenIfNeeded();

      const history = await doc.sessionData.history.readAll();
      expect(history).toHaveLength(2);
      const first = history.find((entry) => entry.id === 'h1');
      const second = history.find((entry) => entry.id === 'h2');
      expect(first?.status).toBe('pending');
      expect(first?.read).not.toBe(true);
      expect(second?.status).toBe('seen');
      expect(second?.read).toBe(true);
    } finally {
      await repo.destroy();
    }
  });

  it('does not pop the first queued message while it is being edited', async () => {
    const repo = await WorkspaceRepoLegacy.create({});
    try {
      const sessionId = uuidv4() as SessionId;
      const doc = new SessionDocument(repo, sessionId);
      await doc.initOffline({ history: [] });

      await doc.pushMessageQueue({
        task: 'queued draft',
        project: undefined,
        userId: 'user-1',
        timestamp: new Date().toISOString(),
        isEditing: true,
        editingStartedAt: Date.now(),
        acpSessionConfig: {
          prompt: 'queued draft',
          inputBlocks: [{ type: 'text', text: 'queued draft' }],
          cliType: 'builtin',
          agentType: 'codex',
        },
      });

      await expect(doc.popMessageQueue()).resolves.toBeNull();
      await expect(doc.getMessageQueue()).resolves.toEqual([
        expect.objectContaining({
          task: 'queued draft',
          isEditing: true,
        }),
      ]);
    } finally {
      await repo.destroy();
    }
  });

  it('pops a queued message whose editing lease has expired', async () => {
    const repo = await WorkspaceRepoLegacy.create({});
    try {
      const sessionId = uuidv4() as SessionId;
      const doc = new SessionDocument(repo, sessionId);
      await doc.initOffline({ history: [] });

      // editingStartedAt 10 minutes in the past — well past the 5-minute lease
      const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
      await doc.pushMessageQueue({
        task: 'stuck draft',
        project: undefined,
        userId: 'user-1',
        userTurnId: 'turn-stuck',
        timestamp: new Date().toISOString(),
        isEditing: true,
        editingStartedAt: tenMinutesAgo,
        acpSessionConfig: {
          prompt: 'stuck draft',
          inputBlocks: [{ type: 'text', text: 'stuck draft' }],
          cliType: 'builtin',
          agentType: 'codex',
        },
      });

      const popped = await doc.popMessageQueue();
      expect(popped?.task).toBe('stuck draft');
      expect(popped?.operationId).toBe('queue:turn-stuck');
      await expect(doc.getMessageQueue()).resolves.toEqual([]);
    } finally {
      await repo.destroy();
    }
  });

  it('treats a missing editingStartedAt as an expired lease (legacy item)', async () => {
    const repo = await WorkspaceRepoLegacy.create({});
    try {
      const sessionId = uuidv4() as SessionId;
      const doc = new SessionDocument(repo, sessionId);
      await doc.initOffline({ history: [] });

      await doc.pushMessageQueue({
        task: 'legacy draft',
        project: undefined,
        userId: 'user-1',
        timestamp: new Date().toISOString(),
        isEditing: true,
        acpSessionConfig: {
          prompt: 'legacy draft',
          inputBlocks: [{ type: 'text', text: 'legacy draft' }],
          cliType: 'builtin',
          agentType: 'codex',
        },
      });

      const popped = await doc.popMessageQueue();
      expect(popped?.task).toBe('legacy draft');
      await expect(doc.getMessageQueue()).resolves.toEqual([]);
    } finally {
      await repo.destroy();
    }
  });
});
