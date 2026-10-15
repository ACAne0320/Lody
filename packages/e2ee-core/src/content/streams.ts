import { Deferred, Effect, Result } from 'effect';
import type {
  PayloadProtectionOpenInput,
  PayloadProtectionSealInput,
  PayloadProtectionSealResult,
} from '@loro-dev/streams-crdt';
import * as Bytes from '../bytes';
import { disposeEpochKey } from '../epoch-key';
import { keyId } from '../identifiers';
import { ContentError } from '../errors';
import { epochHistoryPacket, requireLedgerContinuation, type LedgerView } from '../ledger';
import { commitEpochKey } from '../keys/history';
import type { DeviceSigner } from '../signing';
import {
  CONTENT_OVERHEAD_BYTES,
  MAX_CONTENT_BYTES,
  copyContentAdditionalData,
  inspectContentFrame,
  parseContentFrame,
  contentSigningBytes,
  type ContentScope,
} from '../content-format';
import { scopedDocumentKey } from './document-key';
import { admitDocument, authenticateDocument, openDocument, sealDocument } from './index';
import { verifySignatureEffect, NativeSignatureError } from '../signature';
import { bytesEqual } from '../cbor';

const error = (code: string) => new ContentError({ code });
const offsetHeader = (offset: unknown) =>
  Result.try({
    try: () => {
      if (
        typeof offset !== 'string' ||
        !offset.length ||
        offset.length > 509 ||
        offset === 'now' ||
        offset === '-1' ||
        offset.trim() !== offset ||
        Array.from(offset).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
      )
        throw error('invalid-snapshot-offset');
      const bytes = new TextEncoder().encode(offset);
      if (
        bytes.length > 509 ||
        new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) !== offset
      )
        throw error('invalid-snapshot-offset');
      const header = new Uint8Array(3 + bytes.length);
      header[0] = 4;
      new DataView(header.buffer).setUint16(1, bytes.length, false);
      header.set(bytes, 3);
      return header;
    },
    catch: () => error('invalid-snapshot-offset'),
  });
/** Header3 updates and one current header4 snapshot format. Snapshot position is
 * visible in the provider header and authenticated by the released SDK's AAD. */
