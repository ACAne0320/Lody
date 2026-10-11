import { Cause, Data, Effect, Exit, Fiber, Scope } from 'effect';
export class LabOperationError extends Data.TaggedError('LabOperationError')<{
  readonly code: 'closed';
}> {}
/** Parent-owned child fibers for finite Lab workflows. Closing rejects admission,
 * aborts native-capability signals, interrupts and awaits every child before earlier
 * owners. One defective finalizer cannot skip the other children or hide its cause. */
export function makeLabOperations() {
  return Effect.gen(function* () {
    const controller = new AbortController();
    const active = new Set<Scope.Closeable>();
    yield* Effect.addFinalizer((parentExit) =>
      Effect.gen(function* () {
        controller.abort();
        const exits = yield* Effect.forEach(
          [...active],
          (child) => Effect.exit(Scope.close(child, parentExit)),
          { concurrency: 'unbounded' }
        );
        const reasons = exits.flatMap((exit) => (Exit.isFailure(exit) ? exit.cause.reasons : []));
        if (reasons.length > 0) yield* Effect.failCause(Cause.fromReasons(reasons));
      })
    );
    return Object.freeze({
      signal: controller.signal,
      run: <A, E, R>(work: Effect.Effect<A, E, R | Scope.Scope>) =>
        Effect.acquireUseRelease(
          Effect.try({
            try: () => {
              if (controller.signal.aborted) throw new LabOperationError({ code: 'closed' });
              const child = Scope.makeUnsafe();
              active.add(child);
              return child;
            },
            catch: () => new LabOperationError({ code: 'closed' }),
          }),
          (child) =>
            work.pipe(
              Effect.provideService(Scope.Scope, child),
              Effect.forkIn(child),
              Effect.flatMap(Fiber.join)
            ),
          (child, exit) =>
            Scope.close(child, exit).pipe(
              Effect.ensuring(
                Effect.sync(() => {
                  active.delete(child);
                })
              )
            )
        ),
    });
  });
}
