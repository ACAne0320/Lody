import type { LodyOperationCompletion } from '@lody/shared';
import type { InboxBatch, InboxInput } from './model';

export type SessionFenceState = {
  revision: number;
  paused: number;
  blocked: number;
  active_execution: string | null;
  active_input: string | null;
};
export const inputAcceptance = (
  kind: InboxInput['kind'],
  paused: boolean,
  previousCanceled?: boolean
): 'accept' | 'duplicate' | 'reject' =>
  previousCanceled !== undefined
    ? previousCanceled
      ? 'reject'
      : 'duplicate'
    : kind === 'task' && paused
      ? 'reject'
      : 'accept';

export const canFenceBatch = (
  state: SessionFenceState,
  batch: InboxBatch,
  id: string,
  currentOwner: boolean,
  inputCanceled: boolean,
  count: number
): boolean =>
  currentOwner &&
  !state.paused &&
  !state.blocked &&
  (batch.kind === 'automatic' ? state.revision === batch.revision : !inputCanceled) &&
  state.active_input === batch.inputId &&
  state.active_execution === id &&
  count > 0 &&
  count === batch.memberCount;

/** Preserve queryable cancellation, but user Stop is not an Agent continuation. */
export const operationInboxCompletion = (
  completion: LodyOperationCompletion
): LodyOperationCompletion | undefined => {
  if (completion.type !== 'result') return completion;
  const items = completion.value.items.filter(
    (item) => item.status !== 'cancelled' || item.cancellationReason !== 'user_stop'
  );
  if (items.length === completion.value.items.length) return completion;
  return items.length ? { ...completion, value: { ...completion.value, items } } : undefined;
};
