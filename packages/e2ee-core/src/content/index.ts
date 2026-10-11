import { Effect, Result } from 'effect';
import * as Bytes from '../bytes';
import { ContentError } from '../errors';
import { concat } from '../concat';
import { keyId } from '../identifiers';
import {
  contentPermissions,
  historicalContentAuthor,
  epochHistoryPacket,
  type LedgerView,
} from '../ledger';
import {
  contentSigningBytes,
  encodeContentHeader,
  parseContentFrame,
  copyContentAdditionalData,
  isDocumentPurpose,
  MAX_CONTENT_BYTES,
  type ContentScope,
  type ContentHeader,
} from '../content-format';
import { sealContentAead, openContentAead } from '../crypto/content';
import { verifyContentSignature } from '../signature';
import { signVerified, type DeviceSigner } from '../signing';
import { documentKeyForScope, type DocumentKey } from './document-key';
export {
  deriveDocumentKey,
  importDocumentKey,
  exportDocumentKey,
  type DocumentKey,
} from './document-key';

const fail = (code: string) => Result.fail(new ContentError({ code }));
function boundAuthority(
  view: LedgerView,
  scope: ContentScope,
  signer: Bytes.SigningPublicKey,
  writing: boolean
) {
  return Result.gen(function* () {
    // Queries below also authenticate the view's runtime provenance.
    const epoch = yield* Result.mapError(
      epochHistoryPacket(view, scope.epoch),
      () => new ContentError({ code: 'unauthorized' })
    );
    if (keyId(view.genesis.toBytes()) !== scope.genesis)
      return yield* fail('content-context-mismatch');
    if (!isDocumentPurpose(scope.purpose)) return yield* fail('invalid-document-purpose');
    const author = yield* Result.mapError(
      historicalContentAuthor(view, signer),
      () => new ContentError({ code: 'unauthorized' })
    );
    if (writing) {
      const permissions = yield* Result.mapError(
        contentPermissions(view, signer),
        () => new ContentError({ code: 'unauthorized' })
      );
      if (!permissions.maySealNewContent || epoch.epoch !== view.inspectState().epoch.number)
        return yield* fail('unauthorized');
    }
    return author;
  });
}
/** Return signed bytes only; final host admission must independently check current permissions. */
export function sealDocument(input: {
  readonly scope: ContentScope;
  readonly documentKey: DocumentKey;
  readonly signer: DeviceSigner;
  /** Caller-owned synchronized view lookup; views still require real full verification. */
  readonly ledger: () => Effect.Effect<LedgerView, ContentError>;
  readonly plaintext: Uint8Array;
  readonly additionalData?: Uint8Array;
}) {
  return Effect.suspend(() =>
    Effect.gen(function* () {
      const scope = Object.freeze({ ...input.scope });
      const key = yield* Effect.fromResult(documentKeyForScope(input.documentKey, scope));
      if (
        !(input.plaintext instanceof Uint8Array) ||
        input.plaintext.byteLength > MAX_CONTENT_BYTES
      )
        return yield* Effect.fail(new ContentError({ code: 'content-too-large' }));
      const binding = yield* Effect.fromResult(copyContentAdditionalData(input.additionalData));
      const signer = yield* Effect.fromResult(
        Bytes.signingPublicKey(input.signer.publicKey.toBytes())
      );
      const view = yield* input.ledger();
      yield* Effect.fromResult(boundAuthority(view, scope, signer, true));
      const header: ContentHeader = { ...scope, docEpoch: 0, device: keyId(signer.toBytes()) };
      const prefix = yield* Effect.fromResult(encodeContentHeader(header));
      const sealed = yield* Effect.fromResult(
        sealContentAead(key, header, input.plaintext, binding)
      );
      const unsigned = concat([prefix, sealed.nonce, sealed.ciphertext]);
      const message = yield* Effect.fromResult(contentSigningBytes(scope, unsigned, binding));
      const signature = yield* signVerified(input.signer, message);
      const frame = concat([unsigned, signature.toBytes()]);
      yield* Effect.fromResult(verifyContentSignature(frame, scope, signer, binding));
      yield* Effect.fromResult(boundAuthority(yield* input.ledger(), scope, signer, true));
      return frame;
    })
  );
}
/** Authenticate admitted historical authors; this is neither host write admission nor decryption. */
export function authenticateDocument(
  view: LedgerView,
  scope: ContentScope,
  frame: Uint8Array,
  additionalData?: Uint8Array
) {
  return Result.gen(function* () {
    const parsed = yield* parseContentFrame(frame);
    const signer = yield* Result.mapError(
      Bytes.signingPublicKey(parsed.unsigned.subarray(7, 39)),
      () => new ContentError({ code: 'invalid-signing-key' })
    );
    const author = yield* boundAuthority(view, scope, signer, false);
    const metadata = yield* verifyContentSignature(frame, scope, signer, additionalData);
    return Object.freeze({
      header: Object.freeze({ ...scope, device: metadata.device, docEpoch: 0 as const }),
      author,
    });
  });
}
export function openDocument(
  view: LedgerView,
  scope: ContentScope,
  documentKey: DocumentKey,
  frame: Uint8Array,
  additionalData?: Uint8Array
) {
  return Result.gen(function* () {
    const parsed = yield* parseContentFrame(frame);
    const ownedFrame = concat([
      parsed.unsigned,
      Uint8Array.from(parsed.signatureHex.match(/../g)!, (x) => parseInt(x, 16)),
    ]);
    const authenticated = yield* authenticateDocument(view, scope, ownedFrame, additionalData);
    const key = yield* documentKeyForScope(documentKey, scope);
    const plaintext = yield* openContentAead(
      key,
      authenticated.header,
      parsed.nonce,
      parsed.ciphertext,
      additionalData
    );
    return { ...authenticated, plaintext };
  });
}
