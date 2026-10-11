# Public Lab integration in progress

Status: proposed
Translation: current

[中文](2026-10-12-e2ee-lab-integration.zh.md)

## Abstract

The original Lab consumes obsolete core APIs and has two recorded ledger-read
failures. Migrate its consumers to public modules and published SDKs, starting
with durable ledger reads, explicit logical permits and scoped native work.
Real local transport and process-reopen probes pass for this implementation
checkpoint. Original host/actor, protected content, replay and complete fault
acceptance remain pending, so keep work on one integration branch before a Draft.

## Ownership and boundaries

Direct parent is update binding #1496 `0418fd69e22d1eeba47553714473ec54762837ec`.
Actual source and target package: `packages/e2ee-lab`. The client consumes public
reader/feed exports with no copied verifier/store or injected signature acceptance.
Caller-selected signed checkpoints are independent of hostile transport offsets.
Serialized reads commit verified original records and cursor in the same SQLite
transaction. Scope aborts and waits the borrowed SDK read before closing its owner.

The original scheduler and stable schedule identity helpers live under `src/pure`.
Expected invalid permit/time operations return typed Results. The scoped runtime
has explicit mode/time/fetch inputs; its deprecated Promise bridge serves only
SDK/harness callbacks. Close rejects new work, aborts, waits retained native
requests and phase work, then closes the internal Effect owner. Late values and
frames are rejected. Runtime/driver/host composition remains incomplete.

## Evidence and dependency closure

Twenty-four current author tests pass: real official SQLite Riverrun 0.3.0, released
streams-client 0.9.0, synthetic-account real Ed25519 records, actual durable files,
another OS process; duplicate-at-new-offset and older-page rejection; real SQLite
IGNORE rollback and same-history retry; logical parent-chain/single-consumption
permits; raw-work settlement and owner cleanup. Native-work mock boundaries are
explicit. The first no-wait negative control escaped the initial test; preserve
that log. With the real owner-finalizer ordering assertion, the revised no-wait
control fails and the fixed suite passes. This is a new negative control,
not closure of the immutable original Lab2 failures.

Current package typecheck, focused lint and the owning Lab24 suite pass.
Historical e677 root `pnpm check` (Lab9/core296), root formatting, docs and public
boundary pass remain separate; current complete root `pnpm check` (Lab24/core302), format, docs and public
boundary pass; frozen noninteractive ignore-scripts install passes. Checked Lab
file fingerprints remain unchanged from root-check start to completion. Author-local checks are distinct from independent
review and branch CI, neither of which is claimed for this WIP. Source and target
fingerprints are in the package migration provenance and the complete manifest.

Keep the source's explicit Riverrun 0.3.0 without changing the root catalog.
A package-specific override selects the approved SQLite 13.0.3 runtime.
Resolution initially brought unrelated dependency changes; preserve every prior
lock entry and add only the Lab importer, Riverrun package/snapshot and override.
Frozen install with scripts disabled passes. Lab and core resolve the same Effect
4.0.2. Main fetched to `987962e77022df6a800f4e889f124b51f6eb8056`, accurate CI
`38151323459` succeeds, with no core/Lab/protocol changes from the actual stack bottom.

## Real content, submission and recovery composition

The actor consumes public admission/signing and unchanged P09, never a copied
proposal/genesis codec. It captures commands before waiting, prohibits new signing
while pending and requires genuine durable feed inclusion before terminal
consumption. A real SQLite IGNORE probe caught an uncommitted actor treating a
Result as a boolean; the fix unwraps it through Effect.fromResult. Old failure
and actual no-signer child-process resume pass are retained. P09 is unchanged.

The Promise provider consumes public update binding, retaining an internal Effect
owner only at the actual SDK callback boundary. Actual released Loro/Flock clients
use real local Riverrun. Per-document SQLite pairs actual native snapshots and
exact cursors atomically with readback; SQL IGNORE cannot acknowledge a pair.
Another OS process reopens Loro/cursor/protected epochs with no usable signer.
Fixture AES wrapping is explicitly synthetic, not a production algorithm choice.

The scoped SDK owner retains and awaits raw one-shot operations before SDK close
and real Loro.free. Published SDK.close does not itself join every such operation.
The no-wait mutant reaches the closedEarly assertion, not a timeout; failure-path
gate release prevents cleanup deadlock. Flock0.4.3 has no public free/dispose:
close SDK subscriptions and drop references, without touching private internals
or claiming deterministic Wasm allocation release.

A new scoped Loro session serializes per-document work, persists local edits
before upload, and stops only the failed document. Initial WIP created its SDK
after editing, so SDK appendWriteOnly returned success without uploading any
queued local update. The real remote-state assertion failed. Construct the SDK
before native edits; old failure/new pass remain. Full-history recovery reloads
the durable native state including local edits; only a successful whole pull
commits the final staged state/cursor. A failed recovery retains the durable pair.

Actual Riverrun0.3.0 snapshot PUT at nonzero offset updates earliest_offset.
Public history reads then return gone, and SDK recovery falls back to the same
bad snapshot. Real probes distinguish readable-history recovery success from
unavailable-prefix failure, which remains document-stopped with unchanged cursor.
Do not reset host SQL offsets or delete snapshots to manufacture recovery.
Upstream retained authenticated history API versus a trusted host history route
is a coordinated contract gap; no new header/offset wire is invented here.

Pure replay comparison consumes recorded synthetic fixtures only, with no entropy
provider or resealing capability. It compares frame actor/operation/phase/resource
as well as original protected request/response bytes. Original multipart normalization
rewrote incomplete messages and overran its allocation for many short boundaries:
original4pass/2newfail retained, complete conservative framing and exact-size allocation
then6pass. Full replay/driver/host integration remains incomplete; original driver
heuristics that skip missing identities or pull later permits forward are not copied.

## Remaining work

Migrate the actual host/actors, content sessions, Loro/Flock persistence, driver,
attacker capability, captured replay, fixtures and CLI, then independently rerun
the original Lab2 scenarios. Snapshot wire/offset, replay randomness, recovery
vault, D12 and permanent publisher-loss decisions remain open. Entire-stack CI
and acceptance are pending. No production E2EE, native custody or deployment.
