# Public Lab composition and remaining boundaries

Status: proposed
Translation: current

[中文](2026-10-12-e2ee-lab-integration.zh.md)

## Abstract

Prototype dependencies and accumulated progress records obscured current Lab
behavior. The public Lab now composes public core and released SDKs for existing
workspaces, finite real-process actions and CLI evidence. Current-format consumers
share resource owners and native Effect orchestration. Genesis/epoch/snapshot/vault
producers and complete original-scenario acceptance remain unfinished, not production E2EE.

## Scope and decisions

No deployed E2EE data or API requires compatibility. Metadata-prefix genesis,
obsolete aliases, volatile caches, duplicate protected-store owners and unused
attack/Promise-phase paths are removed. Current reopen, original-byte retry,
historical authorship and backward key recovery stay required. The [current-only decision](../../implemented/simplification/2026-10-14-e2ee-current-formats-only.md)
records this simplification; it changes no permission or protocol approval.

The [README](../../../../packages/e2ee-lab/README.md) owns commands and entry points.
The [manifest](../../../docs/e2ee-migration-manifest.json) retains source disposition;
[provenance](../../../../packages/e2ee-lab/migration-provenance.json) links its source
and per-run identity. Full checkpoint text and earlier evidence remain in
[Git 5ab9394](https://github.com/LodyAI/Lody/blob/5ab9394392a3577a76b14ab0552c33f755b3ce48/.agents/notes/proposed/architecture/2026-10-12-e2ee-lab-integration.md).
Related deliveries: [#1526](https://github.com/LodyAI/Lody/pull/1526),
[#1557](https://github.com/LodyAI/Lody/pull/1557); their live checks are separate.

## Composition, authority and ownership

`openLabWorkspaceSession` owns admitted control/P09, authenticated identity,
receiver/distributor and both native document models. The receiver alone opens
the protected installed-key store; distributor and installed-history composition
borrow `installedEpochKeys`. Loro/Flock share one document engine. A failed
import/save/recovery stops only its document and retains the durable state/cursor.

Control already contains original signed genesis. Local reopen and network pins
are independent inputs; discovery, SQL and offsets cannot select authority.
Private IPC observations are verified against independently witnessed originals.
Join intent is durably saved before POST; lost receipts retry original signatures,
and membership admission precedes key/content startup. Recovery can receive/repair
and authorize its own new personal device, but cannot send keys or write content.
Historical content authentication never grants current sender eligibility.

Native workflows compose Effect phases; `LabCallbackRunner` only bridges actual
Node/SDK callbacks. Parent identities use JSON tuples; replay compares exact
parent and occurrence without the old delimiter restriction. Close stops admission, aborts and joins actual request/body/CAS
work before earlier owners release. Concurrent close callers share completion
and cleanup failure causes. StreamsClient close publishes EOF, so it is not used
for disposal. CRDT SDK close alone does not join every one-shot operation; join
raw work, close SDK/subscriptions, then free Loro or drop Flock references.

## Evidence and its limits

Owning suites cover HTTP/HPKE/SQLite, both SDKs, OS SIGKILL/reopen, original-byte
lost-ACK recovery, wrong-offset refusal and document isolation/durable retention.
Cleanup tests retain late-work, concurrent close and defect boundaries. This
coverage is not full original Lab acceptance.

One scenario owns a fixed 120s Effect watchdog, including graceful shutdown. Expiry
interrupts its Scope; existing process stop sends SIGKILL and awaits actual close
(with its separate 5s release-failure bound), then earlier fixture owners release.
Only successful cleanup hands final evidence to the writer. Expiry is a typed
`LabScenarioError/watchdog`, never a measured security pass or strict freshness B.
TestClock cases advance 119+1 seconds after explicit worker readiness: real child
open/close replies never arrive, both children exit by SIGKILL, the HTTP host closes
and no final evidence is published. The original 39-action behavior remains separate.

`run` executes bounded JSON actions; `ok: false` requires exact refusal tag/code.
Untyped, defect and unrelated failures remain harness errors. Conjoined checks
retain each measurement and aggregate the worst verdict. `inspect` recomputes
untrusted observations, not authentication or a fresh run. Provider harness signals
survive SDK failure normalization and are checked after actual settlement.
Per-run source/release hashes identify the executed tree; author tests, exact-head
CI, independent findings and product acceptance must keep separate attribution.

## Remaining protocol and platform work

| Topic | Boundary retained |
| --- | --- |
| Genesis/control | Full signed genesis at control record0; resumable creation and durable host checkpoint/lost-ACK closure remain unfinished |
| Content snapshots | Authenticated continuation position and independent current personal Owner/Admin qualification need final encoding/review; producer/bootstrap blocked |
| D12 | Atomic removal/new-epoch principle is settled; tag8/snapshot-v2/capability proposal remains unapproved, with no tag2 downgrade or split CAS |
| Vault | Direct file-secret derivation versus draft master/index needs a decision; per-entry replacement/retired-backup guarantees and Passkey remain separate |
| Candidate backup | Readable backup before publication versus explicit emergency loss acceptance is unresolved; candidate/rotation/resume producer blocked |
| Replay entropy | Retain original signed/encrypted bytes and secure random first seals; labeled test entropy requires explicit approval, with no global crypto override |
| Comparison notes | Host notes stay inert; external full tuple/actual peer still required; all-Member signed notes would need new wire/domain |
| Strict freshness B | Ordinary60s tolerance remains; strict time source/failure semantics require separate approval |

Restricted A was approved for trusted initialization-time protection of verified
installed keys only. Its Lab protector is known-key AES, not native custody;
restoration reads installed originals, never historical sender envelopes. Candidate
backup, vault, D12, protected snapshots and production protection are outside that
approval. Retained-history APIs, native platform protection and private product
wiring remain external work. No green test or implemented adapter approves them.
