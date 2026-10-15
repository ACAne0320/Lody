import { Data, Effect, Schema } from 'effect';
import type { makeSqliteKeyDistribution } from '@lody/e2ee-core/keys/host/distribution/sqlite';

export type LabKeyDistribution = Effect.Success<ReturnType<typeof makeSqliteKeyDistribution>>;
/** Each core queue has its own keyset; these are caller hints, never durable cursors. */
const hashCursor = Schema.optional(
  Schema.NullOr(Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/)))
);
const repairCursor = Schema.optional(
  Schema.NullOr(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)))
);
export const LabKeyRoundCursors = Schema.Struct({
  repairs: repairCursor,
  resumed: hashCursor,
  received: Schema.optional(
    Schema.NullOr(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(1024)))
  ),
  reportsBeforeSend: hashCursor,
  reconciliation: hashCursor,
  delivered: hashCursor,
  reportsAfterSend: hashCursor,
  repairResults: repairCursor,
  deliveryResults: hashCursor,
});
export type LabKeyRoundCursors = typeof LabKeyRoundCursors.Type;
export class LabKeyRoundError extends Data.TaggedError('LabKeyRoundError')<{
  readonly code: 'invalid-limit' | 'invalid-owner' | 'invalid-cursor';
}> {}
/** One finite application event, borrowing an already scoped public owner. No
 * timer, native handle, ledger decision, cursor store or crypto implementation.
 * The caller keeps its scope alive until this Effect has settled. Errors propagate;
 * next is returned only after install/report/send phases finish. Blocked native
 * tasks and each independent page cursor stay explicit, never fabricated success. */
export function runLabKeyRound(
  distribution: LabKeyDistribution,
  limit = 100,
  cursors: LabKeyRoundCursors = {}
) {
  return Effect.gen(function* () {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      return yield* new LabKeyRoundError({ code: 'invalid-limit' });
    const pages = yield* Effect.fromResult(
      Schema.decodeUnknownResult(LabKeyRoundCursors)(cursors)
    ).pipe(Effect.mapError(() => new LabKeyRoundError({ code: 'invalid-cursor' })));
    // Capture once before any await; changing a caller's methods later cannot
    // redirect a later phase away from this borrowed owner.
    const owner = yield* Effect.try({
      try: () =>
        Object.freeze({
          repair: distribution.flushRepairs.bind(distribution),
          resume: distribution.resume.bind(distribution),
          receive: distribution.fetchAndInstall.bind(distribution),
          reports: distribution.flushReports.bind(distribution),
          reconcile: distribution.reconcileCurrentEpoch.bind(distribution),
          send: distribution.resumePendingDeliveries.bind(distribution),
          results: distribution.results.bind(distribution),
          repairResults: distribution.repairResults.bind(distribution),
          deliveryResults: distribution.deliveryResults.bind(distribution),
        }),
      catch: () => new LabKeyRoundError({ code: 'invalid-owner' }),
    });
    const repairs = yield* owner.repair(limit, pages.repairs);
    const resumed = yield* owner.resume(limit, pages.resumed);
    const received = yield* owner.receive(pages.received, limit);
    const reportsBeforeSend = yield* owner.reports(limit, pages.reportsBeforeSend);
    const scheduled = yield* owner.reconcile(limit, pages.reconciliation);
    const delivered = yield* owner.send(limit, pages.delivered);
    const reportsAfterSend = yield* owner.reports(limit, pages.reportsAfterSend);
    return {
      scheduled: scheduled.scheduled,
      received: received.processed,
      next: received.next,
      repairs,
      resumed,
      reportsBeforeSend,
      reconciliation: scheduled,
      delivered,
      reportsAfterSend,
      results: yield* owner.results(limit),
      repairResults: yield* owner.repairResults(limit, pages.repairResults),
      deliveryResults: yield* owner.deliveryResults(limit, pages.deliveryResults),
    };
  });
}
