# Recipient mailbox composition

Status: implemented
Translation: current

[中文](2026-10-11-e2ee-recipient-mailbox.zh.md)

## Abstract

The original distribution fetch/install and repair consumers still lacked a public composition. Directly base this layer on #1485 `680686d1442e7f8b12f6f8b84af3f17f3c514b97`. The explicit host-only facade constructs the real receiver/protected store and durable repair queue, captures borrowed capabilities once and keeps the portable root unchanged. Details: [contract](../../../../packages/e2ee-core/src/keys/RECIPIENT-MAILBOX.md), [source fingerprints](../../../../packages/e2ee-core/src/keys/recipient-mailbox-provenance.json).

## Responsibility

Before installation, genuine Org/recipient/epoch checks surround fetch, and the complete bounded page is copied by numeric index before asynchronous recheck. Bad page fields fail before any task/key save. Each envelope then passes actual signatures, HPKE, commitment and protected save/reload before original report persistence. On a later crypto/install failure, earlier legitimate installations and originals remain, while this call returns failure without successful pagination-next. There is no invented cross-database transaction or saved document cursor.

Scope closes local admission/storage; the caller cancels and awaits borrowed transport/ledger work before destroying its owners. No Runtime, background loop, automatic retries, native adapter, new wire, recovery format, stricter deadline or production composition.

## Evidence and remaining work

Ten owning tests use actual public mailbox/signatures/HPKE/SQLite with declared synthetic protector: installation/report, synthetic local key loss and durable repair retaining ciphertext; bad envelope retaining Verify with no next including after valid installation; malformed/oversized/hidden-iterator pages before writes; in-flight revocation; full-page copy across explicit Deferred ledger signals and initialization-captured fetch; closed Scope before late page. The same suite/typecheck passes on the actual680 parent; prototype results alone are not this tree's acceptance.

Sender discovery/current-key/outbox rounds, actual published SDK/CAS consumers, qualified snapshot bootstrap, complete Lab and gated recovery work remain in the [manifest](../../../docs/e2ee-migration-manifest.json). This layer does not close original Lab2/permanent-loss failures or establish native/all-platform/production acceptance. Independent review and accurate CI bind each exact new head; all PRs stay Draft under coordinator-assigned review.

Final author validation: owning10/core273, package typecheck, complete root `pnpm check`, format/docs and public boundary passed. Offline lock refresh parses identically (only ordering), so existing dependency versions/integrities and original layout remain.
