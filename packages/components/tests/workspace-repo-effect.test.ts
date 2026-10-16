import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import {
  Cause,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Scope,
  Stream,
  SubscriptionRef,
  Option,
} from 'effect';
import type { RoomState, RoomStatus, TransportStatus } from 'loro-repo/effect';
import type { SessionId } from '@lody/shared';
import { makeSessionDirectory, makeSyncAuthority } from '@lody/shared/workspace-data/services';
import { DataReadSyncFailed } from '@lody/shared/workspace-data/sync-authority';
import { acquireWorkspaceScope } from '@lody/shared/workspace-data/ownership';
import { RepoDocAlreadyExists, RepoIOError, RepoReleaseFailed } from 'loro-repo/effect';
import { IndexedDBStorageAdaptor } from 'loro-repo/storage/indexeddb';
import { make as makeWorkspaceRepo } from 'loro-repo/effect';
import {
  WorkspaceRepoLegacy,
  WorkspaceRepoLegacyFailure,
  workspaceSyncFailuresLegacy,
} from '@lody/shared/workspace-data/repo-legacy';
import { createLoroSyncErrorTools } from '@lody/shared/loro-sync-errors';
import { RepoSyncError, RepoTransportError } from 'loro-repo';

let sequence = 0;
const storage = () =>
  new IndexedDBStorageAdaptor({ dbName: `native-workspace-repo-${++sequence}` });

describe('native workspace Repo ownership', () => {
  it('separates absent identity from explicit creation and rejects duplicate creation', async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const repo = yield* makeWorkspaceRepo();
          expect(yield* repo.openDoc('missing')).toBeUndefined();
          const created = yield* repo.createDoc('session-a', { title: 'created' });
          created.doc.getText('body').insert(0, 'local');
          created.doc.commit();
          const opened = yield* repo.openDoc('session-a');
          expect(opened?.doc).toBe(created.doc);
          const duplicate = yield* repo.createDoc('session-a', {}).pipe(Effect.flip);
          expect(duplicate).toBeInstanceOf(RepoDocAlreadyExists);
          expect((yield* repo.getDocMeta('session-a'))?.meta.title).toBe('created');
        })
      )
    );
  });

  it('keeps another borrower alive and saves before the last lease is released', async () => {
    const adapter = storage();
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const repo = yield* makeWorkspaceRepo({ storageAdapter: adapter });
          yield* repo.upsertDocMeta('session-a', { title: 'shared' });
          const parent = yield* Effect.scope;
          const a = yield* Scope.fork(parent);
          const b = yield* Scope.fork(parent);
          const left = yield* repo.openDoc('session-a').pipe(Effect.provideService(Scope.Scope, a));
          const right = yield* repo
            .openDoc('session-a')
            .pipe(Effect.provideService(Scope.Scope, b));
          expect(left?.doc).toBe(right?.doc);
          left?.doc.getText('body').insert(0, 'one');
          left?.doc.commit();
          yield* Scope.close(a, Exit.void);
          right?.doc.getText('body').insert(3, ' two');
          right?.doc.commit();
          yield* Scope.close(b, Exit.void);
          const reopened = yield* repo.openDoc('session-a');
          expect(reopened?.doc).not.toBe(left?.doc);
          expect(reopened?.doc.getText('body').toString()).toBe('one two');
          expect(reopened?.source).toBe('storage');
        })
      )
    );
  });

  it('preserves storage load failures rather than manufacturing an empty document', async () => {
    const adapter = storage();
    const failure = new Error('synthetic IndexedDB read failure');
    adapter.loadDoc = async () => {
      throw failure;
    };
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const repo = yield* makeWorkspaceRepo({ storageAdapter: adapter });
          yield* repo.upsertDocMeta('session-a', { title: 'retained' });
          const exit = yield* Effect.scoped(repo.openDoc('session-a')).pipe(Effect.exit);
          expect(Exit.isFailure(exit)).toBe(true);
          if (Exit.isFailure(exit)) {
            expect(
              exit.cause.reasons.some(
                (reason) =>
                  Cause.isFailReason(reason) &&
                  reason.error instanceof RepoIOError &&
                  reason.error.failure === failure
              )
            ).toBe(true);
          }
          expect((yield* repo.getDocMeta('session-a'))?.meta.title).toBe('retained');
        })
      )
    );
  });

  it('observes a coherent snapshot and every subsequent metadata change', async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const repo = yield* makeWorkspaceRepo();
          yield* repo.upsertDocMeta('session-a', { title: 'before' });
          const observation = yield* repo.observeDocs();
          expect(observation.snapshot[0]?.meta.title).toBe('before');
          const received = yield* Deferred.make<void>();
          const consumer = yield* observation.changes.pipe(
            Stream.runForEach(({ event }) => {
              if (event.kind === 'doc-metadata' && event.patch.title === 'after')
                return Deferred.succeed(received, undefined);
              return Effect.void;
            }),
            Effect.forkScoped
          );
          yield* repo.upsertDocMeta('session-a', { title: 'after' });
          yield* Deferred.await(received);
          yield* Fiber.interrupt(consumer);
        })
      )
    );
  });

  it('the compatibility door shares native leases and persists through real IndexedDB', async () => {
    const adapter = storage();
    const repo = await WorkspaceRepoLegacy.create({ storageAdapter: adapter });
    const lease = await repo.acquireDoc('session-a');
    const handle = await repo.openPersistedDoc('session-a');
    expect(handle.doc).toBe(lease.doc);
    lease.doc.getText('body').insert(0, 'retained');
    lease.doc.commit();
    await repo.unloadDoc('session-a');
    lease.doc.getText('body').insert(8, ' borrower');
    lease.doc.commit();
    await lease.release();
    expect((await repo.openPersistedDoc('session-a')).doc.getText('body').toString()).toBe(
      'retained borrower'
    );
    await repo.destroy();
    await repo.destroy();
  });
});

