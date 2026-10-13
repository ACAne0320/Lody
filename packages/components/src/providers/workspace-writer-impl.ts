import {
  applyPreviewVisualCommentMutation,
  buildQueuedSessionTurn,
  type SessionMeta,
  getServerNow,
  getSessionRoomId,
  type MessageQueueItem,
  type PreviewVisualCommentDocInput,
} from '@lody/shared';
import type { SessionId } from '@lody/shared/ids';
import type { LoroRepo } from 'loro-repo';
import type {
  PreviewVisualCommentDocStore,
  SessionDocDraft,
  SessionDocStore,
} from '../atoms/runtime';
import type { WorkspaceWriter } from './workspace-writer';

// # WorkspaceWriter implementation
//
// Dual-author: every client authors the mutation against its own repo / session
// stores (identical for Web, Mobile, and Electron; see `workspace-writer.ts`).
// A pure factory with injected deps so hooks stay agnostic to the runtime.

/** Deps the writer needs from the runtime (repo + session stores). */
export type DirectWorkspaceWriterDeps = {
  authorizeTurn?: (
    meta: Record<string, unknown>,
    entry: import('@lody/shared').SessionHistory
  ) => Promise<import('@lody/shared').SessionHistory>;
  authorizeProvider?: (value: unknown) => Promise<unknown>;
  authorizeMcp?: (value: unknown) => Promise<unknown>;
  repo: LoroRepo;
  acquireSessionStore: (sessionId: SessionId) => Promise<SessionDocStore>;
  releaseSessionStoreRef: (sessionId: SessionId) => void;
  acquirePreviewVisualCommentStore: (sessionId: SessionId) => Promise<PreviewVisualCommentDocStore>;
  releasePreviewVisualCommentStoreRef: (sessionId: SessionId) => void;
};

/**
 * Direct-mode writer (web/cloud): applies each mutation to the renderer's own
 * repo / session stores. This is exactly what the hooks did before the seam, so
 * there is zero behavior change in cloud mode.
 */
