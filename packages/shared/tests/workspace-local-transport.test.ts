import { describe, expect, it } from 'vitest';
import { Effect, Layer, Stream } from 'effect';
import { LoroDoc } from 'loro-crdt';
import { make as makeWorkspaceRepo } from 'loro-repo/effect';
import { WorkspaceRepoLegacy } from '../src/workspace-data/repo-legacy';
import {
  makeLocalWorkspaceTransport,
  localWorkspaceTransport,
} from '../src/workspace-data/local-transport';
import {
  LocalLoroDataPlaneServerLegacy,
  type LocalLoroFlockLike,
} from '../src/local-loro-data-plane-server';
import { makeLocalLoroWriterLegacy } from '../src/local-loro-writer/legacy';
import { LocalLoroWriterTurn } from '../src/local-loro-writer';
import type {
  LocalLoroDataPlaneServerMessage,
  LocalLoroDataPlaneClientMessage,
} from '../src/local-loro-data-plane';

function wire(
  serverDoc: LoroDoc,
  options: {
    dropFirstUpdate?: boolean;
    maxPayloadBytes?: number;
    serverFlock?: LocalLoroFlockLike;
  } = {}
) {
  const writer = makeLocalLoroWriterLegacy(
    Layer.succeed(LocalLoroWriterTurn, { next: Effect.yieldNow })
  );
  const listeners = new Set<(message: LocalLoroDataPlaneServerMessage) => void>();
  const statuses = new Set<(online: boolean) => void>();
  const server = new LocalLoroDataPlaneServerLegacy({
    writerLegacy: writer,
    workspaceId: 'ws',
    maxPayloadBytes: options.maxPayloadBytes,
    resolveDoc: async () => serverDoc,
    resolveFlockDoc: async () => {
      if (options.serverFlock) return options.serverFlock;
      throw new Error('Unexpected Flock room');
    },
  });
  let dropped = false;
  const pending = new Set<Promise<void>>();
  const peer = {
    id: 'connection-a',
    send: (message: LocalLoroDataPlaneServerMessage) => {
      for (const listener of listeners) listener(message);
    },
  };
  return {
    server,
    listeners,
    statuses,
    connection: {
      send: (message: LocalLoroDataPlaneClientMessage) => {
        if (message.type === 'ping' || message.type === 'machine-monitor') return;
        if (message.type === 'update' && options.dropFirstUpdate && !dropped) {
          dropped = true;
          return;
        }
        const job = server.handleMessage(peer, message);
        pending.add(job);
        void job.finally(() => pending.delete(job));
      },
      onMessage: (listener: (message: LocalLoroDataPlaneServerMessage) => void) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      onStatusChange: (listener: (online: boolean) => void) => {
        statuses.add(listener);
        return () => {
          statuses.delete(listener);
        };
      },
      isConnected: () => true,
    },
    close: async () => {
      await Promise.all([...pending]);
      await server.disposeLegacy();
      await writer.closeLegacy();
    },
  };
}

