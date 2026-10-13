import { Data, Deferred, Effect, Exit, Result } from 'effect';
import * as Bytes from '../bytes';
import { bytesEqual } from '../cbor';
import { copyEpochKeyBytes, disposeEpochKey } from '../epoch-key';
import { keyId } from '../identifiers';
import { epochHistoryPacket, requireLedgerContinuation, type LedgerView } from '../ledger';
import { commitEpochKey } from './history';

export class ProtectionError extends Data.TaggedError('ProtectionError')<{
  readonly code:
    | 'closed'
    | 'invalid-input'
    | 'unauthorized'
    | 'commitment-mismatch'
    | 'native-failed'
    | 'binding-mismatch';
}> {}
/** Trusted host-only capability. Must authenticate and encrypt the entire supplied body.
 * A compromised host can retain plaintext; ordinary consumers never choose these callbacks.
 * The returned decrypt buffer is owned by this operation and will be cleared. */
export interface NativeEpochProtector {
  readonly protect: (body: Uint8Array) => Promise<Uint8Array>;
  readonly unprotect: (blob: Uint8Array) => Promise<Uint8Array>;
}
const purpose = new TextEncoder().encode('lody-e2ee/local-epoch-key/v1\0');
const HEADER = purpose.length + 32 + 32 + 4 + 32;
const SIZE = HEADER + 32;
export const MAX_PROTECTED_EPOCH_BYTES = 8192;
const error = (code: ProtectionError['code']) => new ProtectionError({ code });
const validBlob = (blob: unknown): blob is Uint8Array =>
  blob instanceof Uint8Array && blob.length > 0 && blob.length <= MAX_PROTECTED_EPOCH_BYTES;

/** Initialize once in application Scope, with independently verified ledger lookup.
 * No wrapping algorithm, OS adapter, recovery format or production assembly is chosen here. */
