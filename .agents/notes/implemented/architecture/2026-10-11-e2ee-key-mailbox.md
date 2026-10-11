# Indexed authenticated local key mailbox

Status: implemented
Translation: current

[中文](2026-10-11-e2ee-key-mailbox.zh.md)

## Abstract

One global epoch stream lets valid duplicate ciphertext exceed its read limit and block unrelated delivery. This layer supplies a public local SQLite mailbox with per-recipient bounded reads and ciphertext deduplication, authenticated principal binding and fixed ledger/signature admission. Existing installation-report bytes and recipient-only repair are preserved, while old JSON storage is replaced with a separate schema. A signed report remains a claim; durable installation, Lab integration and production authentication are still unfinished.

## Ownership and trade-off

Direct parent is snapshot Draft #1464 at 5d3967ec94e3b10fdec76220937e9fcfe2623590. The [mailbox contract](../../../../packages/e2ee-core/src/keys/MAILBOX.md) owns trust, paging, resource and storage details. Reports stay portable; only the explicit Node entry imports SQLite. Caller-authenticated Org/device composition owns principal authenticity, fresh verified ledger sourcing and its own async request cancellation/awaiting. No hidden Runtime/background fiber or production consumer is added.

The source already defines a central mailbox and key-installed/v1 source/revision reports. The implementation adapts that behavior to real opaque ledger views and the merged fixed crypto, instead of copying global JSON expansion or permissive verifier ports. Local indexed storage uses a distinct application ID; no old file is converted or mistaken for this schema. Exact ciphertext remains retained. Deduplication avoids growth from identical re-appends; distinct valid ciphertext and historical rows can still grow, without inventing an unapproved retention policy. Pagination is a projection hint, not a stable cross-request snapshot or durable sync cursor.

The verified public head/count pin is saved on authority observation, independently of content/transport progress. Both in-round observations and persistent exact-known checkpoints reject rollback/forks. Endorsed snapshots can prove only retained actual positions; missing prefix hashes are never invented. An envelope/report checks current eligibility again after async lookup. Signed installation claims require current revision and an actual stored source; repair retains ciphertext, excludes rejected frames, and invalidates previous reports. Actual key durability belongs to the receiver workflow, not server assertion.

## Evidence and limits

The unchanged frozen candidate's duplicate-stream test still fails 0/1 after a valid ciphertext flood exceeds 16MiB. The new mailbox admits 500 real fixed-verified duplicates but stores one row, while another recipient remains readable; this is new-path evidence, not repaired legacy-stream or complete Lab acceptance. Owning tests cover real signature/principal rejection, source/report/revision binding, idempotent repair/history retention, SQLite reopen, persisted revocation rollback, captured input, foreign and old-schema preservation, oversized unrelated-row isolation, and closure during a Deferred-controlled borrowed lookup with explicit caller await.

Package tests pass 196/196. Test fixture type errors and the initial 5-second duplicate-test timeout were corrected and retained in external evidence; no protocol failure was hidden. Full root validation, format, docs/public-boundary checks and exact-head CI are reported separately. No production activation, actual key custody, permanent-loss backup, atomic removal format, vault format, transport authentication or Lab migration is claimed. [Migration ownership](../../../docs/e2ee-migration.md) retains those gates.

Final 196-test code tree passed full root check with native Git/local IPC, root format, docs check and public boundary. Exact-head remote CI remains separate.

Draft: [#1472](https://github.com/LodyAI/Lody/pull/1472).

After syncing the parent count fix, combined core 197/197, typecheck and full root check passed. Exact Draft head/base are handed off for independent review; no code changed after that combined validation.

Incremental SQL page fix: independent review of ad4aed943928be69b0013445c2a38d86c7907fbe observed LIMIT 101/load 101 for a 100-item request. The ciphertext query now uses exactly the requested limit; a separate indexed scalar EXISTS after the last sender/digest determines continuation without loading a lookahead frame. Owning real-crypto pagination verifies 101 envelopes across 100/1 pages, exact frame identity, empty terminal cursor and out-of-range rejection. Original reviewer artifacts remain untouched; separate copied-fixture reproduction preserves old load101 failure/new load100 pass and its initial ESM harness error. No trust/wire/repair policy changes.

Final page-fix tree passed core 198/198, typecheck and full root check with native Git/local IPC, format/docs/public boundary. The prior NOT READY evidence remains unchanged; independent incremental recheck is still required for the new head.

Incremental same-page fix: payload, empty-page offset validation and scalar continuation seek share one deferred WAL read transaction. A real worker executes two authenticated public repairs between statements; the page remains the original projection and a later fetch sees both committed repairs. Preserve the earlier old-fail evidence separately. The ciphertext limit stays 100; no production or cross-request snapshot claim is added.

Author validation: mailbox 11/11, full core 199/199, typecheck, root format/docs check and complete root check passed. The first worker fixture reused a repair ID across different digests and failed replay; that fixture error and the lint naming failure remain recorded separately from the preserved product old-fail/new-pass.
