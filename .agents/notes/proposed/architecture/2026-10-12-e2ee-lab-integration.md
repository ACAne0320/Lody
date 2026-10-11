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

Direct parent is sender #1493 `36ca2685b7eefeb15ebd041e50444796c2686652`.
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

Nine author tests pass: real official SQLite Riverrun 0.3.0, released
streams-client 0.9.0, synthetic-account real Ed25519 records, actual durable files,
another OS process; duplicate-at-new-offset and older-page rejection; real SQLite
IGNORE rollback and same-history retry; logical parent-chain/single-consumption
permits; raw-work settlement and owner cleanup. Native-work mock boundaries are
explicit. The first no-wait negative control escaped the initial test; preserve
that log. With the real owner-finalizer ordering assertion, the revised no-wait
control fails and the fixed suite passes. This is a new negative control,
not closure of the immutable original Lab2 failures.

Package typecheck, complete root `pnpm check` (Lab9/core296), root formatting,
docs and public boundary pass. Author-local checks are distinct from independent
review and branch CI, neither of which is claimed for this WIP. Source and target
fingerprints are in the package migration provenance and the complete manifest.

Keep the source's explicit Riverrun 0.3.0 without changing the root catalog.
A package-specific override selects the approved SQLite 13.0.3 runtime.
Resolution initially brought unrelated dependency changes; preserve every prior
lock entry and add only the Lab importer, Riverrun package/snapshot and override.
Frozen install with scripts disabled passes. Lab and core resolve the same Effect
4.0.2. Main fetched to `987962e77022df6a800f4e889f124b51f6eb8056`, accurate CI
`38151323459` succeeds, with no core/Lab/protocol changes from the actual stack bottom.

## Remaining work

Migrate the actual host/actors, content sessions, Loro/Flock persistence, driver,
attacker capability, captured replay, fixtures and CLI, then independently rerun
the original Lab2 scenarios. Snapshot wire/offset, replay randomness, recovery
vault, D12 and permanent publisher-loss decisions remain open. Entire-stack CI
and acceptance are pending. No production E2EE, native custody or deployment.
