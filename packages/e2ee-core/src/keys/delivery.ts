import { Context, Data, Effect, Result } from 'effect';
import { sha256 } from '@noble/hashes/sha2.js';
import * as Bytes from '../bytes';
import { encodeCbor, bytesEqual } from '../cbor';
import { keyId } from '../identifiers';
import { ContentError, type ValidationError } from '../errors';
import { requireLedgerContinuation, type LedgerView } from '../ledger';
import { type DeviceSigner } from '../signing';
import {
  authenticateEpochEnvelope,
  prepareEpochEnvelope,
  type EpochEnvelopeContext,
} from './envelope';

export class DeliveryError extends Data.TaggedError('DeliveryError')<{
  readonly code: 'storage' | 'corrupt' | 'closed' | 'missing' | 'invalid-slot';
}> {}
export class DeliveryRemoteError extends Data.TaggedError('DeliveryRemoteError')<{}> {}
/** Application-owned persistence capability. Saved ciphertext is untrusted until verified. */
export class DeliveryOutbox extends Context.Service<
  DeliveryOutbox,
  {
    readonly load: (slot: string) => Effect.Effect<Uint8Array | null, DeliveryError>;
    /** Atomically keep the first exact ciphertext. A racing loser cannot replace it. */
    readonly saveOriginal: (
      slot: string,
      frame: Uint8Array
    ) => Effect.Effect<Uint8Array, DeliveryError>;
  }
>()('@lody/e2ee-core/DeliveryOutbox') {}
/** Sender binding and host admission belong to the authenticated transport adapter. */
export class DeliveryRemote extends Context.Service<
  DeliveryRemote,
  {
    readonly put: (
      slot: string,
      frame: Uint8Array
    ) => Effect.Effect<void, DeliveryRemoteError | ContentError | ValidationError>;
    readonly read: (
      slot: string
    ) => Effect.Effect<Uint8Array | null, DeliveryRemoteError | ContentError | ValidationError>;
  }
>()('@lody/e2ee-core/DeliveryRemote') {}
export type DeliveryOutcome = {
  readonly outcome: 'Stored' | 'Pending';
  readonly slot: string;
  readonly frame: Uint8Array;
};
export function epochDeliveryId(context: EpochEnvelopeContext) {
  return Result.gen(function* () {
    const anchor = yield* Bytes.genesisHash(context.genesis.toBytes());
    const number = yield* Bytes.epochNumber(context.epoch);
    const sender = yield* Bytes.signingPublicKey(context.sender.toBytes());
    const recipient = yield* Bytes.signingPublicKey(context.recipient.toBytes());
    const value = yield* encodeCbor([
      new TextEncoder().encode('lody-e2ee/local-epoch-delivery/v0'),
      anchor.toBytes(),
      number,
      sender.toBytes(),
      recipient.toBytes(),
    ]);
    return keyId(sha256(value).subarray(0, 16));
  });
}
/** Finite delivery only; no scheduler, implicit retry, new key publication or install receipt. */
export function deliverEpochEnvelope<E, R>(input: {
  readonly context: EpochEnvelopeContext;
  readonly ledger: () => Effect.Effect<LedgerView, E, R>;
  readonly prepare?: { readonly key: Bytes.EpochKey; readonly signer: DeviceSigner };
}) {
  return Effect.suspend(() =>
    Effect.gen(function* () {
      const context = {
        genesis: yield* Effect.fromResult(Bytes.genesisHash(input.context.genesis.toBytes())),
        epoch: yield* Effect.fromResult(Bytes.epochNumber(input.context.epoch)),
        sender: yield* Effect.fromResult(Bytes.signingPublicKey(input.context.sender.toBytes())),
        recipient: yield* Effect.fromResult(
          Bytes.signingPublicKey(input.context.recipient.toBytes())
        ),
      };
      const slot = yield* Effect.fromResult(epochDeliveryId(context));
      const outbox = yield* DeliveryOutbox,
        remote = yield* DeliveryRemote;
      let seen: LedgerView | undefined;
      const currentLedger = () =>
        Effect.gen(function* () {
          const current = yield* input.ledger();
          yield* Effect.fromResult(requireLedgerContinuation(current, current));
          if (seen) yield* Effect.fromResult(requireLedgerContinuation(seen, current));
          seen = current;
          return current;
        });
      yield* currentLedger();
      const saved = yield* outbox.load(slot);
      let frame: Uint8Array;
      if (saved) {
        if (!(saved instanceof Uint8Array) || saved.length < 1 || saved.length > 512)
          return yield* new DeliveryError({ code: 'corrupt' });
        frame = new Uint8Array(saved);
      } else {
        if (!input.prepare) return yield* new DeliveryError({ code: 'missing' });
        const proposed = yield* prepareEpochEnvelope({
          context,
          key: input.prepare.key,
          signer: input.prepare.signer,
          ledger: currentLedger,
        });
        const original = yield* outbox.saveOriginal(slot, proposed);
        if (!(original instanceof Uint8Array) || original.length < 1 || original.length > 512)
          return yield* new DeliveryError({ code: 'corrupt' });
        frame = new Uint8Array(original);
      }
      // Disk and injected transport/storage capabilities cannot establish author permission.
      const view = yield* currentLedger();
      yield* Effect.fromResult(authenticateEpochEnvelope(view, context, frame));
      yield* remote
        .put(slot, new Uint8Array(frame))
        .pipe(Effect.catchTag('DeliveryRemoteError', () => Effect.void));
      const readback = yield* remote
        .read(slot)
        .pipe(Effect.catchTag('DeliveryRemoteError', () => Effect.succeed(null)));
      const observed =
        readback instanceof Uint8Array &&
        readback.length === frame.length &&
        bytesEqual(readback, frame);
      return {
        outcome: observed ? 'Stored' : 'Pending',
        slot,
        frame: new Uint8Array(frame),
      } satisfies DeliveryOutcome;
    })
  );
}
