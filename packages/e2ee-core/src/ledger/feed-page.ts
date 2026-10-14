import { Data, Result } from 'effect';
import { MAX_RECORD_BYTES } from '../cbor';
import {
  extendLedger,
  hashRecordBytes,
  requireLedgerContinuation,
  type LedgerView,
  type LedgerCheckpoint,
} from './index';

export class LedgerFeedError extends Data.TaggedError('LedgerFeedError')<{
  readonly cause?: unknown;
  readonly code:
    | 'invalid-frame'
    | 'read-too-large'
    | 'invalid-offset'
    | 'offset-mismatch'
    | 'incomplete-frame'
    | 'wrong-parent'
    | 'closed'
    | 'storage'
    | 'corrupt'
    | 'conflict'
    | 'transport';
}> {}
export const validLedgerOffset = (offset: unknown): offset is string =>
  typeof offset === 'string' &&
  offset.length > 0 &&
  offset.length <= 1024 &&
  offset.trim() === offset &&
  !offset.includes('\r') &&
  !offset.includes('\n') &&
  !offset.includes('\0');
export interface LedgerReadPage {
  readonly requestOffset: string;
  readonly nextOffset: string;
  readonly records: readonly Uint8Array[];
  readonly upToDate: boolean;
}
export interface LedgerFeedState {
  readonly view: LedgerView;
  readonly offset: string;
  readonly bootstrap: boolean;
}
export function frameLedgerRecord(record: Uint8Array): Result.Result<Uint8Array, LedgerFeedError> {
  if (!(record instanceof Uint8Array) || record.length === 0 || record.length > MAX_RECORD_BYTES)
    return Result.fail(new LedgerFeedError({ code: 'invalid-frame' }));
  const frame = new Uint8Array(4 + record.length);
  new DataView(frame.buffer).setUint32(0, record.length, false);
  frame.set(record, 4);
  return Result.succeed(frame);
}
/** Caller persists the resulting verified state AND transport position atomically.
 * No hash-based known-record skipping: an old record at a new position is not an increment.
 * Only the initial exact genesis occurrence can bind a newly created genesis-only feed. */
export function prepareLedgerPage(
  state: LedgerFeedState,
  page: LedgerReadPage,
  expected: LedgerCheckpoint
) {
  return Result.gen(function* () {
    yield* Result.mapError(
      requireLedgerContinuation(state.view, state.view),
      () => new LedgerFeedError({ code: 'wrong-parent' })
    );
    if (
      typeof state.bootstrap !== 'boolean' ||
      !validLedgerOffset(state.offset) ||
      !validLedgerOffset(page.requestOffset) ||
      !validLedgerOffset(page.nextOffset) ||
      typeof page.upToDate !== 'boolean'
    )
      return yield* Result.fail(new LedgerFeedError({ code: 'invalid-offset' }));
    if (page.requestOffset !== state.offset)
      return yield* Result.fail(new LedgerFeedError({ code: 'offset-mismatch' }));
    if (!Array.isArray(page.records) || page.records.length > 4096)
      return yield* Result.fail(new LedgerFeedError({ code: 'read-too-large' }));
    let bytes = 0;
    const records: Uint8Array[] = [];
    for (const row of page.records) {
      if (!(row instanceof Uint8Array) || row.length === 0 || row.length > MAX_RECORD_BYTES)
        return yield* Result.fail(new LedgerFeedError({ code: 'invalid-frame' }));
      bytes += row.length;
      if (bytes > 16 * 1024 * 1024)
        return yield* Result.fail(new LedgerFeedError({ code: 'read-too-large' }));
      records.push(new Uint8Array(row));
    }
    if (records.length === 0) {
      // An unauthenticated empty-position jump cannot prove progress or rewind the durable cursor.
      if (page.nextOffset !== state.offset || !page.upToDate)
        return yield* Result.fail(new LedgerFeedError({ code: 'invalid-offset' }));
      if (!state.view.head.equals(expected.head) || state.view.length !== expected.length)
        return yield* Result.fail(new LedgerFeedError({ code: 'wrong-parent' }));
      return { view: state.view, offset: state.offset, bootstrap: state.bootstrap };
    }
    if (page.nextOffset === state.offset)
      return yield* Result.fail(new LedgerFeedError({ code: 'invalid-offset' }));
    let start = 0;
    if (state.bootstrap) {
      if (
        state.offset !== '-1' ||
        state.view.verification !== 'full-history' ||
        state.view.length !== 1 ||
        !state.view.head.equals(hashRecordBytes(records[0]!))
      )
        return yield* Result.fail(new LedgerFeedError({ code: 'wrong-parent' }));
      start = 1;
    }
    const view = yield* Result.mapError(
      extendLedger(state.view, records.slice(start), expected),
      () => new LedgerFeedError({ code: 'wrong-parent' })
    );
    return { view, offset: page.nextOffset, bootstrap: false };
  });
}