export function makeStreamsUpdateBinding(input: {
  readonly genesis: Bytes.GenesisHash;
  readonly resource: string;
  readonly model: 'loro' | 'flock';
  /** A number pins writes to that epoch; current selects from each genuine ledger read. */
  readonly writeEpoch: number | 'current';
  readonly signer: DeviceSigner;
  readonly ledger: () => Effect.Effect<LedgerView, unknown>;
  /** Each successful read transfers a fresh owned opaque epoch key; never return a store's borrowed key. */
  readonly readEpochKey: (epoch: number) => Effect.Effect<Bytes.EpochKey, unknown>;
}) {
  return Effect.gen(function* () {
    const anchor = yield* Effect.fromResult(Bytes.genesisHash(input.genesis.toBytes()));
    const writeEpoch =
      input.writeEpoch === 'current'
        ? 'current'
        : yield* Effect.fromResult(Bytes.epochNumber(input.writeEpoch));
    const resource = input.resource;
    const model = input.model;
    if (model !== 'loro' && model !== 'flock') return yield* error('invalid-streams-model');
    const signer: DeviceSigner = Object.freeze({
      publicKey: yield* Effect.fromResult(Bytes.signingPublicKey(input.signer.publicKey.toBytes())),
      sign: input.signer.sign.bind(input.signer),
    });
    const lookup = input.ledger;
    const readKey = input.readEpochKey;
    let closed = false;
    let observed: LedgerView | undefined;
    const active = new Set<Deferred.Deferred<void>>();
    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        closed = true;
        for (const done of active) yield* Deferred.await(done);
      })
    );
    const guard = () => (closed ? Effect.fail(error('closed')) : Effect.void);
    const lease = <A, E, R>(work: Effect.Effect<A, E, R>) =>
      Effect.acquireUseRelease(
        Effect.gen(function* () {
          yield* guard();
          const done = yield* Deferred.make<void>();
          active.add(done);
          return done;
        }),
        () => work,
        (done) =>
          Effect.gen(function* () {
            active.delete(done);
            yield* Deferred.succeed(done, undefined);
          })
      );
    const ledger = () =>
      Effect.gen(function* () {
        yield* guard();
        const view = yield* lookup().pipe(Effect.mapError(() => error('unauthorized')));
        yield* guard();
        // Authenticate provenance before inspecting any view field.
        yield* Effect.fromResult(requireLedgerContinuation(view, view));
        if (writeEpoch !== 'current')
          yield* Effect.fromResult(epochHistoryPacket(view, writeEpoch));
        if (!anchor.equals(view.genesis)) return yield* error('content-context-mismatch');
        if (observed) yield* Effect.fromResult(requireLedgerContinuation(observed, view));
        observed = view;
        return view;
      }).pipe(Effect.mapError(() => error('unauthorized')));
    const context = (value: PayloadProtectionSealInput['context']) => {
      if (value?.protocol !== 'loro-streams-crdt-payload-protection' || value.version !== 2)
        return Result.fail(error('unsupported-streams-context'));
      if (value.kind === 'update_batch' && value.continuationOffset === undefined)
        return Result.succeed({ kind: value.kind, header: new Uint8Array([3]) });
      if (value.kind === 'snapshot')
        return Result.map(offsetHeader(value.continuationOffset), (header) => ({
          kind: value.kind,
          header,
        }));
      return Result.fail(error('unsupported-streams-context'));
    };
    const scope = (number: number, kind: 'update_batch' | 'snapshot'): ContentScope => ({
      genesis: keyId(anchor.toBytes()),
      resource,
      epoch: number,
      docEpoch: 0,
      purpose:
        model === 'loro'
          ? kind === 'snapshot'
            ? 'doc-snapshot'
            : 'doc-update'
          : kind === 'snapshot'
            ? 'flock-snapshot'
            : 'flock-update',
    });
    const withKey = <A, E, R>(
      view: LedgerView,
      number: number,
      kind: 'update_batch' | 'snapshot',
      use: (key: import('./document-key').DocumentKey) => Effect.Effect<A, E, R>
    ) =>
      Effect.acquireUseRelease(
        readKey(number).pipe(Effect.mapError(() => error('missing-read-key'))),
        (owned) =>
          Effect.scoped(
            Effect.gen(function* () {
              yield* guard();
              const packet = yield* Effect.fromResult(epochHistoryPacket(view, number));
              const commitment = yield* Effect.fromResult(commitEpochKey(anchor, number, owned));
              if (!packet.commitment.equals(commitment)) return yield* error('commitment-mismatch');
              const key = yield* scopedDocumentKey(scope(number, kind), owned);
              return yield* use(key);
            })
          ),
        (owned) => Effect.sync(() => disposeEpochKey(owned))
      );
    return Object.freeze({
      maxSealOverheadBytes: CONTENT_OVERHEAD_BYTES + 512,
      seal: (request: PayloadProtectionSealInput) =>
        lease(
          Effect.gen(function* () {
            const selected = yield* Effect.fromResult(context(request.context));
            if (
              !(request.plaintext instanceof Uint8Array) ||
              request.plaintext.byteLength > MAX_CONTENT_BYTES
            )
              return yield* error('content-too-large');
            const header = selected.header;
            const binding = yield* Effect.fromResult(
              Result.try({
                try: () => request.additionalData(new Uint8Array(header)),
                catch: () => error('invalid-streams-aad'),
              }).pipe(Result.flatMap(copyContentAdditionalData))
            );
            return yield* Effect.acquireUseRelease(
              Effect.sync(() => new Uint8Array(request.plaintext)),
              (plaintext) =>
                Effect.gen(function* () {
                  const view = yield* ledger();
                  const epoch =
                    writeEpoch === 'current' ? view.inspectState().epoch.number : writeEpoch;
                  const sealed = yield* withKey(view, epoch, selected.kind, (key) =>
                    sealDocument({
                      scope: scope(epoch, selected.kind),
                      documentKey: key,
                      signer,
                      ledger,
                      plaintext,
                      additionalData: binding,
                    })
                  );
                  yield* guard();
                  return { header, sealed } satisfies PayloadProtectionSealResult;
                }),
              (plaintext) => Effect.sync(() => plaintext.fill(0))
            );
          })
        ),
      open: (request: PayloadProtectionOpenInput) =>
        lease(
          Effect.gen(function* () {
            const selected = yield* Effect.fromResult(context(request.context));
            if (
              !(request.header instanceof Uint8Array) ||
              !bytesEqual(request.header, selected.header)
            )
              return yield* error('unsupported-streams-header');
            const metadata = yield* Effect.fromResult(inspectContentFrame(request.sealed));
            const frame = new Uint8Array(request.sealed);
            const binding = yield* Effect.fromResult(
              copyContentAdditionalData(request.additionalData)
            );
            const view = yield* ledger();
            // Untrusted epoch metadata cannot trigger key lookup until fixed historical authentication succeeds.
            yield* Effect.fromResult(
              authenticateDocument(view, scope(metadata.epoch, selected.kind), frame, binding)
            );
            return yield* withKey(view, metadata.epoch, selected.kind, (key) =>
              Effect.gen(function* () {
                const opened = yield* Effect.fromResult(
                  openDocument(view, scope(metadata.epoch, selected.kind), key, frame, binding)
                );
                return yield* Effect.acquireUseRelease(
                  Effect.succeed(opened.plaintext),
                  (plaintext) =>
                    Effect.gen(function* () {
                      const latest = yield* ledger();
                      yield* Effect.fromResult(
                        authenticateDocument(
                          latest,
                          scope(metadata.epoch, selected.kind),
                          frame,
                          binding
                        )
                      );
                      return new Uint8Array(plaintext);
                    }),
                  (plaintext) => Effect.sync(() => plaintext.fill(0))
                );
              })
            );
          })
        ),
    });
  });
}

