# Current public E2EE decisions

Status: implemented
Translation: current

[中文](2026-10-15-e2ee-current-decisions.zh.md)

## Abstract

The unshipped E2EE stack accumulated a separate Note for almost every extraction,
fix and parent synchronization. Most repeated module contracts or stale validation
counts. This record consolidates the choices that still explain the current
implementation; module READMEs own behavior, and the manifest owns source disposition.
Pending protocol and product decisions remain [separate proposals](../../proposed/architecture/2026-10-15-e2ee-open-contracts.md).

## Current format only

There are no deployed E2EE ledgers or stores to migrate. Support one current format
per entrypoint; omit old readers, aliases, JSON imports, dual decoders and schema
upgrades. Current v0/v1 names are authenticated protocol domains, not obsolete
versions to rename. Normal reopening, verified history, historical author identity,
backward epoch-key recovery and original-byte retries remain current requirements.
Source-era export lists do not require restoring obsolete APIs or a second core.

## Trust and authority

Use one registered genuine-view replay/policy implementation. SQL, transport
offsets, ACKs, reports and server revisions cannot select ledger authority. A valid
historical signature grants no current write/send right. Snapshot endorsement needs
independent same-point qualification or a private token from an actual eligible
view; signature-only evidence and equal comparison notes do not supply that trust.
Unknown pre-snapshot hashes and missing user attribution cannot be fabricated.
Current permission and known-prefix checks repeat after asynchronous work.

The concrete Streams adapter returns its genuine view from the same verified read;
Lab control reuses it. Generic remote records still require independent P09
verification. Shared route screening covers actual reads/control only, while key
mailbox and content writes retain their dedicated admission.

## Installed-key protection

The restricted approval covers verified installed EpochKeys through a trusted
host protector captured once at initialization. Ordinary callers keep opaque keys;
protection authenticates the whole purpose/Org/recipient/epoch/commitment/key payload.
The adapter can copy plaintext, so this is a trust boundary, not OS isolation or a
complete-erasure promise. Installed keys can reopen after their original sender is
revoked; fresh envelopes still require a current eligible sender. This approval
covers neither historical-envelope restoration nor candidate backup, vault formats,
installed-history product approval or actual platform custody. The existing identity
port and safeStorage string path are not an accepted native protector adapter.

## Durability and lifecycle

Persist the first signed record, ciphertext, report or repair ID before dispatch;
retry originals rather than silently re-signing, re-encrypting or rebasing. CAS has
no unconditional-append fallback. Final row/context readback precedes success;
a disk phase or remote hint is not installation, possession or authority evidence.
Acknowledgement retains originals and frees active distribution capacity; retained
disk history can still grow. Indexed stores replace whole-JSON persistence.

Lab sessions and process/CLI commands expose stable-ID repair, independent page
continuation and all three result/ACK paths. Callers choose when a result has been
consumed; key rounds never ACK or silently discard it. A blocked first page can be
continued without changing IDs or creating another queue owner.
Receive tasks use one pending Install phase: every retry opens the original
ciphertext and performs protected save/reload before signing and queuing a report.
The redundant pre-save phase UPDATE is removed. Local receiver schema2 rejects
the unsupported former schema1 without migration; protocol domains do not change.

One receiver owns installed-key storage; distribution and history consumers borrow
it. Owners reject new work, abort/cancel what can stop, await actual native/SDK/body
settlement, then release storage and native resources. Promise bridges exist only
at real SDK/Node callbacks. StreamsClient.close is protocol EOF, not disposal;
SDK close alone does not join every operation. Clear owned scratch after settlement;
borrowed handles and runtime-internal copies have separate lifetimes. HTTP shutdown
aborts incoming bodies before joining callbacks; reverse Scope finalization must
not make the abort owner wait behind its own unfinished body.
Bounded response collection is one internal helper inside these existing leases:
EOF releases the reader; incomplete work awaits cancel and always releases the lock.

## Verification work

Cooperative native Ed25519 work uses the same pure authority kernel and retains
strict canonical subgroup/scalar checks. Bounded private caches retain exact
mathematical successes, never roles or freshness. Native backend failure is a
harness/backend failure. Persistent internal collections share immutable structure;
public inspection still returns detached data. Full feed reopening remains O(N).

Only a complete baseline audit, exact trigger-free schema and unchanged external
write stamp allow indexed final SQL readback. Changed schema, triggers or foreign
writes retain full comparison; counters never create trust. The final checks run
after the last DML; earlier duplicate readback is omitted. These conditions and
caches remain subject to necessity review.
A 120s Lab watchdog is a harness bound, not a performance pass line or strict B;
final evidence is written only after successful resource cleanup.
Execute and inspect share action semantics and observation summaries, so malformed
plans cannot become passing evidence through a different inspection path.

## Module and validation boundaries

[Core](../../../../packages/e2ee-core/README.md) owns protocol primitives and
[Lab](../../../../packages/e2ee-lab/README.md) composes them with released SDKs,
synthetic protection, real SQLite/HTTP and process faults. Lab is not product
assembly or native-keychain acceptance. The [manifest](../../../docs/e2ee-migration-manifest.json)
retains source hashes, dispositions and unfinished work. Author tests, independent
review, exact-head CI and production acceptance remain distinct.

Per-slice progress Notes are removed rather than copied into another archive.
Their fixed history remains at [15d35f75](https://github.com/LodyAI/Lody/tree/15d35f75cd702f9d8846a73f03636ce4afce1d80/.agents/notes).
This consolidation changes no protocol approval or runtime behavior by itself.
