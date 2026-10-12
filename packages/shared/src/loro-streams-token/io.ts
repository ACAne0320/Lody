import { Cause, Data, Effect, Exit } from 'effect';

/** Retained after a cancellation that did not stop the actual external operation. */
export interface LoroStreamsRawOwner {
  readonly label: string;
  readonly settled: () => boolean;
  readonly abort: () => void;
  readonly awaitSettled: Effect.Effect<void>;
}

export class LoroStreamsTokenReleaseFailed extends Data.TaggedError(
  'LoroStreamsTokenReleaseFailed'
)<{ readonly owner: LoroStreamsRawOwner; readonly message: string }> {}

/** Only used at real Promise I/O / explicitly registered Legacy credential boundaries. */
export function makeLoroStreamsRawIo(cleanupTimeoutMs: number) {
  if (
    !Number.isFinite(cleanupTimeoutMs) ||
    cleanupTimeoutMs <= 0 ||
    cleanupTimeoutMs > 2_147_483_647 / 3
  ) {
    throw new RangeError('Streams cleanup base must be finite, positive and timer-safe');
  }
  const pending = new Set<LoroStreamsRawOwner>();
  const join = (owner: LoroStreamsRawOwner) =>
    Effect.raceFirst(
      Effect.interruptible(owner.awaitSettled),
      Effect.sleep(cleanupTimeoutMs).pipe(
        Effect.andThen(
          Effect.die(
            new LoroStreamsTokenReleaseFailed({
              owner,
              message: `Loro Streams ${owner.label} cleanup did not settle`,
            })
          )
        )
      )
    );
  const fromPromise = <A, E>(
    label: string,
    start: (signal: AbortSignal) => PromiseLike<A>,
    failure: (error: unknown) => E
  ): Effect.Effect<A, E> =>
    Effect.callback<A, E>((resume) => {
      const controller = new AbortController();
      let settled = false;
      const observers = new Set<() => void>();
      const owner: LoroStreamsRawOwner = {
        label,
        settled: () => settled,
        abort: () => controller.abort(),
        awaitSettled: Effect.callback<void>((done) => {
          if (settled) {
            done(Effect.void);
            return Effect.void;
          }
          const notify = () => done(Effect.void);
          observers.add(notify);
          return Effect.sync(() => observers.delete(notify));
        }),
      };
      pending.add(owner);
      const complete = (result: Effect.Effect<A, E>) => {
        settled = true;
        pending.delete(owner);
        for (const notify of observers) notify();
        observers.clear();
        resume(result);
      };
      try {
        // Creation and observation are in the same register step. The raw receipt
        // survives interruption; cancellation is not proof that the Promise ended.
        start(controller.signal).then(
          (value) => complete(Effect.succeed(value)),
          (error) => complete(Effect.fail(failure(error)))
        );
      } catch (error) {
        complete(Effect.fail(failure(error)));
      }
      return Effect.gen(function* () {
        if (settled) return;
        controller.abort();
        yield* join(owner);
      });
    });
  return {
    fromPromise,
    hasPending: () => pending.size > 0,
    cleanup: Effect.suspend(() => {
      const owners = [...pending];
      for (const owner of owners) owner.abort();
      return Effect.gen(function* () {
        const exits = yield* Effect.forEach(owners, (owner) => join(owner).pipe(Effect.exit), {
          concurrency: 'unbounded',
        });
        const failures = exits.filter(Exit.isFailure);
        if (failures.length)
          return yield* Effect.failCause(
            failures
              .map((failure) => failure.cause)
              .reduce((left, right) => Cause.combine(left, right))
          );
        return undefined;
      });
    }),
  };
}