/** Decode only released streams-crdt0.17 update framing and header3. Atomic
 * preflight of a bounded batch; caller sends these returned originals unchanged.
 * Snapshot/legacy headers, plaintext, unknown kind and empty batches are refused.
 * No SDK private import, key lookup, decryption or injected signature verifier. */
function captureStreamsUpdateBatch(input: {
  readonly genesis: Bytes.GenesisHash;
  readonly resource: string;
  readonly model: 'loro' | 'flock';
  readonly view: LedgerView;
  readonly device: Bytes.SigningPublicKey;
  readonly body: Uint8Array;
}) {
  return Result.gen(function* () {
    const candidate = input.body,
      view = input.view,
      genesis = input.genesis,
      resource = input.resource,
      model = input.model,
      device = input.device;
    if (
      !(candidate instanceof Uint8Array) ||
      candidate.length > MAX_CONTENT_BYTES ||
      !candidate.length ||
      !['loro', 'flock'].includes(model)
    )
      return yield* Result.fail(error('invalid-streams-batch'));
    // Own before inspecting; one capture cannot be substituted during processing.
    const body = new Uint8Array(candidate);
    const admissions: { scope: ContentScope; frame: Uint8Array; aad: Uint8Array }[] = [];
    let at = 0,
      count = 0;
    const aadDomain = new TextEncoder().encode('loro-streams-crdt-payload-protection/v2\0');
    while (at < body.length) {
      if (body.length - at < 4 || ++count > 100)
        return yield* Result.fail(error('invalid-streams-batch'));
      const size = new DataView(body.buffer).getUint32(at, false);
      at += 4;
      if (size < 12 || size > body.length - at)
        return yield* Result.fail(error('invalid-streams-batch'));
      const item = body.subarray(at, at + size);
      at += size;
      if (
        item[0] !== 76 ||
        item[1] !== 83 ||
        item[2] !== 67 ||
        item[3] !== 69 ||
        item[4] !== 2 ||
        item[5] !== 1 ||
        item[6] !== 0 ||
        item[7] !== 1 ||
        item[8] !== 0 ||
        item[9] !== 0 ||
        item[10] !== 3
      )
        return yield* Result.fail(error('unsupported-streams-header'));
      const frame = item.subarray(11);
      const metadata = yield* inspectContentFrame(frame);
      const aad = new Uint8Array(aadDomain.length + 11);
      aad.set(aadDomain);
      aad.set(item.subarray(0, 11), aadDomain.length);
      admissions.push({
        scope: {
          genesis: keyId(genesis.toBytes()),
          resource,
          epoch: metadata.epoch,
          docEpoch: 0,
          purpose: model === 'loro' ? 'doc-update' : 'flock-update',
        },
        frame,
        aad,
      });
    }
    return { body, view, device, admissions };
  });
}
type StreamsAdmission = Parameters<typeof captureStreamsUpdateBatch>[0];
export function admitStreamsUpdateBatch(input: StreamsAdmission) {
  return Result.gen(function* () {
    const captured = yield* captureStreamsUpdateBatch(input);
    for (const row of captured.admissions)
      yield* admitDocument(captured.view, row.scope, row.frame, captured.device, row.aad);
    return captured.body;
  });
}
type SnapshotAdmission = Omit<StreamsAdmission, 'body'> & {
  readonly body: Uint8Array;
  /** Actual host-selected snapshot path position, never inferred from the frame. */
  readonly continuationOffset: string;
};
function captureStreamsSnapshot(input: SnapshotAdmission) {
  return Result.gen(function* () {
    if (!(input.body instanceof Uint8Array) || input.body.length > MAX_CONTENT_BYTES)
      return yield* Result.fail(error('invalid-streams-snapshot'));
    const body = new Uint8Array(input.body);
    if (
      body.length < 14 ||
      body[0] !== 76 ||
      body[1] !== 83 ||
      body[2] !== 67 ||
      body[3] !== 69 ||
      body[4] !== 2 ||
      body[5] !== 2 ||
      body[8] !== 0 ||
      body[9] !== 0 ||
      !['loro', 'flock'].includes(input.model)
    )
      return yield* Result.fail(error('invalid-streams-snapshot'));
    const length = new DataView(body.buffer).getUint16(6, false);
    const expected = yield* offsetHeader(input.continuationOffset);
    if (length !== expected.length || !bytesEqual(body.subarray(10, 10 + length), expected))
      return yield* Result.fail(error('invalid-snapshot-offset'));
    const frame = body.subarray(10 + length);
    const metadata = yield* inspectContentFrame(frame);
    const domain = new TextEncoder().encode('loro-streams-crdt-payload-protection/v2\0');
    const aad = new Uint8Array(domain.length + 10 + length);
    aad.set(domain);
    aad.set(body.subarray(0, 10 + length), domain.length);
    return {
      body,
      view: input.view,
      device: input.device,
      admissions: [
        {
          scope: {
            genesis: keyId(input.genesis.toBytes()),
            resource: input.resource,
            epoch: metadata.epoch,
            docEpoch: 0,
            purpose: input.model === 'loro' ? 'doc-snapshot' : 'flock-snapshot',
          } satisfies ContentScope,
          frame,
          aad,
        },
      ],
    };
  });
}
/** Current host writer admission, not decryption or authority derived from snapshot metadata. */
export function admitStreamsSnapshot(input: SnapshotAdmission) {
  return Result.gen(function* () {
    const captured = yield* captureStreamsSnapshot(input);
    for (const row of captured.admissions)
      yield* admitDocument(captured.view, row.scope, row.frame, captured.device, row.aad);
    return captured.body;
  });
}
/** Fixed native signature work; current view selection remains the caller's responsibility. */
export const admitStreamsUpdateBatchEffect = Effect.fnUntraced(function* (input: StreamsAdmission) {
  const captured = yield* Effect.fromResult(captureStreamsUpdateBatch(input));
  return yield* admitCapturedEffect(captured);
});
export const admitStreamsSnapshotEffect = Effect.fnUntraced(function* (input: SnapshotAdmission) {
  const captured = yield* Effect.fromResult(captureStreamsSnapshot(input));
  return yield* admitCapturedEffect(captured);
});
/** Historical signature/context only, for an already admitted exact original.
 * This does not grant a new snapshot write or refresh an admission lease. */
