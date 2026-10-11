import { Result } from 'effect';
import type { EpochKey } from '../bytes';
import { ContentError } from '../errors';
import {
  deriveContentKey,
  importContentKey,
  exportContentKey,
  type ContentKey,
} from '../crypto/content';
import {
  encodeDocumentContext,
  isDocumentPurpose,
  type DocumentScope,
  type ContentScope,
} from '../content-format';

declare const documentKey: unique symbol;
export interface DocumentKey {
  readonly [documentKey]: true;
}
const keys = new WeakMap<DocumentKey, { key: ContentKey; scope: Readonly<DocumentScope> }>();
const leafScope = (scope: DocumentScope): ContentScope => ({ ...scope, purpose: 'doc-update' });
function own(scope: DocumentScope, key: ContentKey): DocumentKey {
  const value = Object.freeze({}) as DocumentKey;
  keys.set(value, { key, scope: Object.freeze({ ...scope, docEpoch: 0 }) });
  return value;
}
export function deriveDocumentKey(scope: DocumentScope, epochKey: EpochKey) {
  return Result.map(deriveContentKey(epochKey, leafScope(scope)), (key) => own(scope, key));
}
export function importDocumentKey(scope: DocumentScope, bytes: Uint8Array) {
  return Result.map(importContentKey(bytes, leafScope(scope)), (key) => own(scope, key));
}
export function exportDocumentKey(key: DocumentKey) {
  const row = keys.get(key);
  return row
    ? exportContentKey(row.key, leafScope(row.scope))
    : Result.fail(new ContentError({ code: 'invalid-document-key' }));
}
/** Internal lookup: purpose restrictions and every document context field are bound. */
export function documentKeyForScope(
  key: DocumentKey,
  scope: ContentScope
): Result.Result<ContentKey, ContentError> {
  return Result.gen(function* () {
    yield* encodeDocumentContext(scope);
    if (!isDocumentPurpose(scope.purpose))
      return yield* Result.fail(new ContentError({ code: 'invalid-document-purpose' }));
    const row = keys.get(key);
    if (!row) return yield* Result.fail(new ContentError({ code: 'invalid-document-key' }));
    if (
      row.scope.genesis !== scope.genesis ||
      row.scope.resource !== scope.resource ||
      row.scope.epoch !== scope.epoch ||
      (scope.docEpoch ?? 0) !== 0
    )
      return yield* Result.fail(new ContentError({ code: 'document-key-scope-mismatch' }));
    return row.key;
  });
}
