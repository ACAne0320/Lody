import { Data, Effect } from 'effect';
import type { makeSqliteKeyDistribution } from '@lody/e2ee-core/keys/host/distribution/sqlite';

export type LabKeyDistribution = Effect.Success<ReturnType<typeof makeSqliteKeyDistribution>>;
export class LabKeyRoundError extends Data.TaggedError('LabKeyRoundError')<{
  readonly code: 'invalid-limit' | 'invalid-owner';
}> {}
/** One finite application event, borrowing an already scoped public owner. No
 * timer, native handle, ledger decision, cursor store or crypto implementation.
 * The caller keeps its scope alive until this Effect has settled. Errors propagate;
 * next is returned only after install/report/send phases finish. Blocked native
 * tasks and each independent page cursor stay explicit, never fabricated success. */
export function runLabKeyRound(distribution: LabKeyDistribution, limit = 100) {
  return Effect.gen(function* () {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      return yield* new LabKeyRoundError({ code: 'invalid-limit' });
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
          deliveryResults: distribution.deliveryResults.bind(distribution),
        }),
      catch: () => new LabKeyRoundError({ code: 'invalid-owner' }),
    });
    const repairs = yield* owner.repair(limit);
    const resumed = yield* owner.resume(limit);
    const received = yield* owner.receive(null, limit);
    const reportsBeforeSend = yield* owner.reports(limit);
    const scheduled = yield* owner.reconcile(limit);
    const delivered = yield* owner.send(limit);
    const reportsAfterSend = yield* owner.reports(limit);
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
      deliveryResults: yield* owner.deliveryResults(limit),
    };
  });
}