export const authenticateStreamsSnapshotEffect = Effect.fnUntraced(function* (
  input: SnapshotAdmission
) {
  const captured = yield* Effect.fromResult(captureStreamsSnapshot(input));
  return yield* admitCapturedEffect(captured, false);
});
const admitCapturedEffect = Effect.fnUntraced(function* (
  captured: Result.Result.Success<ReturnType<typeof captureStreamsUpdateBatch>>,
  writing = true
) {
  yield* Effect.fromResult(
    Result.mapError(requireLedgerContinuation(captured.view, captured.view), () =>
      error('unauthorized')
    )
  );
  for (const row of captured.admissions) {
    const parsed = yield* Effect.fromResult(parseContentFrame(row.frame));
    const message = yield* Effect.fromResult(
      contentSigningBytes(row.scope, parsed.unsigned, row.aad)
    );
    const sig = Uint8Array.from(parsed.signatureHex.match(/../g)!, (byte) => parseInt(byte, 16));
    yield* verifySignatureEffect(captured.device.toBytes(), message, sig).pipe(
      Effect.catch((cause) =>
        cause instanceof NativeSignatureError
          ? Effect.fail(error('native-unavailable'))
          : Effect.void
      )
    );
    // Keep the same authority/context/error kernel after mathematical verification.
    if (writing)
      yield* Effect.fromResult(
        admitDocument(captured.view, row.scope, row.frame, captured.device, row.aad)
      );
    else {
      const author = yield* Effect.fromResult(
        authenticateDocument(captured.view, row.scope, row.frame, row.aad)
      );
      if (author.header.device !== keyId(captured.device.toBytes()))
        return yield* error('unauthorized');
    }
  }
  return captured.body;
});