export function makeHostEpochProtection(input: {
  readonly genesis: Bytes.GenesisHash;
  readonly recipient: Bytes.SigningPublicKey;
  readonly ledger: () => Effect.Effect<LedgerView, unknown>;
  readonly protector: NativeEpochProtector;
}) {
  return Effect.gen(function* () {
    const anchor = yield* Effect.fromResult(Bytes.genesisHash(input.genesis.toBytes()));
    const recipient = yield* Effect.fromResult(Bytes.signingPublicKey(input.recipient.toBytes()));
    const lookup = input.ledger;
    const protect = input.protector.protect.bind(input.protector);
    const unprotect = input.protector.unprotect.bind(input.protector);
    let closed = false;
    let observed: LedgerView | undefined;
    const pending = new Set<Deferred.Deferred<void>>();
    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        closed = true;
        for (const lease of pending) yield* Deferred.await(lease);
      })
    );
    const lease = <A, E>(work: Effect.Effect<A, E>) =>
      Effect.acquireUseRelease(
        Effect.gen(function* () {
          if (closed) return yield* error('closed');
          const done = yield* Deferred.make<void>();
          pending.add(done);
          return done;
        }),
        () => work,
        (done) =>
          Effect.gen(function* () {
            pending.delete(done);
            yield* Deferred.succeed(done, undefined);
          })
      );
    const expected = (epoch: number) =>
      Effect.gen(function* () {
        if (closed) return yield* error('closed');
        yield* Effect.fromResult(
          Result.mapError(Bytes.epochNumber(epoch), () => error('invalid-input'))
        );
        const view = yield* lookup().pipe(Effect.mapError(() => error('unauthorized')));
        if (closed) return yield* error('closed');
        yield* Effect.fromResult(
          Result.mapError(requireLedgerContinuation(view, view), () => error('unauthorized'))
        );
        if (
          !anchor.equals(view.genesis) ||
          (observed && Result.isFailure(requireLedgerContinuation(observed, view)))
        )
          return yield* error('unauthorized');
        observed = view;
        const packet = yield* Effect.fromResult(
          Result.mapError(epochHistoryPacket(view, epoch), () => error('unauthorized'))
        );
        const state = view.inspectState();
        const device = state.devices.get(keyId(recipient.toBytes()));
        if (!device || !state.members.has(keyId(device.membershipId.toBytes())))
          return yield* error('unauthorized');
        return packet.commitment;
      });
    const header = (epoch: number, commitment: Bytes.EpochCommitment) => {
      const body = new Uint8Array(SIZE);
      body.set(purpose);
      body.set(anchor.toBytes(), purpose.length);
      body.set(recipient.toBytes(), purpose.length + 32);
      new DataView(body.buffer).setUint32(purpose.length + 64, epoch);
      body.set(commitment.toBytes(), purpose.length + 68);
      return body;
    };
    const commitment = (epoch: number, key: Bytes.EpochKey) =>
      Effect.fromResult(
        Result.mapError(commitEpochKey(anchor, epoch, key), () => error('invalid-input'))
      );
    return Object.freeze({
      seal: (epoch: number, key: Bytes.EpochKey) =>
        lease(
          Effect.gen(function* () {
            const expectedCommitment = yield* expected(epoch);
            if (!expectedCommitment.equals(yield* commitment(epoch, key)))
              return yield* error('commitment-mismatch');
            const blob = yield* Effect.acquireUseRelease(
              Effect.try({
                try: () => {
                  const body = header(epoch, expectedCommitment);
                  const raw = copyEpochKeyBytes(key);
                  try {
                    body.set(raw, HEADER);
                  } finally {
                    raw.fill(0);
                  }
                  return body;
                },
                catch: () => error('invalid-input'),
              }),
              (body) =>
                Effect.uninterruptible(
                  Effect.tryPromise({
                    try: () => protect(body),
                    catch: () => error('native-failed'),
                  })
                ).pipe(
                  Effect.flatMap((protectedBlob) =>
                    validBlob(protectedBlob)
                      ? Effect.succeed(new Uint8Array(protectedBlob))
                      : Effect.fail(error('invalid-input'))
                  )
                ),
              (body) => Effect.sync(() => body.fill(0))
            );
            if (!expectedCommitment.equals(yield* expected(epoch)))
              return yield* error('commitment-mismatch');
            return blob;
          })
        ),
      open: (epoch: number, inputBlob: Uint8Array) =>
        Effect.suspend(() => {
          if (!validBlob(inputBlob)) return Effect.fail(error('invalid-input'));
          const blob = new Uint8Array(inputBlob);
          return lease(
            Effect.gen(function* () {
              const expectedCommitment = yield* expected(epoch);
              return yield* Effect.acquireUseRelease(
                // Acquisition is uninterruptible: cleanup is registered before a native result can be abandoned.
                Effect.tryPromise({
                  try: () => unprotect(blob),
                  catch: () => error('native-failed'),
                }),
                (body) =>
                  Effect.gen(function* () {
                    if (
                      !(body instanceof Uint8Array) ||
                      body.length !== SIZE ||
                      !bytesEqual(
                        body.subarray(0, HEADER),
                        header(epoch, expectedCommitment).subarray(0, HEADER)
                      )
                    )
                      return yield* error('binding-mismatch');
                    return yield* Effect.acquireUseRelease(
                      Effect.fromResult(
                        Result.mapError(Bytes.epochKey(body.subarray(HEADER)), () =>
                          error('invalid-input')
                        )
                      ),
                      (key) =>
                        Effect.gen(function* () {
                          if (!expectedCommitment.equals(yield* commitment(epoch, key)))
                            return yield* error('commitment-mismatch');
                          if (!expectedCommitment.equals(yield* expected(epoch)))
                            return yield* error('commitment-mismatch');
                          return key;
                        }),
                      (key, exit) =>
                        Effect.sync(() => {
                          if (!Exit.isSuccess(exit)) disposeEpochKey(key);
                        })
                    );
                  }),
                (body) =>
                  Effect.sync(() => {
                    if (body instanceof Uint8Array) body.fill(0);
                  })
              );
            })
          );
        }),
    });
  });
}