describe('native local v7 transport', () => {
  it('automatically rejoins an invalidated host room and resumes incoming edits', async () => {
    const remote = new LoroDoc();
    remote.getText('body').insert(0, 'baseline');
    remote.commit();
    const harness = wire(remote);
    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const repo = yield* makeWorkspaceRepo();
            yield* repo.attachTransport(
              yield* makeLocalWorkspaceTransport('local', {
                workspaceId: 'ws',
                peerId: 'peer-a',
                connection: harness.connection,
              })
            );
            const lease = yield* repo.acquireDoc('session-a');
            const room = yield* repo.acquireRoom({ kind: 'doc', id: 'session-a' });
            yield* room.sync('local');
            const epoch = (yield* room.stateSnapshot('local')).epoch;
            harness.server.invalidateDocRoom('session-a');
            yield* room.state('local').pipe(
              Stream.filter((state) => state.epoch > epoch && state.current),
              Stream.runHead
            );
            const imported = Promise.withResolvers<void>();
            yield* Effect.acquireRelease(
              Effect.sync(() =>
                lease.doc.subscribe(() => {
                  if (lease.doc.getText('body').toString() === 'baseline after') imported.resolve();
                })
              ),
              (unsubscribe) => Effect.sync(unsubscribe)
            );
            remote.getText('body').insert(8, ' after');
            remote.commit();
            yield* Effect.promise(() => imported.promise);
            expect(lease.doc.getText('body').toString()).toBe('baseline after');
          })
        )
      );
    } finally {
      await harness.close();
      remote.free();
    }
  });

  it('confirms a Machine Flock write only after the real peer has imported its configuration', async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const host = yield* makeWorkspaceRepo();
          const remote = yield* host.acquireFlockDoc('machine');
          const harness = yield* Effect.acquireRelease(
            Effect.sync(() => wire(new LoroDoc(), { serverFlock: remote.flock })),
            (owned) => Effect.promise(owned.close)
          );
          const repo = yield* Effect.acquireRelease(
            Effect.promise(() => WorkspaceRepoLegacy.create({})),
            (owned) => Effect.promise(() => owned.destroy())
          );
          yield* Effect.promise(() =>
            repo.addTransport(
              'local',
              localWorkspaceTransport({
                workspaceId: 'ws',
                peerId: 'peer-a',
                connection: harness.connection,
              })
            )
          );
          const local = yield* Effect.promise(() => repo.openFlockDoc('machine'));
          const sync = () => repo.syncRoomLegacy({ kind: 'flock', id: 'machine' }, 'local');
          yield* Effect.promise(sync);
          local.flock.set(['agentConfig', 'synthetic'], { command: 'synthetic-agent' });
          local.flock.commit();
          expect((yield* Effect.promise(sync)).outcome).toBe('confirmed');
          expect(remote.flock.get(['agentConfig', 'synthetic'])).toEqual({
            command: 'synthetic-agent',
          });
        })
      )
    );
  });

  it('fails oversized queued input and releases its observers instead of hanging a sync waiter', async () => {
    const remote = new LoroDoc();
    remote.getText('body').insert(0, 'remote state');
    remote.commit();
    const harness = wire(remote);
    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const repo = yield* makeWorkspaceRepo();
            yield* repo.attachTransport(
              yield* makeLocalWorkspaceTransport('local', {
                workspaceId: 'ws',
                peerId: 'peer-a',
                connection: harness.connection,
                maxQueuedBytes: 16,
              })
            );
            const room = yield* repo.acquireRoom({ kind: 'doc', id: 'session-a' });
            const error = yield* room.sync('local').pipe(Effect.flip);
            expect(error._tag).toBe('RepoSyncFailed');
            expect((yield* room.stateSnapshot('local')).current).toBe(false);
          })
        )
      );
      expect(harness.listeners.size).toBe(0);
      expect(harness.statuses.size).toBe(0);
    } finally {
      await harness.close();
    }
  });
  it('catches up the real document and releases connection observers with its Scope', async () => {
    const remote = new LoroDoc();
    remote.getText('body').insert(0, 'remote');
    remote.commit();
    const harness = wire(remote);
    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const repo = yield* makeWorkspaceRepo();
            const transport = yield* makeLocalWorkspaceTransport('local', {
              workspaceId: 'ws',
              peerId: 'peer-a',
              connection: harness.connection,
            });
            yield* repo.attachTransport(transport);
            const room = yield* repo.acquireRoom({ kind: 'doc', id: 'session-a' });
            const report = yield* room.sync('local');
            expect(report.outcome).toBe('confirmed');
            expect(report.authority).toBe('peer');
            const lease = yield* repo.acquireDoc('session-a');
            expect(lease.doc.getText('body').toString()).toBe('remote');
            expect((yield* room.stateSnapshot('local')).baseline).toBe(true);
          })
        )
      );
      expect(harness.listeners.size).toBe(0);
      expect(harness.statuses.size).toBe(0);
    } finally {
      await harness.close();
    }
  });

  it('reconciles a dropped upload before confirming and keeps epoch stable across local edits', async () => {
    const remote = new LoroDoc();
    const harness = wire(remote, { dropFirstUpdate: true });
    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const repo = yield* makeWorkspaceRepo();
            const transport = yield* makeLocalWorkspaceTransport('local', {
              workspaceId: 'ws',
              peerId: 'peer-a',
              connection: harness.connection,
            });
            yield* repo.attachTransport(transport);
            const lease = yield* repo.acquireDoc('session-a');
            lease.doc.getText('body').insert(0, 'local');
            lease.doc.commit();
            const room = yield* repo.acquireRoom({ kind: 'doc', id: 'session-a' });
            yield* room.sync('local');
            expect(remote.getText('body').toString()).toBe('local');
            const epoch = (yield* room.stateSnapshot('local')).epoch;
            lease.doc.getText('body').insert(5, ' edit');
            lease.doc.commit();
            // Wait for peer coverage without interpreting a local edit as a reconnect.
            yield* room.sync('local');
            expect(remote.getText('body').toString()).toBe('local edit');
            expect((yield* room.stateSnapshot('local')).epoch).toBe(epoch);
          })
        )
      );
    } finally {
      await harness.close();
    }
  });

  it('does not mistake peer synchronization for required server confirmation', async () => {
    const remote = new LoroDoc();
    const harness = wire(remote);
    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const repo = yield* makeWorkspaceRepo();
            yield* repo.attachTransport(
              yield* makeLocalWorkspaceTransport('local', {
                workspaceId: 'ws',
                peerId: 'peer-a',
                connection: harness.connection,
              })
            );
            const report = yield* repo.sync({
              scope: 'doc',
              docIds: ['session-a'],
              requireTransports: ['local'],
            });
            expect(report.outcome).toBe('failed');
          })
        )
      );
    } finally {
      await harness.close();
    }
  });
});
