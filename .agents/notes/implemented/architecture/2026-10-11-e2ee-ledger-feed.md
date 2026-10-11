# Full-history ledger feed and atomic durable position

Status: implemented
Translation: current

[中文](2026-10-11-e2ee-ledger-feed.zh.md)

## Abstract

The source Lab's known-hash skip accepted a duplicate committed record at a new
transport position; an older response could rewind its durable cursor. Adapt the
underlying full-history reader/journal subset into explicit public entries, leaving
P09 submission and qualified snapshot paths separate. Direct parent is #1482 at
4134109a76739d8b36ff5a8a1209e37e16518703; this does not extend the parent's limited
review result or mark the original Lab failures closed.

## Responsibility and decisions

The [feed contract](../../../../packages/e2ee-core/src/ledger/FEED.md) owns the
implementation and [source fingerprints](../../../../packages/e2ee-core/src/ledger/feed-provenance.json).
Caller-pinned genesis and independently expected head/count supply trust. Remote
opaque offsets and page endpoint claims do not. Only the initial exact genesis
occurrence is bound once; every suffix passes genuine-view replay with no known
record or unknown snapshot-prefix skipping. Duplicate/rollback pages fail without
changing the verified state or position.

Preserve original u32be framing and v1 record domains. A structural read capability
matches the actual released streams-client0.9 API without vendoring it or adding
SDK dependencies to the crypto package. Scope owns AbortSignal and retained raw
request settlement; it closes before the borrowed SDK owner. Finite page/read
limits are local resource bounds. The upstream SDK already buffers returned HTTP
bodies; this layer does not claim to bound allocation inside that SDK. Uncooperative
requests cannot be forcibly declared stopped; composition configures timeouts.

A dedicated local SQLite full-audit journal replays actual signed history on open
against an independently expected checkpoint. One transaction stores the suffix
and its head/count/opaque position, including metadata readback. ABORT or ignored
writes roll back both. Competing stale handles fail; retained local budgets never
silently delete history or advance cursor on failure. Legacy whole-JSON persistence
is not copied or automatically imported. Snapshot retention/bootstrap, original
Lab consumer and existing submission CAS adapter remain separate owners.

## Evidence and limits

Owning12 covers original frames, genuine signatures, initial binding, committed
record duplication/rollback, separately expected endpoint, real SQLite ABORT/IGNORE,
reopen, stale competing handles, budget retention, closed Scope and partial framing.
Explicit entered/abort/release signals prove interruption awaits an abort-ignoring
borrowed promise, without wall-clock sleeps or scheduler assumptions.

Additional author evidence uses the installed registry streams-client0.9 over a
synthetic loopback HTTP endpoint. Duplicate and rollback replies cannot change the
actual SQLite position; a real OS child independently reopens and verifies the same
retained head/count/position. This is actual SDK/HTTP/process evidence, with a
synthetic server explicitly declared; not deployed Streams/backend or original
Lab2 acceptance. Source old Lab2 failures and their scripts remain read-only and
open until the actual migrated Lab path is rerun.

No P09/HPKE change, new wire/tag/header, global freshness claim, permission-snapshot
bootstrap, native key store, recovery format, D12 policy or production activation.
The [manifest](../../../docs/e2ee-migration-manifest.json) records partial per-module
coverage and unfinished destinations. All layers remain Draft; main coordinator
assigns independent review. Early prototype ES2022 Promise helper/Fiber poll API
harness failures remain separate; corrected APIs preserve the original cancellation
assertion and release the borrowed test promise before assertions can fail.

Author final checks: owning12/core246, package typecheck, full root `pnpm check`, format/docs/public boundary passed. Early control-character regex/test shadow static errors were fixed, with old failed logs retained and no test weakening. Actual SDK/HTTP/process scripts and logs remain separate author evidence, not independent review or complete Lab acceptance.

Author-expanded storage fault tests exposed missing record-insert checks at 13ce5dac: ignored or altered record writes could still commit metadata/position. Both old-head failures remain retained. The increment checks actual insertion changes, exact original readback and aggregate retained count/bytes inside the same transaction. Owning14 includes new IGNORE/TAMPER original-record regressions; failures roll back records and position. Inherited receive destination metadata is also synchronized to the actual reviewed 4134109a source hash while retaining the extraction hash. Its runtime source is unchanged; old destination metadata is not claimed current.

Increment final author checks: owning14/core248, package typecheck, full root `pnpm check`, format/docs/public boundary passed. Both original 13ce5dac failures and new passing runs remain separate. Accurate new CI and independent increment remain pending; original Lab2 is not closed.

Original-reviewer dd297541 increment found later INSERT or metadata triggers could same-length alter previously checked history, leaving the original P1 open. The second fix compares every retained position/original byte after all DML, inside the transaction, against private originals from verified startup history plus this suffix; no DML follows. Memory view/original list publishes only after commit success. Added later/meta/existing same-length regressions fail at dd and pass in owning17, retaining memory/disk on failure and permitting retry. The three reviewer scripts were copied only into author evidence with imports redirected; actual rollback/OS-child reopen/same-handle retry pass. Old reviewer artifacts stay untouched and author results do not close the independent finding.

Second increment final author checks: owning17/core251, package typecheck, full root `pnpm check`, format/docs/public boundary passed. Copied original scripts pass failure-retention/reopen/same-handle retry for all three cases. Old dd297541 NOT READY remains unchanged; exact new-head independent increment/CI await verification and original Lab2 stays open.
