import { Data, Deferred, Effect, Result } from 'effect';
import * as Bytes from '../bytes';
import { disposeEpochKey } from '../epoch-key';
import { epochHistoryPacket, requireLedgerContinuation, type LedgerView } from '../ledger';
import { recoverLedgerHistory } from './history';
import type { makeSqliteProtectedEpochKeys } from './protected-sqlite';
export class InstalledHistoryError extends Data.TaggedError('InstalledHistoryError')<{
  readonly code: 'closed' | 'context';
}> {}
/** Trusted initialization borrows the existing installed-key store, never secret
 * bytes or per-call protector callbacks. Recover only from a legally installed
 * latest key and genuine signed packets, not historical sender envelopes/vault.
 * Full cryptographic chain validates before any durable saves; a storage failure
 * remains failure with safe idempotent partial originals, never "all recovered". */
export const makeInstalledEpochHistory = Effect.fnUntraced(function* (input: {
  readonly genesis: Bytes.GenesisHash;
  readonly ledger: () => Effect.Effect<LedgerView, unknown>;
  readonly installed: Effect.Success<ReturnType<typeof makeSqliteProtectedEpochKeys>>;
}) {
  const anchor = yield* Effect.fromResult(Bytes.genesisHash(input.genesis.toBytes()));
  const lookup = input.ledger,
    read = input.installed.read.bind(input.installed),
    save = input.installed.saveAndReload.bind(input.installed);
  let closed = false,
    observed: LedgerView | undefined;
  const active = new Set<Deferred.Deferred<void>>();
  yield* Effect.addFinalizer(() =>
    Effect.gen(function* () {
      closed = true;
      for (const done of active) yield* Deferred.await(done);
    })
  );
  const current = () =>
    Effect.gen(function* () {
      if (closed) return yield* new InstalledHistoryError({ code: 'closed' });
      const view = yield* lookup();
      yield* Effect.fromResult(epochHistoryPacket(view, 0));
      if (!view.genesis.equals(anchor))
        return yield* new InstalledHistoryError({ code: 'context' });
      if (observed) yield* Effect.fromResult(requireLedgerContinuation(observed, view));
      observed = view;
      if (closed) return yield* new InstalledHistoryError({ code: 'closed' });
      return view;
    });
  const lease = <A, E, R>(work: Effect.Effect<A, E, R>) =>
    Effect.acquireUseRelease(
      Effect.gen(function* () {
        if (closed) return yield* new InstalledHistoryError({ code: 'closed' });
        const done = yield* Deferred.make<void>();
        active.add(done);
        return done;
      }),
      () => work,
      (done) =>
        Effect.sync(() => {
          active.delete(done);
          Deferred.doneUnsafe(done, Effect.void);
        })
    );
  const recover = (view: LedgerView) =>
    Effect.acquireUseRelease(
      read(view.inspectState().epoch.number),
      (latest) =>
        Effect.acquireUseRelease(
          Effect.fromResult(recoverLedgerHistory(view, latest)),
          (keys) =>
            Effect.gen(function* () {
              for (const [epoch, key] of keys) {
                yield* current();
                yield* save(epoch, key);
              }
              return [...keys.keys()];
            }),
          (keys) =>
            Effect.sync(() => {
              for (const key of keys.values()) disposeEpochKey(key);
            })
        ),
      (latest) => Effect.sync(() => disposeEpochKey(latest))
    );
  return Object.freeze({
    recover: () =>
      lease(
        Effect.gen(function* () {
          return yield* recover(yield* current());
        })
      ),
    /** Transfers a fresh owned opaque key, preserving the existing read contract. */
    read: (epoch: number) =>
      lease(
        Effect.gen(function* () {
          const view = yield* current();
          const existing = yield* Effect.result(read(epoch));
          if (Result.isSuccess(existing)) {
            if (closed) {
              disposeEpochKey(existing.success);
              return yield* new InstalledHistoryError({ code: 'closed' });
            }
            return existing.success;
          }
          // Retry only genuine missing installed data, never corrupt/permission/storage failures.
          if (
            !(
              existing.failure &&
              typeof existing.failure === 'object' &&
              'code' in existing.failure &&
              existing.failure.code === 'missing-key'
            )
          )
            return yield* Effect.fail(existing.failure);
          yield* Effect.fromResult(Bytes.epochNumber(epoch));
          if (epoch > view.inspectState().epoch.number) return yield* Effect.fail(existing.failure);
          yield* recover(view);
          const recovered = yield* read(epoch);
          if (closed) {
            disposeEpochKey(recovered);
            return yield* new InstalledHistoryError({ code: 'closed' });
          }
          return recovered;
        })
      ),
  });
});