describe('native WorkspaceData services', () => {
  it('lists normalized Session identities without materializing bodies', async () => {
    const adapter = storage();
    adapter.loadDoc = async () => {
      throw new Error('Directory must not open a body');
    };
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const repo = yield* makeWorkspaceRepo({ storageAdapter: adapter });
          yield* repo.upsertDocMeta('session-a', { id: 'untrusted embedded id', title: 'kept' });
          yield* repo.upsertDocMeta('session-b', { title: 'deleted' });
          yield* repo.deleteDoc('session-b');
          const directory = makeSessionDirectory(repo);
          expect((yield* directory.list({ archive: 'any' })).map((row) => row.id)).toEqual(['a']);
          expect(yield* directory.get('b' as SessionId)).toEqual(Option.none());
          expect(yield* directory.get('a' as SessionId)).toEqual(
            Option.some({ id: 'a', title: 'kept' })
          );
        })
      )
    );
  });

  it('requires a new server confirmation on each refresh and preserves local authority', async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const repo = yield* makeWorkspaceRepo({
            authority: { mode: 'remote', transports: ['cloud'] },
          });
          const authority = makeSyncAuthority(repo, { local: false, serverTransports: ['cloud'] });
          expect(yield* authority.refresh({ reason: 'missing' }).pipe(Effect.flip)).toBeInstanceOf(
            DataReadSyncFailed
          );
          let online = true;
          const status = yield* SubscriptionRef.make<RoomStatus>('synced');
          yield* repo.attachTransport({
            id: 'cloud',
            authority: 'server',
            connect: Effect.void,
            disconnect: Effect.void,
            join: () =>
              Effect.succeed({
                status,
                close: Effect.void,
                sync: Effect.sync(() => (online ? ('confirmed' as const) : ('offline' as const))),
              }),
          });
          yield* authority.refresh({ reason: 'online' });
          online = false;
          expect(yield* authority.refresh({ reason: 'offline' }).pipe(Effect.flip)).toBeInstanceOf(
            DataReadSyncFailed
          );
          yield* makeSyncAuthority(repo, { local: true, serverTransports: [] }).refresh({
            reason: 'local',
          });
        })
      )
    );
  });
});

