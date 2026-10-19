import type { LoroRepo, RepoRoomSubscription } from 'loro-repo';
import { getWorkspaceFlockDocId, type WorkspaceId } from '@lody/shared';
import { STREAMS_TRANSPORT_ID } from './streams-room-binding';
import { withTimeout } from './timeout-utils';

/** Promise Repo rooms stay owned by the daemon until repo.destroy(). */
export function createWorkspaceCatalogSyncLegacy(repo: LoroRepo, workspaceId: WorkspaceId) {
  type Entry = { joined: Promise<RepoRoomSubscription | undefined>; baseline: boolean };
  const held = new Map<string | undefined, Entry>();
  const ensure = (id: string | undefined): Entry => {
    const prior = held.get(id);
    if (prior) return prior;
    const entry: Entry = { joined: Promise.resolve(undefined), baseline: false };
    held.set(id, entry);
    entry.joined = (id === undefined ? repo.joinMetaRoom() : repo.joinFlockDocRoom(id))
      .then((room) => {
        // Observe once per reader, not once per request. Detached rooms retain
        // their first-baseline promise across later transport attachment.
        void room.subscription(STREAMS_TRANSPORT_ID).firstSyncedWithRemote.then(
          () => {
            entry.baseline = true;
          },
          () => {}
        );
        return room;
      })
      .catch(() => {
        // A failed join owns no lease. A subsequent read may acquire it again.
        held.delete(id);
        return undefined;
      });
    return entry;
  };
  ensure(undefined);
  ensure(getWorkspaceFlockDocId(workspaceId));
  return {
    hold(id: string): void {
      ensure(id);
    },
    async ready(id: string | undefined, timeoutMs: number): Promise<boolean> {
      const entry = ensure(id);
      if (entry.baseline) return true;
      if (timeoutMs <= 0) return false;
      // Bound acquisition and baseline together; timeout never releases the room.
      const wait = entry.joined.then(async (room) => {
        if (!room) return false;
        const result = await room.subscription(STREAMS_TRANSPORT_ID).waitFor({
          phase: 'restored',
          timeoutMs,
        });
        if (result.status === 'complete') entry.baseline = true;
        return entry.baseline;
      });
      return withTimeout(wait, timeoutMs, 'Catalog baseline timeout').catch(() => false);
    },
  };
}
