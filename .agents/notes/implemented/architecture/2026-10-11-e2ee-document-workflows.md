# Signed document workflows over verified ledger views

Status: implemented
Translation: current

[中文](2026-10-11-e2ee-document-workflows.zh.md)

## Abstract

The prototype's injected content authority/verifier and raw key plumbing are adapted to the merged private verified views and scoped crypto. The four settled document purposes now compose v0 encoding, strict signing, admission history and HKDF/AEAD without a second crypto implementation. A signature from a revoked author remains readable history, while current Guest/Recovery/revoked devices cannot seal new document content.

## Decision and ownership

This layer directly follows [historical facts](2026-10-11-e2ee-historical-facts.md), parent `946965a7fd3ccc10c6a18f41f8f54a38c74232a3`. Scope originates from trusted callers, not packets or URLs. A current verified view gates sealing before encryption and again after signing; the host must still enforce final current admission independently. Historical authentication is separate from permissions and AEAD validity. Source bytes/domains/algorithms remain unchanged; no deadline, atomic removal, vault or backup proposal is approved.

The explicit `./content` and `./signing` entries own document leaves/workflows and borrowed signer capability. Public authority creation has no injectable verifier. Document leaves use private WeakMap provenance and context binding; symmetric leaf import/export owns copies and never exports device private keys. Operations read inputs when run; caller-owned buffers remain the caller's responsibility until completion. Primitive temporary-secret cleanup remains ordinary try/finally, not Result.gen generator-finally. Native signing awaits non-cancellable settlement; the application owns the borrowed key handle and Effect execution. No runtime, background process, native store or production switch is introduced.

This is a partial content-module migration. Non-document purposes/precise machine-operation scope, signed ledger command preparation, epoch-history/commitment validation, SDK provider, admission and Lab remain owned by later layers in the [manifest](../../../docs/e2ee-migration-manifest.json). No missing export is counted as fixing an original failure. Snapshot format decisions stay independent.

## Evidence and limits

The existing crypto suite exercises real Node/WebCrypto signing and crypto, copied scoped leaves, distinct purposes/bindings, revoked historical authors, scope mismatch, forged views/keys, bad injected signer output, valid signatures over invalid ciphertext, native failure cleanup and in-flight revocation. Native cancellation uses an explicit interrupt request and a completion gate; the earlier prototype test's scheduler race is retained in scratch evidence, not hidden by weakening the behavior assertion. Source fingerprints and adjustments are in [provenance](../../../../packages/e2ee-core/src/content/provenance.json).

Tests do not prove product enablement, real secure-platform key custody, durable content retry, permanent-device-loss recovery or the final stack/Lab acceptance. Validation and CI remain tied to this layer's exact Draft head.

Validation: package 140/140 and typecheck pass. Full `env -u GIT_EXEC_PATH PATH="/usr/bin:$PATH" pnpm check` passes, plus root format/docs against direct parent and public boundary. Preserve earlier lint/native-Git failure logs: the unchanged native Git suite passed 6/6 with native PATH; no source/expectation was altered. The real SDK 0.16.2 provider has no AbortSignal parameter; its future bridge must own in-flight Effect/native work and awaited close. Snapshot offset host-admission binding needs a separate format decision, not the old encrypted-only-offset provider.
