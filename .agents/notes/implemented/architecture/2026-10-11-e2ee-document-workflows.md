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

Draft: [#1442](https://github.com/LodyAI/Lody/pull/1442).

## Snapshot author and async input follow-up

The L1b identity query is now consumed by document authentication/opening: genuine full history retains actor/member identity; retired-device facts in a qualified endorsed snapshot return explicit device-only/missing-history-context. New sealing still needs current permission and never restores a revoked writer. Seal captures scope/plaintext/additional data/signer/lookup before awaiting, wipes its owned plaintext using acquireUseRelease and requires the final genuine view to continue the first known prefix. Existing v0 wire/algorithms are unchanged. Direct parent is mailbox #1472 ad4aed943928be69b0013445c2a38d86c7907fbe.

An independent fixed 13ddba9823cbe51d0ff92e87c59ac9d1d206e6cf clone reproduces three failures: retired snapshot author cannot open old document, mutation while lookup waits changes encrypted plaintext, and later prefix rollback still seals. Original source/review artifacts remain untouched; separate old-fail/new-pass evidence covers actual signed snapshot + Ed25519/AEAD, revoked seal rejection, bad signature, Deferred-controlled input and capability mutation, and genuine rollback. This is library document behavior, not SDK/host admission, production trust sourcing or Lab acceptance.

Final L2c code tree: core 201/201 and typecheck, full root check with native Git/local IPC, format/docs/public boundary pass. The new author union is explicit and existing full-history assertions now narrow its member case. No production consumer or wire change.

L2c Draft: [#1474](https://github.com/LodyAI/Lody/pull/1474).

Parent page-limit fix synchronized from #1472 at 6ed759f1c9081d2758311fde9bd5147e650e5df2. Combined core 202/202 and typecheck passed; content implementation and its four regression tests are unchanged. Earlier independent READY applies only to its recorded 4319f6c0 head; the new combination requires scoped recheck.
