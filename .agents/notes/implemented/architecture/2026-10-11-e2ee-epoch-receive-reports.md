# Durable finite recipient installation and original report retry

Status: implemented
Translation: current

[中文](2026-10-11-e2ee-epoch-receive-reports.zh.md)

## Abstract

The protected installed-key layer lacked the prototype recipient workflow and crash-recoverable original signed-report queue. This layer adapts that subset through real current envelope/HPKE/commitment gates and actual protected save/readback before signing. It retains source/originals and finite progress without restoring whole JSON task expansion, phase-derived trust or false reported possession.

## Responsibility

Direct parent is #1480 at ec6a02f97aea1445a89ee1bc5a4d72e38f1bf9ee. The [contract](../../../../packages/e2ee-core/src/keys/RECEIVE.md) and [provenance](../../../../packages/e2ee-core/src/keys/receive-provenance.json) own details. One host initialization fixes protection/store, native handles, signer and transport; ordinary calls cannot supply a successful fake persistence callback. Verify/Install always open this source even with an existing key. Original signed queue retries without signing again; a task/report never grants ledger authority or substitutes for actual protected possession.

A queued claim retry after sender revocation preserves the source flush contract; new envelope opening still requires current eligibility. Genuine epoch/recipient changes end tasks, while repair revisions remain server hints. Finite keyset hints allow blocked rows and later tasks together. Local ACK history is not current key availability or remote durability proof. Failed/cancelled or uncertain writes retain originals; unreadable protected originals are not silently replaced.

## Evidence and remaining work

Owning tests use real cryptography, real SQLite and public mailbox admission: actual disk read before signer; lost-ACK original retry with an unusable signer after reopen; protection failure recovery; forged Install phase/pre-existing correct key cannot mask bad ciphertext; local key loss versus fresh repair revision; exact verified local publication; 101 blocked old-revision claims plus later current delivery; sender/recipient revocation; signal-controlled capture and late-close rejection; independent-process original report delivery through an explicit RPC bridge. That bridge and synthetic protection are declared boundaries, not HTTP/SDK/native custody acceptance.

Sender discovery/current-epoch distribution, durable requestRepair coordination and fetch composition still belong to the original source; do not mark that whole module migrated. SDK/HTTP/Lab and all nine original core/Lab failure dispositions remain separately owned by the [manifest](../../../docs/e2ee-migration-manifest.json). No HPKE/P09 implementation change, production switch, real keychain, recovery-file/wrapping policy or D12 format is introduced. All layers stay Draft.

Author final direct-parent combination: receive11/core230, package typecheck, root format/docs and full root `pnpm check` with native Git/local IPC passed. Early MTS generic/fixture type/lint errors and one Buffer-versus-Uint8Array representation assertion failure are retained separately; that byte comparison was corrected without changing the implementation or removing revocation coverage. These author results are not independent review or complete Lab/product acceptance.

Independent review of 8af3d3e found a tampered terminal could suppress zero-row transitions yet return Installed. The increment rejects terminal reentry, checks exact changed rows and reads back the queued original. Owning regressions cover both terminal phases and real SQLite RAISE(IGNORE) at both transitions. Old reviewer artifacts remain unchanged. The 101-row test retains every genuine envelope/install/report and finite-page assertion; it now reuses one genuinely verified immutable fixture ledger, eliminating repeated full-history verification on each unchanged lookup. Original CI timeout remains a failure at the old head, not a baseline or a pass.

Increment author checks: receive15/core234 and full root `pnpm check`, format/docs/public boundary passed. The copied original phase reproduction (imports redirected to this author checkout only) now returns Failure/context-changed, retains Revoked/report=NULL and signs only once across initial install/reopen; old independent fail remains read-only. This is author evidence pending original reviewer increment and accurate new CI.
