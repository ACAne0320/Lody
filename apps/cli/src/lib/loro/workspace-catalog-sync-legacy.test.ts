import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LoroRepo,
  RepoStorageError,
  type RepoRoomSubscription,
  type TransportAdapter,
  type TransportSubscription,
} from 'loro-repo';
import { getWorkspaceFlockDocId, type WorkspaceId } from '@lody/shared';
import type { Logger } from '@/utils/logger';
import { createWorkspaceCatalogSyncLegacy } from './workspace-catalog-sync-legacy';

const workspaceId = 'promise-catalog-test' as WorkspaceId;
const logger = { debug: () => {} } as Logger;

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

const makeTransportSubscription = (onJoin: () => void, onLeave: () => void) => {
  const baseline = deferred();
  return {
    subscription: {
      unsubscribe: onLeave,
      firstSyncedWithRemote: baseline.promise,
      waitUntilSynced: async () => baseline.promise,
      status: 'joined',
      onStatusChange: (listener: (status: TransportSubscription['status']) => void) => {
        listener('joined');
        return () => {};
      },
    } satisfies TransportSubscription,
    markSynced: baseline.resolve,
    onJoin,
  };
};

describe('Promise Repo catalog readers', () => {
  afterEach(() => vi.useRealTimers());

  it('retains daemon readers after a request timeout and detach, then releases them on close', async () => {
    vi.useFakeTimers();
    const repo = await LoroRepo.create({});
    const live = new Set<string>();
    const subscriptions = new Map<string, ReturnType<typeof makeTransportSubscription>>();
    const join = (id: string): TransportSubscription => {
      const subscription = makeTransportSubscription(
        () => live.add(id),
        () => live.delete(id)
      );
      subscriptions.set(id, subscription);
      subscription.onJoin();
      return subscription.subscription;
    };
    const adapter: TransportAdapter = {
      connect: async () => {},
      close: async () => {},
      isConnected: () => true,
      getStatus: () => 'connected',
      onStatusChange: () => () => {},
      syncMeta: async () => ({ ok: true }),
      syncDoc: async () => ({ ok: true }),
      joinMetaRoom: () => join('meta'),
      joinDocRoom: (id) => join(id),
      joinFlockDocRoom: (id) => join(id),
    };
    const meta = await repo.joinMetaRoom();
    const catalog = createWorkspaceCatalogSyncLegacy(repo, workspaceId, logger, meta);
    const id = getWorkspaceFlockDocId(workspaceId);
    try {
      expect(await catalog.ready(id, 0)).toBe(false);
      await repo.addTransport('streams', adapter);
      const waiting = catalog.ready(id, 1_000);
      await vi.advanceTimersByTimeAsync(1_000);
      await expect(waiting).resolves.toBe(false);
      expect(live).toEqual(new Set(['meta', id]));

      subscriptions.get(id)?.markSynced();
      await expect(catalog.ready(id, 100)).resolves.toBe(true);
      await repo.removeTransport('streams');
      await expect(catalog.ready(id, 0)).resolves.toBe(true);

      await repo.addTransport('streams', adapter);
      subscriptions.get('meta')?.markSynced();
      await expect(catalog.ready(undefined, 100)).resolves.toBe(true);
    } finally {
      await catalog.close();
      await repo.destroy();
    }
    expect(live.size).toBe(0);
  });

  it('retries a transient acquisition with capped backoff and stops on close', async () => {
    vi.useFakeTimers();
    const repo = await LoroRepo.create({});
    const meta = await repo.joinMetaRoom();
    const join = repo.joinFlockDocRoom.bind(repo);
    const firstAttemptStarted = deferred();
    const retryStarted = deferred();
    let attempts = 0;
    vi.spyOn(repo, 'joinFlockDocRoom').mockImplementation(async (id) => {
      attempts += 1;
      if (attempts === 1) {
        firstAttemptStarted.resolve();
        throw new RepoStorageError('Temporary local storage outage', { code: 'unavailable' });
      }
      if (attempts === 2) retryStarted.resolve();
      return join(id);
    });
    const catalog = createWorkspaceCatalogSyncLegacy(repo, workspaceId, logger, meta);
    const id = getWorkspaceFlockDocId(workspaceId);

    try {
      await firstAttemptStarted.promise;
      expect(attempts).toBe(1);
      const waiting = catalog.ready(id, 5_000);
      await vi.advanceTimersByTimeAsync(999);
      expect(attempts).toBe(1);
      await vi.advanceTimersByTimeAsync(1);
      await retryStarted.promise;
      expect(attempts).toBe(2);

      await catalog.close();
      await vi.advanceTimersByTimeAsync(120_000);
      expect(attempts).toBe(2);
      await expect(waiting).resolves.toBe(false);
    } finally {
      await catalog.close();
      await repo.destroy();
    }
  });
});