describe('retained native release ownership', () => {
  it('closes storage after a background observer fails without poisoning shutdown', async () => {
    const adapter = storage();
    const repo = await WorkspaceRepoLegacy.create({ storageAdapter: adapter });
    const reported = Promise.withResolvers<void>();
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => reported.resolve());
    const failure = new Error('synthetic private observer failure');
    const watch = repo.watch(() => {
      throw failure;
    });
    try {
      await repo.upsertDocMeta('observed', { title: 'retained' });
      await reported.promise;
      expect((await repo.getDocMeta('observed'))?.meta.title).toBe('retained');
      await expect(repo.destroy()).resolves.toBeUndefined();
      await expect(adapter.loadDoc('observed')).rejects.toThrow();
    } finally {
      watch.unsubscribe();
      warning.mockRestore();
      await repo.destroy();
    }
  });
  it('keeps an unrouted room detached and its first-sync waiter alive until attachment', async () => {
    const repo = await WorkspaceRepoLegacy.create({});
    try {
      const room = await repo.joinMetaRoom();
      const binding = room.subscription('streams');
      expect(binding.status).toBe('detached');
      const firstSync = binding.firstSyncedWithRemote;
      await repo.addTransport('streams', {
        kind: 'native-workspace-transport',
        make: (id) =>
          Effect.gen(function* () {
            return {
              id,
              authority: 'server' as const,
              status: yield* SubscriptionRef.make<TransportStatus>('online'),
              connect: Effect.void,
              disconnect: Effect.void,
              join: () =>
                Effect.gen(function* () {
                  return {
                    status: yield* SubscriptionRef.make<RoomStatus>('synced'),
                    state: yield* SubscriptionRef.make<RoomState>({
                      connection: 'joined',
                      baseline: true,
                      current: true,
                      uploadPending: false,
                      epoch: 1,
                    }),
                    close: Effect.void,
                    sync: Effect.succeed('confirmed' as const),
                  };
                }),
            };
          }),
      });
      await firstSync;
      expect(binding.status).toBe('joined');
      await repo.removeTransport('streams');
      expect(binding.status).toBe('detached');
    } finally {
      await repo.destroy();
    }
  });

  it('rejects a first-sync waiter when the native room fails instead of waiting forever', async () => {
    const repo = await WorkspaceRepoLegacy.create({});
    try {
      await repo.addTransport('broken', {
        kind: 'native-workspace-transport',
        make: (id) =>
          Effect.gen(function* () {
            return {
              id,
              authority: 'server' as const,
              status: yield* SubscriptionRef.make<TransportStatus>('online'),
              connect: Effect.void,
              disconnect: Effect.void,
              join: () => Effect.fail(new RepoIOError('synthetic failed join', undefined)),
            };
          }),
      });
      const room = await repo.joinDocRoom('unavailable');
      await expect(room.subscription('broken').firstSyncedWithRemote).rejects.toBeInstanceOf(
        RepoIOError
      );
      room.unsubscribe();
    } finally {
      await repo.destroy();
    }
  });
  it('keeps storage owned after workspace close fails and finishes its original write on retry', async () => {
    const dbName = `native-workspace-close-${++sequence}`;
    const adapter = new IndexedDBStorageAdaptor({ dbName });
    const save = adapter.save.bind(adapter);
    const close = adapter.close.bind(adapter);
    let blocked = false;
    let storageClosed = false;
    adapter.save = async (payload) => {
      if (blocked && (payload.type === 'doc-update' || payload.type === 'doc-snapshot'))
        throw new Error('synthetic unavailable storage');
      await save(payload);
    };
    adapter.close = () => {
      storageClosed = true;
      return close();
    };
    const repo = await WorkspaceRepoLegacy.create({ storageAdapter: adapter });
    const lease = await repo.acquireDoc('retained');
    lease.doc.getText('body').insert(0, 'accepted write');
    lease.doc.commit();
    blocked = true;
    try {
      await expect(repo.destroy()).rejects.toBeInstanceOf(RepoReleaseFailed);
      expect(storageClosed).toBe(false);
    } finally {
      blocked = false;
      await repo.destroy();
    }
    expect(storageClosed).toBe(true);
    const reopened = new IndexedDBStorageAdaptor({ dbName });
    try {
      expect((await reopened.loadDoc('retained'))?.getText('body').toString()).toBe(
        'accepted write'
      );
    } finally {
      await reopened.close();
    }
  });
  it('projects native protocol diagnostics without exposing private Causes or request payloads', () => {
    class CallerTransportError extends RepoTransportError {}
    const tools = createLoroSyncErrorTools({
      RepoSyncError,
      RepoTransportError: CallerTransportError,
      nativeFailures: workspaceSyncFailuresLegacy,
    });
    const failure = new RepoIOError('streams protocol', {
      streamsCode: 'auth_failed',
      retryable: false,
      failureKind: 'local',
      streamsContext: { source: 'auth', operation: 'sync', retryable: false },
      fullCause: Cause.die(new Error('synthetic-private-token-in-request')),
    });
    const rendered = tools.formatLoroSyncError(new WorkspaceRepoLegacyFailure(Cause.fail(failure)));
    expect(rendered).toContain('auth_failed');
    expect(rendered).toContain('"retryable":false');
    expect(rendered).not.toContain('synthetic-private-token');
    expect(rendered).not.toContain('fullCause');
  });
  it('retains a failed last-document save and retries before allowing a replacement', async () => {
    const adapter = storage();
    const save = adapter.save.bind(adapter);
    let fail = false;
    adapter.save = async (payload) => {
      if (fail && (payload.type === 'doc-update' || payload.type === 'doc-snapshot'))
        throw new Error('synthetic write failure');
      await save(payload);
    };
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const repo = yield* makeWorkspaceRepo({
            storageAdapter: adapter,
            persistenceAttempts: 1,
            autoPersistMs: 0,
          });
          const owner = yield* acquireWorkspaceScope('test document');
          const lease = yield* repo
            .acquireDoc('session-a')
            .pipe(Effect.provideService(Scope.Scope, owner.scope));
          lease.doc.getText('body').insert(0, 'must survive release failure');
          lease.doc.commit();
          fail = true;
          const error = yield* owner.close.pipe(Effect.flip);
          expect(error).toBeInstanceOf(RepoReleaseFailed);
          fail = false;
          yield* error.retry;
          yield* owner.close;
          const reopened = yield* repo.acquireDoc('session-a');
          expect(reopened.doc).not.toBe(lease.doc);
          expect(reopened.doc.getText('body').toString()).toBe('must survive release failure');
        })
      )
    );
  });
});
