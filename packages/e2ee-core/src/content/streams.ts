import { Deferred, Effect, Result } from 'effect';
import type {
  PayloadProtectionOpenInput,
  PayloadProtectionSealInput,
  PayloadProtectionSealResult,
} from '@loro-dev/streams-crdt';
import * as Bytes from '../bytes';
import { disposeEpochKey } from '../epoch-key';
import { ContentError } from '../errors';
import { keyId } from '../identifiers';
import { epochHistoryPacket, requireLedgerContinuation, type LedgerView } from '../ledger';
import { commitEpochKey } from '../keys/history';
import type { DeviceSigner } from '../signing';
import {
  CONTENT_OVERHEAD_BYTES,
  MAX_CONTENT_BYTES,
  copyContentAdditionalData,
  inspectContentFrame,
  type ContentScope,
} from '../content-format';
import { scopedDocumentKey } from './document-key';
import { authenticateDocument, openDocument, sealDocument } from './index';

const error = (code: string) => new ContentError({ code });
/** Settled header 3 update binding. Snapshot writer/read compatibility remains a separate decision. */
export function makeStreamsUpdateBinding(input: {
  readonly genesis: Bytes.GenesisHash;
  readonly resource: string;
  readonly model: 'loro' | 'flock';
  readonly writeEpoch: number;
  readonly signer: DeviceSigner;
  readonly ledger: () => Effect.Effect<LedgerView, unknown>;
  /** Each successful read transfers a fresh owned opaque epoch key; never return a store's borrowed key. */
  readonly readEpochKey: (epoch: number) => Effect.Effect<Bytes.EpochKey, unknown>;
}) {
  return Effect.gen(function* () {
    const anchor = yield* Effect.fromResult(Bytes.genesisHash(input.genesis.toBytes()));
    const epoch = yield* Effect.fromResult(Bytes.epochNumber(input.writeEpoch));
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
        yield* Effect.fromResult(epochHistoryPacket(view, epoch));
        if (!anchor.equals(view.genesis)) return yield* error('content-context-mismatch');
        if (observed) yield* Effect.fromResult(requireLedgerContinuation(observed, view));
        observed = view;
        return view;
      }).pipe(Effect.mapError(() => error('unauthorized')));
    const context = (value: PayloadProtectionSealInput['context']) =>
      value?.protocol === 'loro-streams-crdt-payload-protection' &&
      value.version === 2 &&
      value.kind === 'update_batch' &&
      value.continuationOffset === undefined
        ? Result.succeed(undefined)
        : Result.fail(error('unsupported-streams-context'));
    const scope = (number: number): ContentScope => ({
      genesis: keyId(anchor.toBytes()),
      resource,
      epoch: number,
      docEpoch: 0,
      purpose: model === 'loro' ? 'doc-update' : 'flock-update',
    });
    const withKey = <A, E, R>(
      view: LedgerView,
      number: number,
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
              const key = yield* scopedDocumentKey(scope(number), owned);
              return yield* use(key);
            })
          ),
        (owned) => Effect.sync(() => disposeEpochKey(owned))
      );
    return Object.freeze({
      maxSealOverheadBytes: CONTENT_OVERHEAD_BYTES + 1,
      seal: (request: PayloadProtectionSealInput) =>
        lease(
          Effect.gen(function* () {
            yield* Effect.fromResult(context(request.context));
            if (
              !(request.plaintext instanceof Uint8Array) ||
              request.plaintext.byteLength > MAX_CONTENT_BYTES
            )
              return yield* error('content-too-large');
            const header = new Uint8Array([3]);
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
                  const sealed = yield* withKey(view, epoch, (key) =>
                    sealDocument({
                      scope: scope(epoch),
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
            yield* Effect.fromResult(context(request.context));
            if (
              !(request.header instanceof Uint8Array) ||
              request.header.length !== 1 ||
              request.header[0] !== 3
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
              authenticateDocument(view, scope(metadata.epoch), frame, binding)
            );
            return yield* withKey(view, metadata.epoch, (key) =>
              Effect.gen(function* () {
                const opened = yield* Effect.fromResult(
                  openDocument(view, scope(metadata.epoch), key, frame, binding)
                );
                return yield* Effect.acquireUseRelease(
                  Effect.succeed(opened.plaintext),
                  (plaintext) =>
                    Effect.gen(function* () {
                      const latest = yield* ledger();
                      yield* Effect.fromResult(
                        authenticateDocument(latest, scope(metadata.epoch), frame, binding)
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