export function createDirectWorkspaceWriter(deps: DirectWorkspaceWriterDeps): WorkspaceWriter {
  const withSessionStore = async <T>(
    sessionId: string,
    fn: (store: SessionDocStore) => T | Promise<T>
  ): Promise<T> => {
    const id = sessionId as SessionId;
    const store = await deps.acquireSessionStore(id);
    try {
      return await fn(store);
    } finally {
      deps.releaseSessionStoreRef(id);
    }
  };

  // Renderer-side, every message-queue mutation also bumps `messageQueueUpdatedAt`
  // so the CLI dispatch watcher re-evaluates.
  const bumpMessageQueueWatermark = async (sessionId: string): Promise<void> => {
    await deps.repo.upsertDocMeta(getSessionRoomId(sessionId as SessionId), {
      messageQueueUpdatedAt: getServerNow(),
    });
  };

  const withPreviewVisualCommentStore = async <T>(
    sessionId: SessionId,
    fn: (store: PreviewVisualCommentDocStore) => T | Promise<T>
  ): Promise<T> => {
    const store = await deps.acquirePreviewVisualCommentStore(sessionId);
    try {
      return await fn(store);
    } finally {
      deps.releasePreviewVisualCommentStoreRef(sessionId);
    }
  };

  const authorizeQueueItem = async (sessionId: string, item: Record<string, unknown>) => {
    if (!deps.authorizeTurn) return item;
    const meta = await deps.repo.getDocMeta(getSessionRoomId(sessionId as SessionId));
    if (!meta?.meta || typeof item.userTurnId !== 'string' || !item.userTurnId)
      throw new Error('Queue identity is unavailable.');
    const entry = buildQueuedSessionTurn(
      item as unknown as MessageQueueItem,
      meta.meta as SessionMeta,
      item.userTurnId
    );
    if (!entry) throw new Error('Queue input is unavailable.');
    const signed = await deps.authorizeTurn(meta.meta, entry);
    return { ...item, executionAuthorization: signed.inputConfig?.executionAuthorization };
  };

  return {
    async upsertDocMeta(roomId, patch) {
      await deps.repo.upsertDocMeta(roomId, patch as Parameters<LoroRepo['upsertDocMeta']>[1]);
    },

    async startSession(sessionId, meta, entry, dispatch) {
      if (deps.authorizeTurn) entry = await deps.authorizeTurn(meta, entry);
      // Backend selection is part of the session identity. Publish metadata
      // before the first history write so a crash cannot leave an orphaned
      // document that a later opener interprets as legacy Loro.
      await deps.repo.upsertDocMeta(
        getSessionRoomId(sessionId as SessionId),
        meta as Parameters<LoroRepo['upsertDocMeta']>[1]
      );
      await withSessionStore(sessionId, async (store) => {
        await store.sessionData.commands.appendTurn(entry);
      });
      void dispatch;
    },

    async deleteDoc(roomId) {
      await deps.repo.deleteDoc(roomId);
    },

    async flockRowPut(flockDocId, key, value, options) {
      if (key[0] === 'mcpServer' && options?.authorizeMcp && deps.authorizeMcp)
        value = await deps.authorizeMcp(value);
      if (key[0] === 'agentConfig' && options?.authorizeProvider && deps.authorizeProvider)
        value = await deps.authorizeProvider(value);
      if (key[0] === 'providerSetup' && options?.authorizeProvider && deps.authorizeProvider) {
        const setup = value as { config: unknown };
        value = { ...setup, config: await deps.authorizeProvider(setup.config) };
      }
      const handle = await deps.repo.openFlockDoc(flockDocId);
      handle.flock.set([...key], value as Parameters<typeof handle.flock.set>[1]);
      handle.flock.commit();
    },

    async flockRowUpdate(flockDocId, key, update) {
      const handle = await deps.repo.openFlockDoc(flockDocId);
      return handle.flock.txn(() => {
        const next = update(handle.flock.get([...key]));
        if (next === undefined) return false;
        handle.flock.set([...key], next as Parameters<typeof handle.flock.set>[1]);
        return true;
      });
    },

    async flockRowPutIfAbsent(
      flockDocId: string,
      key: readonly string[],
      value: unknown
    ): Promise<{ inserted: boolean; value: unknown }> {
      const handle = await deps.repo.openFlockDoc(flockDocId);
      return handle.flock.txn(() => {
        const existing = handle.flock.get([...key]);
        if (existing !== undefined) {
          return { inserted: false, value: existing };
        }

        handle.flock.put([...key], value as Parameters<typeof handle.flock.put>[1]);
        return { inserted: true, value };
      });
    },

    async flockRowDelete(flockDocId, key) {
      const handle = await deps.repo.openFlockDoc(flockDocId);
      handle.flock.delete([...key]);
      handle.flock.commit();
    },

    async appendSessionTurn(sessionId, entry, dispatch) {
      if (deps.authorizeTurn && entry.role === 'user') {
        const meta = await deps.repo.getDocMeta(getSessionRoomId(sessionId as SessionId));
        if (!meta?.meta) throw new Error('Session metadata is unavailable.');
        entry = await deps.authorizeTurn(meta.meta, entry);
      }
      await withSessionStore(sessionId, async (store) => {
        await store.sessionData.commands.appendTurn(entry);
      });
      // Dispatch stays the caller's sibling side effect (Machine RPC / durable
      // pointer), matching the send hot path.
      void dispatch;
    },

    async appendSessionHistory(sessionId, entry) {
      if (deps.authorizeTurn && entry.role === 'user') {
        const meta = await deps.repo.getDocMeta(getSessionRoomId(sessionId as SessionId));
        if (!meta?.meta) throw new Error('Session metadata is unavailable.');
        entry = await deps.authorizeTurn(meta.meta, entry);
      }
      await withSessionStore(sessionId, async (store) => {
        await store.sessionData.commands.appendTurn(entry);
      });
    },

    async updateSessionHistory(sessionId, entryId, entry) {
      if (deps.authorizeTurn && entry.role === 'user') {
        const meta = await deps.repo.getDocMeta(getSessionRoomId(sessionId as SessionId));
        if (!meta?.meta) throw new Error('Session metadata is unavailable.');
        entry = await deps.authorizeTurn(meta.meta, entry);
      }
      await withSessionStore(sessionId, async (store) => {
        await store.sessionData.commands.replaceTurn(entryId, entry);
      });
    },

    async respondSessionPermission(sessionId, requestId, outcome, options) {
      await withSessionStore(sessionId, async (store) => {
        if (!(await store.sessionData.commands.respondPermission(requestId, outcome, options)))
          throw new Error('Permission request not found');
      });
    },

    async enqueueSessionMessage(sessionId, item) {
      item = await authorizeQueueItem(sessionId, item);
      await withSessionStore(sessionId, (store) => {
        store.setState((draft: SessionDocDraft) => {
          const mq = (draft.mq ?? []) as MessageQueueItem[];
          const userTurnId = item.userTurnId;
          const operationId =
            item.operationId ??
            (typeof userTurnId === 'string' && userTurnId.length > 0
              ? `queue:${userTurnId}`
              : undefined);
          draft.mq = [
            ...mq,
            {
              ...item,
              ...(operationId ? { operationId } : {}),
            } as MessageQueueItem,
          ];
        });
      });
      await bumpMessageQueueWatermark(sessionId);
    },

    async removeSessionMessage(sessionId, itemId) {
      await withSessionStore(sessionId, (store) => {
        store.setState((draft: SessionDocDraft) => {
          const mq = (draft.mq ?? []) as MessageQueueItem[];
          draft.mq = mq.filter((item) => item.$cid !== itemId);
        });
      });
      await bumpMessageQueueWatermark(sessionId);
    },

    async updateSessionMessage(sessionId, itemId, patch) {
      await withSessionStore(sessionId, async (store) => {
        const original = store.getState().mq?.find((item) => item.$cid === itemId);
        if (!original) return;
        const signed = await authorizeQueueItem(sessionId, { ...original, ...patch });
        store.setState((draft: SessionDocDraft) => {
          const mq = (draft.mq ?? []) as MessageQueueItem[];
          draft.mq = mq.map((item) =>
            item.$cid === itemId
              ? ({ ...item, ...signed, $cid: item.$cid } as MessageQueueItem)
              : item
          );
        });
      });
      await bumpMessageQueueWatermark(sessionId);
    },

    async reorderSessionMessages(sessionId, orderedItemIds) {
      await withSessionStore(sessionId, (store) => {
        store.setState((draft: SessionDocDraft) => {
          const mq = (draft.mq ?? []) as MessageQueueItem[];
          const byCid = new Map(mq.map((item) => [item.$cid, item] as const));
          const ordered: MessageQueueItem[] = [];
          for (const cid of orderedItemIds) {
            const item = byCid.get(cid);
            if (item) {
              ordered.push(item);
              byCid.delete(cid);
            }
          }
          for (const item of mq) {
            if (item.$cid !== undefined && byCid.has(item.$cid)) {
              ordered.push(item);
            }
          }
          draft.mq = ordered;
        });
      });
      await bumpMessageQueueWatermark(sessionId);
    },

    async mutatePreviewVisualComments(sessionId, mutation) {
      await withPreviewVisualCommentStore(sessionId, (store) => {
        store.setState((draft: PreviewVisualCommentDocInput) => {
          applyPreviewVisualCommentMutation(draft, mutation);
        });
      });
    },
  };
}
