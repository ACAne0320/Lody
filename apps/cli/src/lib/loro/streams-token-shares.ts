import { Deferred, Effect, Exit, Fiber, Scope } from 'effect';
import { LoroStreamsTokenError, type LoroStreamsTokenProvider } from '@lody/shared';

type Share = {
  readonly provider: LoroStreamsTokenProvider;
  readonly scope: Scope.Closeable;
  leases: number;
};

const closedError = () =>
  new LoroStreamsTokenError({ reason: 'closed', message: 'Loro Streams token provider closed' });

/**
 * One Streams token kernel per workspace in this process. Durable sync, presence
 * and Machine RPC borrow it, so they share its cache, refresh lease and rejected
 * token handling instead of each fetching on a cold start or reconnect.
 *
 * Each borrower gets its own view: closing a view fences and interrupts only that
 * view's reads. The last view's close closes the kernel; a failed kernel close
 * keeps its owner in the reported Cause for `retryCleanup`, as an owned kernel did.
 * Release and credential failures of the shared kernel are visible to every view.
 */
export function makeStreamsTokenShares(
  make: (workspaceId: string) => Effect.Effect<LoroStreamsTokenProvider, never, Scope.Scope>
) {
  const shares = new Map<string, Share>();

  const release = (workspaceId: string, share: Share) =>
    Effect.suspend(() => {
      share.leases--;
      if (share.leases > 0) return Effect.void;
      if (shares.get(workspaceId) === share) shares.delete(workspaceId);
      // The kernel finalizer in this Scope is its own memoized close.
      return share.provider.close.pipe(Effect.andThen(Scope.close(share.scope, Exit.void)));
    });

  const view = Effect.fnUntraced(function* (workspaceId: string, share: Share, joined: boolean) {
    const reads = yield* Scope.make();
    let closed = false;
    let receipt: Deferred.Deferred<void> | undefined;
    // A borrower joining a kernel that holds a terminal 401/403 (for example a
    // reattach after workspace access was restored) gets one fresh admission on its
    // first read, as a per-consumer kernel did. The borrower's own retry policy
    // bounds how often that happens; existing borrowers stay fenced until then.
    let admission: Effect.Effect<void> = joined
      ? Effect.flatMap(share.provider.health, (health) =>
          health.terminalAuthStatus === undefined
            ? Effect.void
            : share.provider.invalidate('manual')
        )
      : Effect.void;
    const getToken: LoroStreamsTokenProvider['getToken'] = (context) =>
      Effect.uninterruptibleMask((restore) =>
        Effect.suspend(() => {
          if (closed) return Effect.fail(closedError());
          const admit = admission;
          admission = Effect.void;
          return admit.pipe(
            Effect.andThen(
              Effect.forkIn(Effect.interruptible(share.provider.getToken(context)), reads)
            ),
            Effect.flatMap((read) =>
              restore(Fiber.join(read)).pipe(Effect.onInterrupt(() => Fiber.interrupt(read)))
            )
          );
        })
      );
    const close = Effect.uninterruptible(
      Effect.gen(function* () {
        if (receipt) return yield* Deferred.await(receipt);
        const done = Deferred.makeUnsafe<void>();
        receipt = done;
        closed = true;
        // Interrupts this view's reads; the kernel bounds each reader's own cleanup.
        const exit = yield* Scope.close(reads, Exit.void).pipe(
          Effect.andThen(release(workspaceId, share)),
          Effect.exit
        );
        yield* Deferred.done(done, exit);
        return yield* exit;
      })
    );
    const borrowed: LoroStreamsTokenProvider = {
      getToken,
      createAuthCallback: () => {
        let lastToken: string | undefined;
        return (context) =>
          getToken(
            context?.reason === 'unauthorized'
              ? { ...context, previousToken: context.previousToken ?? lastToken }
              : context
          ).pipe(
            Effect.tap((token) =>
              Effect.sync(() => {
                lastToken = token;
              })
            )
          );
      },
      health: share.provider.health,
      invalidate: share.provider.invalidate,
      getGatewayBaseUrl: share.provider.getGatewayBaseUrl,
      getShardHostSuffix: share.provider.getShardHostSuffix,
      close,
      retryCleanup: share.provider.retryCleanup,
    };
    return borrowed;
  });

  /** Borrows the workspace kernel, creating it on first use. The caller owns the view. */
  const borrow = (workspaceId: string) =>
    Effect.uninterruptible(
      Effect.gen(function* () {
        const existing = shares.get(workspaceId);
        if (existing) {
          existing.leases++;
          return yield* view(workspaceId, existing, true);
        }
        const scope = yield* Scope.make();
        const provider = yield* Scope.provide(make(workspaceId), scope);
        const raced = shares.get(workspaceId);
        if (raced) {
          // Another borrower created it while this kernel was built; this one never ran.
          yield* provider.close.pipe(Effect.andThen(Scope.close(scope, Exit.void)), Effect.orDie);
          raced.leases++;
          return yield* view(workspaceId, raced, true);
        }
        const share: Share = { provider, scope, leases: 1 };
        shares.set(workspaceId, share);
        return yield* view(workspaceId, share, false);
      })
    );

  return {
    borrow,
    /** Native consumers: the view closes with the consumer's Scope. */
    acquire: (workspaceId: string) =>
      Effect.uninterruptible(
        Effect.gen(function* () {
          const borrowed = yield* borrow(workspaceId);
          yield* Effect.addFinalizer(() => borrowed.close);
          return borrowed;
        })
      ),
  };
}
