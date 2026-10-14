# E2EE verification and bounded Lab completion

Status: implemented
Translation: current

[中文](2026-10-15-e2ee-cooperative-verification.zh.md)

## Abstract

Repeated point validation, synchronous signature work and full-table write audits
made the unshipped E2EE library expensive even for genuine current-format input.
I/O owners now perform fixed native verification cooperatively, reuse only exact
mathematical successes, share immutable ledger state and avoid unchanged-table
scans after a complete audit. The Lab scenario has a finite resource-aware
watchdog. Full cryptographic reopening and unapproved snapshot/publisher/platform
work remain explicit limits; this change does not enable product E2EE.

## Shared verification and owned inputs

The synchronous Result API remains platform-neutral and blocking. Effect I/O
consumers capture owned records and the independent endpoint before awaiting,
yield between 32-record batches, use host WebCrypto Ed25519, then execute the same
pure replay policy. No injected verifier or alternate authority constructor is
added. Canonical nonzero prime-subgroup A, canonical prime-subgroup R and S<L are
checked even where a native backend alone accepts more points.

A 256-entry validated-public-key cache keys exact owned public bytes. Another
256-entry cache retains only native strict-success key/signature/message tuples,
with messages at most 8192 bytes. Neither caches roles, membership or freshness.
Large messages bypass the exact-tuple cache and still pay the pure equation check.
Missing/failed native verification is `native-unavailable`; it is not bad crypto
or a measured expected security rejection. Cancellation waits for actual native
settlement and verification scratch cleanup. Public wrappers retain copy ownership.

Private persistent maps/sets/hash prefixes replace whole-state cloning. Public
inspection still owns detached maps, and failed or alternative suffixes cannot
change earlier genuine views. Content admission uses the same native-math/pure-
authority boundary; the host reselects current permission after verification.

## Durable audit without every-write scans

SQL open still replays complete signed history from external trust. Native work
runs outside a database transaction; a complete second read compares every
captured original and metadata before publishing the view. Append captures and
verifies a suffix before acquiring the writer lock, then checks the observed
local and stored point again.

Normal feed/distribution mutations can use indexed final readback only after a
full baseline audit and under an unchanged exact trigger-free schema. Schema and
external-write counters are captured under BEGIN IMMEDIATE; actual change totals
and final changed rows/metadata are checked after the last DML. Triggers, changed
schemas or foreign writes use full original/metadata comparison. Old IGNORE,
late-trigger, same-length mutation and alias counterexamples remain regressions.
Counters are change detectors, never authentication or checkpoint authority.

Distribution capacity now counts unacknowledged work. Explicit acknowledgement
frees capacity while retaining original task/result/outbox bytes, so historical
rows do not permanently exhaust the finite active budget. Disk history can grow;
physical archival is not implemented.

## Lab watchdog and evidence

The fixed 120s scenario watchdog is a harness bound, not a performance pass bar
or strict deadline B. Worker open/close stalls interrupt the owning Scope; real
children are killed and awaited before earlier HTTP/SQL owners close. Final
evidence is written only after successful cleanup. TestClock advances119+1 seconds
after real child readiness and checks actual child exit, closed HTTP and absent
final evidence. Forever nonsettling host-native work is not a universal bounded
cleanup guarantee.

## Evidence and unfinished behavior

Owned-input, strict native edge vectors, cancellation gates, independent ledger
branches, real SQL trigger/external-writer failures, acknowledged capacity reuse
and real stalled-child tests exercise these boundaries. Timing measurements are
diagnostics, not machine-load-sensitive test assertions. Exact before/after trees,
commands and results belong to the [#1557](https://github.com/LodyAI/Lody/pull/1557)
delivery report; author verification is not independent review or production acceptance.

Full-history reopening remains O(N). Snapshot-first joining and retained-history
availability, a durable epoch publisher/removal producer, protected content
snapshots, vault/backup, production trust/custody and protocol freshness still
require their own approved contracts. No SQL-selected trust or new wire format is
introduced to make a performance test pass.
