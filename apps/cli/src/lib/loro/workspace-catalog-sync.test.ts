import { afterEach, describe, expect, it, vi } from 'vitest';
import { LoroRepo, RepoStorageError } from 'loro-repo';
import type {
  RepoRoomSubscription,
  TransportAdapter,
  TransportConnectionStatus,
  TransportSubscription,
  TransportSyncResult,
} from 'loro-repo';
import { getWorkspaceFlockDocId, type WorkspaceId } from '@lody/shared';
import type { Logger } from '@/utils/logger';
import { makeWorkspaceCatalogSync } from './workspace-catalog-sync';

const workspaceId = 'catalog-sync-test' as WorkspaceId;
const logger = { debug: () => {} } as Logger;
const OK: TransportSyncResult = { ok: true };

class MemoryStreamsAdapter implements TransportAdapter {
  private connected = false;
  readonly subscriptions = new Map<string, ReturnType<typeof makeSubscription>>();

  constructor(private readonly holdFirstSync = false) {}

  async connect(): Promise<void> {
    this.connected = true;
  }

  async close(): Promise<void> {
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  getStatus(): TransportConnectionStatus {
    return this.connected ? 'connected' : 'disconnected';
  }

  onStatusChange(): () => void {
    return () => {};
  }

  async syncMeta(): Promise<TransportSyncResult> {
    return OK;
  }

  joinMetaRoom(): TransportSubscription {
    return this.join('meta');
  }

  async syncDoc(): Promise<TransportSyncResult> {
    return OK;
  }

  joinDocRoom(docId: string): TransportSubscription {
    return this.join(`doc:${docId}`);
  }

  async syncFlockDoc(): Promise<TransportSyncResult> {
    return OK;
  }

  joinFlockDocRoom(flockDocId: string): TransportSubscription {
    return this.join(`flock:${flockDocId}`);
  }

  async forgetFlockDoc(): Promise<void> {}

  markSynced(key: string): void {
    this.subscriptions.get(key)?.resolve();
  }

  private join(key: string): TransportSubscription {
    const subscription = makeSubscription(!this.holdFirstSync);
    this.subscriptions.set(key, subscription);
    return subscription.subscription;
  }
}

function makeSubscription(initiallySynced: boolean) {
  const deferred = Promise.withResolvers<void>();
  if (initiallySynced) deferred.resolve();
  let status: TransportSubscription['status'] = 'joined';
  const listeners = new Set<(status: TransportSubscription['status']) => void>();
  return {
    resolve: deferred.resolve,
    subscription: {
      unsubscribe: () => {
        status = 'disconnected';
        for (const listener of listeners) listener(status);
      },
      firstSyncedWithRemote: deferred.promise,
      waitUntilSynced: async () => {},
      get status() {
        return status;
      },
      onStatusChange: (listener: (value: TransportSubscription['status']) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    } satisfies TransportSubscription,
  };
}

const createRepo = () => LoroRepo.create({});

const createCatalog = async (repo: LoroRepo, adapter?: MemoryStreamsAdapter) => {
  const metaSubscription = await repo.joinMetaRoom();
  const catalog = await makeWorkspaceCatalogSync(repo, workspaceId, logger, metaSubscription);
  if (adapter) await repo.addTransport('streams', adapter);
  return { catalog, metaSubscription };
};

afterEach(() => {
  vi.useRealTimers();
});

describe('daemon workspace catalog ownership', () => {
  it('holds workspace and queried machine rooms until Repo shutdown', async () => {
    const repo = await createRepo();
    const adapter = new MemoryStreamsAdapter();
    const { catalog } = await createCatalog(repo, adapter);
    const workspaceFlock = getWorkspaceFlockDocId(workspaceId);
    const machineFlock = 'machine:catalog-sync-test';

    try {
      expect(await catalog.ready(workspaceFlock, 100)).toBe(true);
      await catalog.hold(machineFlock);
      expect(await catalog.ready(machineFlock, 100)).toBe(true);
      expect(adapter.subscriptions.has(`flock:${workspaceFlock}`)).toBe(true);
      expect(adapter.subscriptions.has(`flock:${machineFlock}`)).toBe(true);

      await catalog.close();
      expect(adapter.subscriptions.get(`flock:${workspaceFlock}`)?.subscription.status).toBe(
        'disconnected'
      );
      expect(adapter.subscriptions.get(`flock:${machineFlock}`)?.subscription.status).toBe(
        'disconnected'
      );
    } finally {
      await catalog.close();
      await repo.destroy();
    }
  });

  it('bounds a first-baseline wait without releasing the reader', async () => {
    vi.useFakeTimers();
    const repo = await createRepo();
    const adapter = new MemoryStreamsAdapter(true);
    const { catalog } = await createCatalog(repo);
    const workspaceFlock = getWorkspaceFlockDocId(workspaceId);

    try {
      const waiting = catalog.ready(workspaceFlock, 1_000);
      await vi.advanceTimersByTimeAsync(1_000);
      await expect(waiting).resolves.toBe(false);

      await repo.addTransport('streams', adapter);
      adapter.markSynced(`flock:${workspaceFlock}`);
      await expect(catalog.ready(workspaceFlock, 100)).resolves.toBe(true);
      expect(adapter.subscriptions.get(`flock:${workspaceFlock}`)?.subscription.status).toBe(
        'joined'
      );
    } finally {
      await catalog.close();
      await repo.destroy();
    }
  });

  it('retries a transient local room acquisition and stops the retry when closed', async () => {
    vi.useFakeTimers();
    const repo = await createRepo();
    const metaSubscription = await repo.joinMetaRoom();
    const workspaceFlock = getWorkspaceFlockDocId(workspaceId);
    const join = repo.joinFlockDocRoom.bind(repo);
    const firstAttemptStarted = Promise.withResolvers<void>();
    const retryStarted = Promise.withResolvers<void>();
    let attempts = 0;
    const retryingRepo = Object.assign(Object.create(repo), {
      joinFlockDocRoom: async (id: string): Promise<RepoRoomSubscription> => {
        attempts += 1;
        if (attempts === 1) {
          firstAttemptStarted.resolve();
          throw new RepoStorageError('Temporary local storage outage', { code: 'unavailable' });
        }
        if (attempts === 2) retryStarted.resolve();
        return join(id);
      },
    }) as LoroRepo;
    const catalog = await makeWorkspaceCatalogSync(
      retryingRepo,
      workspaceId,
      logger,
      metaSubscription
    );

    try {
      await firstAttemptStarted.promise;
      expect(attempts).toBe(1);
      await vi.advanceTimersByTimeAsync(1_000);
      await retryStarted.promise;
      expect(attempts).toBe(2);
      await catalog.close();
      await vi.advanceTimersByTimeAsync(120_000);
      expect(attempts).toBe(2);
    } finally {
      await catalog.close();
      await repo.destroy();
    }
  });
});
