import { Cause, Effect, Exit, Fiber, Layer, ManagedRuntime } from 'effect';
import {
  LoroStreamsTokenError,
  LoroStreamsTokenWebLive,
  type FetchLike,
  type LoroStreamsTokenProviderEvent,
} from '../loro-streams-auth';
import { LoroStreamsTokens, LoroStreamsTokensLive, type LoroStreamsTokenProvider } from './service';

/** Full Cause and retained cleanup owners remain available across the Promise boundary. */
export class LoroStreamsTokenLegacyFailure extends Error {
  constructor(readonly effectCause: Cause.Cause<unknown>) {
    super(Cause.pretty(effectCause));
    this.name = 'LoroStreamsTokenLegacyFailure';
  }
}

function project(cause: Cause.Cause<unknown>): unknown {
  if (cause.reasons.length !== 1) return new LoroStreamsTokenLegacyFailure(cause);
  const reason = cause.reasons[0];
  if (!reason) return new LoroStreamsTokenLegacyFailure(cause);
  if (Cause.isFailReason(reason)) {
    const error = reason.error;
    if (error instanceof LoroStreamsTokenError && error.cause instanceof Error) return error.cause;
    return error;
  }
  if (Cause.isDieReason(reason)) return reason.defect;
  return new LoroStreamsTokenLegacyFailure(cause);
}

/**
 * @deprecated The only execution facade for renderer/durable/Machine RPC Promise callers.
 * Delete when those owners compose LoroStreamsTokens with their application Scope.
 */
export function createLoroStreamsTokenProviderLegacy(options: {
  endpoint: string;
  workspaceId: string;
  authToken:
    | string
    | null
    | undefined
    | ((signal?: AbortSignal) => Promise<string | null | undefined> | string | null | undefined);
  fetchImpl?: FetchLike;
  refreshSkewMs?: number;
  requestTimeoutMs?: number;
  cleanupTimeoutMs?: number;
  onEvent?: (event: LoroStreamsTokenProviderEvent) => void;
}) {
  const layer = LoroStreamsTokensLive(options).pipe(
    Layer.provide(
      LoroStreamsTokenWebLive({
        credential: Effect.succeed(undefined),
        resolveCredentialLegacy: (signal) =>
          Promise.resolve(
            typeof options.authToken === 'function' ? options.authToken(signal) : options.authToken
          ),
        fetchImpl: options.fetchImpl,
        cleanupTimeoutMs: options.cleanupTimeoutMs,
      })
    )
  );
  const runtime = ManagedRuntime.make(layer);
  let provider: LoroStreamsTokenProvider | undefined;
  let closeReceipt: Promise<void> | undefined;
  let closing = false;
  const invalidations = new Set<Fiber.Fiber<void>>();
  const run = <A, E>(
    operation: (tokens: LoroStreamsTokenProvider) => Effect.Effect<A, E>,
    signal?: AbortSignal
  ): Promise<A> =>
    runtime
      .runPromiseExit(
        Effect.gen(function* () {
          const tokens = yield* LoroStreamsTokens;
          provider = tokens;
          return yield* operation(tokens);
        }),
        { signal }
      )
      .then((exit) => {
        if (Exit.isFailure(exit)) throw project(exit.cause);
        return exit.value;
      });
  return {
    getToken: (signal?: AbortSignal) => run((tokens) => tokens.getToken(), signal),
    invalidate: (reason: 'manual' | 'unauthorized' = 'manual'): void => {
      // The imperative caller retains its old synchronous signature. A failed
      // invalidation stays observable through the retained provider/close receipt.
      if (closing) throw new Error('Loro Streams token provider closed');
      const fiber = runtime.runFork(
        Effect.gen(function* () {
          const tokens = yield* LoroStreamsTokens;
          provider = tokens;
          yield* tokens.invalidate(reason);
        })
      );
      invalidations.add(fiber);
      fiber.addObserver((exit) => {
        if (Exit.isSuccess(exit)) invalidations.delete(fiber);
      });
    },
    getGatewayBaseUrl: () => provider?.getGatewayBaseUrl(),
    getShardHostSuffix: () => provider?.getShardHostSuffix(),
    createAuthCallback: () => {
      let auth: ReturnType<LoroStreamsTokenProvider['createAuthCallback']> | undefined;
      return (context?: { reason: string; previousToken?: string }, signal?: AbortSignal) =>
        run((tokens) => {
          auth ??= tokens.createAuthCallback();
          return auth(context);
        }, signal);
    },
    close: () => {
      closing = true;
      return (closeReceipt ??= run((tokens) =>
        Effect.gen(function* () {
          const closed = yield* tokens.close.pipe(Effect.exit);
          // The facade is the explicit owner of its synchronous invalidate launches.
          // Native close has already fenced admission and joined their shared producer.
          const exits = yield* Effect.forEach([...invalidations], Fiber.await);
          const failures = [closed, ...exits].filter(Exit.isFailure);
          if (failures.length)
            return yield* Effect.failCause(
              failures.map((exit) => exit.cause).reduce((left, right) => Cause.combine(left, right))
            );
          return undefined;
        })
      ).then(async () => {
        const exit = await Effect.runPromiseExit(runtime.disposeEffect);
        if (Exit.isFailure(exit)) throw project(exit.cause);
      }));
    },
    retryCleanup: () =>
      run((tokens) => tokens.retryCleanup).then(() => {
        invalidations.clear();
        closeReceipt = undefined;
      }),
  };
}
