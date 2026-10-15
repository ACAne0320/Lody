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

## Restored local publication and explicit snapshot consumers

The old local rotation workflow is migrated through a distinct initialized
candidate protector, not an extension of restricted installed-key A. A protected
candidate and original signature are durable and read back before P09 submission.
Lost ACKs and restarts reuse that original; verified commitment and installed
save/reload precede Committed. Explicit ACK retains original history. Publisher
operations do not hold the control actor permit while borrowing installed-key
reads, because those reads refresh the same actor. Full-session operations own
closure, and current-epoch document binding rechecks after asynchronous signing.
The selected staging port retains the complete post-state recipient group and
exact readback gates P09 CAS. Conflicts discard the candidate; unknown outcomes
reuse originals. Recipients verify the genuine committed post-state before
receiving that group, so permanent publisher loss after commitment no longer
requires its disk. This supersedes the old independent publisher-backup options;
vault/native custody remain separate. A manager can still bypass staging and
commit directly, causing a measurable withholding/availability failure.

Ledger/auth snapshot consumers accept an explicitly independently qualified signed origin
and persist only its bytes, genuine suffix and cursor. Every reopen supplies trust
again. The authenticated workspace captures qualification before native auth and
can start reading without the genesis prefix. Offsets and SQL do not select
permission; P09 still verifies full history for writes. This changes no snapshot
wire or qualification rule and does not complete production trust acquisition.

## Current atomic removal and content snapshot completion

The current tag8 operation removes the target and activates the next epoch in one
Owner-personal-signed transition. The original candidate and P09 paths are reused;
retired member/device facts and history remain, while distribution excludes the
removed devices. The existing snapshot auth state already represents that exact
post-state; no old-client capability negotiation or second decoder is introduced.
The encoding remains experimental. Related protocol Specs remain drafts for review;
implementation and tests do not grant approval.

Snapshot content v0 carries a u16be byte length and raw ASCII continuation offset
immediately after the signing public key; the complete field enters signature/AEAD.
Provider header4 is exactly `[4]`. The host checks an actual record boundary no
later than the native head without interpreting opaque caller tokens; readers
compare the exact continuation after decryption. All four document purposes share
the leaf key and retain docEpoch=0. Update content-frame overhead stays 143 bytes;
snapshots add 2+offset byte count. Updates retain exact header3 bytes. Readers reject transplant/model/purpose/signature
and AEAD errors before durable advancement. Host admission binds the authenticated
principal and current writer/epoch before and after native verification. A snapshot
must also retain its admitted original identity and position across retries; raw
Riverrun PUT alone is not that contract. Production retention/trust and strict B
remain separate. The Lab's internal-marked SDK upload method is identified honestly.

Native snapshot retention can make an ordinary read from the beginning return HTTP 410
while the released SDK still recovers from an authenticated snapshot plus suffix.
The Lab preserves this behavior rather than resetting earliest offsets. A read-only
native SQLite observation scans both retained entries and snapshot bodies for
synthetic plaintext; it measures backend storage without assigning ledger authority
or pretending that a pruned prefix remains readable. Three-role Loro/Flock plans
exercise moved-offset refusal, unchanged durable state and actual recovery/reopen.

The remaining active-R→own-personal consumer reuses public proof/P09/HTTP/HPKE
instead of adding a wrapper service. Fresh personal comparison notes still require
an explicit independently obtained exact tuple; a server observation cannot upgrade
itself. A structure assessment recommends keeping domain directories and splitting
only large mixed rotation/receive/distribution owners into pure/workflow/platform.
No files were moved or architecture refactor performed in this migration increment.

## Current creation and reproduction consumers

Client creation persists the one signed genesis before HTTP dispatch. The host
creates that actual first control frame and confirms full signed readback before
publishing its durable floor; it resumes remote-write/local-checkpoint gaps without
re-signing. Reopen still needs an independent minimum. Host observations are not
a client freshness oracle. The registry and P09 retain their existing owners.

Action replay uses fresh OS processes and SQLite owners with the original synthetic
identities, signed/HPKE/ciphertext inputs, prepared candidate/outbox inputs and
native local-edit deltas. Capturing inputs avoids a second core entropy contract;
injecting recorded replies, terminal results or document/cursor post-state would
bypass the crypto/import/persistence behavior being tested and is excluded. Actual
HTTP/P09, SDK import, persistence and cursor commits execute again. Measurements
compare outcomes, exact refusal/fault facts and within-run durable relationships,
without global entropy replacement or fresh-reseal equality. Shrink reproduces
the same concrete failure with original inputs and fresh owners for each candidate.

The private replay directory retains synthetic secret exports and original inputs
with `0700`/`0600` directory/file permissions; public evidence records its binding
digest, not those secrets, and action replay requires the private source directory.
The separate public captured-read pack contains no key: it authenticates/decrypts
original ciphertext only with caller-qualified history and key capability. Bounded
attacker ports exclude honest private paths/keys; missing measurements remain explicit.

The complete Lab host refreshes real control before authorization. Failed persistence keeps a
monotonic observed floor in that object and blocks current/checkpoint and older prefixes until
confirmation; reopen still needs an independent minimum. Offline edits persist native state/old
cursor and the existing SDK publishes under the current epoch, without another outbox. Finite
attack plans receive actual response controls, including allowed header-only mutation;
plans can declare multiple roles and snapshot upload actions. Unrelated or harness failures never substitute
for a measured refusal, and host observations never invent independent comparison confirmation.
