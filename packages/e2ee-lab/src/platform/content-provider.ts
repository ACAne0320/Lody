import { Effect, Layer } from 'effect';
import { PayloadProtectionError, type PayloadProtectionProvider } from '@loro-dev/streams-crdt';
import { makeStreamsUpdateBinding } from '@lody/e2ee-core/content/streams';
import { LegacyLabRun } from './run';

/** Lab-only Promise/SDK callback boundary. No injected runner, verifier or alternate core.
 * The surrounding Scope owns this adapter before its SDK transports/Wasm owners are released.
 * Snapshot support remains an explicit pending protocol decision. */
export function makeLabUpdateProvider(input: Parameters<typeof makeStreamsUpdateBinding>[0]) {
  return Effect.gen(function* () {
    const binding = yield* makeStreamsUpdateBinding(input);
    let closed = false;
    // Registered after binding: reject callbacks and interrupt/await owned fibers first.
    const owner = yield* Effect.acquireRelease(
      Effect.sync(() => new LegacyLabRun(Layer.empty)),
      (run) =>
        Effect.gen(function* () {
          closed = true;
          yield* Effect.promise(() => run.close());
        })
    );
    const failure = (cause: unknown, operation: 'seal' | 'open') => {
      if (cause instanceof PayloadProtectionError) return cause;
      const code = cause && typeof cause === 'object' && 'code' in cause ? cause.code : undefined;
      return new PayloadProtectionError(
        code === 'unsupported-streams-context'
          ? 'wrong_payload_kind'
          : code === 'missing-read-key'
            ? 'missing_read_key'
            : operation === 'seal'
              ? 'encrypt_failed'
              : 'decrypt_failed',
        'Lab protected content operation failed'
      );
    };
    return Object.freeze({
      maxSealOverheadBytes: binding.maxSealOverheadBytes,
      async seal(request) {
        if (closed) throw new PayloadProtectionError('encrypt_failed', 'Lab provider is closed');
        try {
          const value = await owner.run(binding.seal(request));
          if (closed) throw new PayloadProtectionError('encrypt_failed', 'Lab provider is closed');
          return value;
        } catch (cause) {
          throw failure(cause, 'seal');
        }
      },
      async open(request) {
        if (closed) throw new PayloadProtectionError('decrypt_failed', 'Lab provider is closed');
        try {
          const plaintext = await owner.run(binding.open(request));
          if (closed) {
            plaintext.fill(0);
            throw new PayloadProtectionError('decrypt_failed', 'Lab provider is closed');
          }
          return plaintext;
        } catch (cause) {
          throw failure(cause, 'open');
        }
      },
    } satisfies PayloadProtectionProvider);
  });
}
