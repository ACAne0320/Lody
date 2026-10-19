import { afterEach, describe, expect, it, vi } from 'vitest';
import { LoroRepo, type TransportAdapter, type TransportSubscription } from 'loro-repo';
import { getWorkspaceFlockDocId, type WorkspaceId } from '@lody/shared';
import { createWorkspaceCatalogSyncLegacy } from './workspace-catalog-sync-legacy';

const workspaceId = 'promise-catalog-test' as WorkspaceId;

describe('Promise Repo catalog readers', () => {
  afterEach(() => vi.useRealTimers());

  it('retains readers after timeout, remembers baseline after detach, and releases on Repo close', async () => {
    vi.useFakeTimers();
    const repo = await LoroRepo.create({});
    const live = new Set<string>();
    const baselines = new Map<string, () => void>();
    const join = (id: string): TransportSubscription => {
      live.add(id);
      const firstSyncedWithRemote = new Promise<void>((resolve) => baselines.set(id, resolve));
      return {
        status: 'joined',
        firstSyncedWithRemote,
        waitUntilSynced: () => firstSyncedWithRemote,
        onStatusChange: () => () => {},
        unsubscribe: () => {
          live.delete(id);
        },
      };
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
    try {
      const catalog = createWorkspaceCatalogSyncLegacy(repo, workspaceId);
      const id = getWorkspaceFlockDocId(workspaceId);
      expect(await catalog.ready(id, 0)).toBe(false);
      await repo.addTransport('streams', adapter);
      catalog.hold(id);
      catalog.hold(id);
      const pending = catalog.ready(id, 100);
      await vi.advanceTimersByTimeAsync(100);
      expect(await pending).toBe(false);
      expect(live).toEqual(new Set(['meta', id]));
      baselines.get(id)?.();
      expect(await catalog.ready(id, 100)).toBe(true);
      await repo.removeTransport('streams');
      expect(await catalog.ready(id, 0)).toBe(true);
      expect(await catalog.ready(undefined, 0)).toBe(false);
      await repo.addTransport('streams', adapter);
      baselines.get('meta')?.();
      expect(await catalog.ready(undefined, 100)).toBe(true);
    } finally {
      await repo.destroy();
    }
    expect(live.size).toBe(0);
  });

  it('keeps slow joins off hold and bounds readiness, then retries a failed acquisition', async () => {
    vi.useFakeTimers();
    const repo = await LoroRepo.create({});
    const join = repo.joinFlockDocRoom.bind(repo);
    let rejectJoin: (error: Error) => void = () => {};
    vi.spyOn(repo, 'joinFlockDocRoom').mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectJoin = reject;
        })
    );
    try {
      const catalog = createWorkspaceCatalogSyncLegacy(repo, workspaceId);
      const id = getWorkspaceFlockDocId(workspaceId);
      expect(catalog.hold(id)).toBeUndefined();
      const pending = catalog.ready(id, 100);
      await vi.advanceTimersByTimeAsync(100);
      expect(await pending).toBe(false);
      rejectJoin(new Error('temporary local load failure'));
      await vi.advanceTimersByTimeAsync(0);
      vi.mocked(repo.joinFlockDocRoom).mockImplementation(join);
      expect(await catalog.ready(id, 100)).toBe(false);
      expect(repo.transportRooms('streams').some((room) => room.room.id === id)).toBe(true);
    } finally {
      await repo.destroy();
    }
  });
});
