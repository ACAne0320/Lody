import {
  RepoStorageError,
  RepoTransportError,
  ResourceBusyError,
  type LoroRepo,
  type RepoRoomSubscription,
} from 'loro-repo';
import { getWorkspaceFlockDocId } from '@lody/shared';
import type { WorkspaceId } from '@lody/shared';
import type { Logger } from '@/utils/logger';
import { withTimeout } from './timeout-utils';

/** Reader interest belongs to the daemon, never to a discovery request. */
export interface WorkspaceCatalogSync {
  hold: (flockDocId: string) => Promise<void>;
  /** Undefined selects metadata. A timed-out waiter never cancels the daemon reader. */
  ready: (flockDocId: string | undefined, timeoutMs: number) => Promise<boolean>;
  close: () => Promise<void>;
}

type CatalogRoom = {
  id: string;
  controller: AbortController;
  subscription: RepoRoomSubscription | null;
  baseline: boolean;
  completion: Promise<void>;
};

const retryDelayMs = (attempt: number) => Math.min(1_000 * 2 ** attempt, 30_000);

const isRetryableAcquisitionFailure = (error: unknown) =>
  error instanceof ResourceBusyError ||
  (error instanceof RepoStorageError && error.code === 'unavailable') ||
  (error instanceof RepoTransportError && error.retryable);

const safeErrorKind = (error: unknown) =>
  error instanceof RepoStorageError
    ? `RepoStorageError:${error.code}`
    : error instanceof RepoTransportError
      ? `RepoTransportError:${error.code}`
      : error instanceof Error
        ? error.name
        : 'UnknownError';

const logFailure = (logger: Logger, workspaceId: WorkspaceId, error: unknown) => {
  try {
    logger.debug(`[${workspaceId}] Catalog reader failed: ${safeErrorKind(error)}`);
  } catch {
    // Diagnostics must not change reader ownership or retry behavior.
  }
};

const raceWithAbort = <A>(promise: Promise<A>, signal: AbortSignal) => {
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<{ kind: 'aborted' }>((resolve) => {
    if (signal.aborted) {
      resolve({ kind: 'aborted' });
      return;
    }
    onAbort = () => resolve({ kind: 'aborted' });
    signal.addEventListener('abort', onAbort, { once: true });
  });
  return Promise.race([
    promise.then((value) => ({ kind: 'value' as const, value })),
    aborted,
  ]).finally(() => {
    if (onAbort) signal.removeEventListener('abort', onAbort);
  });
};

const delayOrAbort = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, ms);
    const abort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal.addEventListener('abort', abort, { once: true });
  });

export const makeWorkspaceCatalogSync = async (
  repo: LoroRepo,
  workspaceId: WorkspaceId,
  logger: Logger,
  metaSubscription: RepoRoomSubscription
): Promise<WorkspaceCatalogSync> => {
  const held = new Map<string, CatalogRoom>();
  let closed = false;
  let metaBaseline = false;
  void metaSubscription.firstSyncedWithRemote.then(
    () => {
      metaBaseline = true;
    },
    () => {}
  );

  const acquire = async (room: CatalogRoom) => {
    let attempt = 0;
    const release = (subscription: RepoRoomSubscription) => {
      if (room.subscription !== subscription) return;
      room.subscription = null;
      subscription.unsubscribe();
    };
    while (!closed && !room.controller.signal.aborted) {
      let subscription: RepoRoomSubscription;
      try {
        const pendingJoin = repo.joinFlockDocRoom(room.id);
        const joined = await raceWithAbort(pendingJoin, room.controller.signal);
        if (joined.kind === 'aborted') {
          void pendingJoin.then(
            (lateSubscription) => lateSubscription.unsubscribe(),
            () => {}
          );
          return;
        }
        subscription = joined.value;
      } catch (error) {
        if (!isRetryableAcquisitionFailure(error)) throw error;
        logFailure(logger, workspaceId, error);
        await delayOrAbort(retryDelayMs(attempt++), room.controller.signal);
        continue;
      }

      room.subscription = subscription;
      try {
        // The Repo subscription survives transport detach/reattach. Keep one
        // reader for the daemon lifetime while each request owns only its wait.
        const synced = await raceWithAbort(
          subscription.firstSyncedWithRemote,
          room.controller.signal
        );
        if (synced.kind === 'aborted' || room.controller.signal.aborted || closed) {
          release(subscription);
          return;
        }
        room.baseline = true;
        return;
      } catch (error) {
        release(subscription);
        if (!isRetryableAcquisitionFailure(error)) throw error;
        logFailure(logger, workspaceId, error);
        await delayOrAbort(retryDelayMs(attempt++), room.controller.signal);
      }
    }
  };

  const ensure = (id: string) => {
    const prior = held.get(id);
    if (prior) return prior;
    const room: CatalogRoom = {
      id,
      controller: new AbortController(),
      subscription: null,
      baseline: false,
      completion: Promise.resolve(),
    };
    held.set(id, room);
    room.completion = acquire(room).catch((error: unknown) => {
      logFailure(logger, workspaceId, error);
      if (held.get(id) === room) held.delete(id);
    });
    return room;
  };

  const hold = async (id: string) => {
    if (closed) return;
    ensure(id);
  };

  const ready = async (id: string | undefined, timeoutMs: number) => {
    if (closed) return false;
    if (id === undefined) {
      if (metaBaseline) return true;
      if (timeoutMs <= 0) return false;
      try {
        await withTimeout(
          metaSubscription.firstSyncedWithRemote,
          timeoutMs,
          'Timeout waiting for metadata catalog baseline'
        );
        metaBaseline = true;
        return true;
      } catch {
        return false;
      }
    }

    const room = ensure(id);
    if (room.baseline) return true;
    if (timeoutMs <= 0) return false;
    try {
      await withTimeout(room.completion, timeoutMs, 'Timeout waiting for catalog baseline');
      return room.baseline;
    } catch {
      return false;
    }
  };

  const close = async () => {
    if (closed) return;
    closed = true;
    for (const room of held.values()) {
      room.controller.abort();
      room.subscription?.unsubscribe();
      room.subscription = null;
    }
    held.clear();
  };

  await hold(getWorkspaceFlockDocId(workspaceId));
  return { hold, ready, close };
};
