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

The fixed 6de checkpoint had twenty-four author tests: real official SQLite Riverrun 0.3.0, released
streams-client 0.9.0, synthetic-account real Ed25519 records, actual durable files,
another OS process; duplicate-at-new-offset and older-page rejection; real SQLite
IGNORE rollback and same-history retry; logical parent-chain/single-consumption
permits; raw-work settlement and owner cleanup. Native-work mock boundaries are
explicit. The first no-wait negative control escaped the initial test; preserve
that log. With the real owner-finalizer ordering assertion, the revised no-wait
control fails and the fixed suite passes. This is a new negative control,
not closure of the immutable original Lab2 failures.

Fixed 6de package typecheck, focused lint and the owning Lab24 suite pass.
Historical e677 root `pnpm check` (Lab9/core296), root formatting, docs and public
boundary pass remain separate; fixed 6de complete root `pnpm check` (Lab24/core302), format, docs and public
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

## Genuine policy and HTTP key consumers

The increment adds a genuine-ledger stream policy gate and a scoped mailbox HTTP
adapter. R can read/repair, never send/manage/write; current membership and the
credential/request Org are independent gates. Structural counterfeit views and
hostile opaque-value methods are refused before caller-visible ledger state.
This is not challenge/bearer authentication, fresh checkpoint selection, pinned CAS
or content/snapshot acceptance. The complete honest host still owns those gates.

Mailbox responses have bounded bodies, canonical even hex, safe slot/revision
numbers and bounded decimal pages. Scope retains raw fetch plus response body,
including abort-ignoring reads, before earlier owner closure. Real public HPKE,
SQLite distribution/receiver and installation report rounds run over actual
loopback HTTP. A tampered signature leaves key storage empty and status unchanged;
the original frame then installs/readbacks/reports successfully. Reopened Recovery
receives durable results and cannot schedule sends. Session authentication and
AES wrapping remain explicit synthetic boundaries; key-store reopen in this round
is same-process, not full OS/native custody acceptance. Initial fixture reused one
X25519 public key for two devices; public admission rejected it. The corrected
fixture creates independent device pairs, without changing the protocol.

Frozen 1087 owning **30 tests** and package typecheck pass. The frozen `6de46b5d`
checkpoint had complete root Lab24/core302, format/docs/boundary evidence; its
results do not certify this increment. Frozen 1087 complete root `pnpm check` passes Lab30/core302, with unchanged Lab input
fingerprints throughout; format/docs/public boundary pass. The initial current
check found three mailbox static errors, corrected before the passing repeat. No Lab Draft or independent whole-Lab acceptance yet.

The fixed 02f checkpoint's new response-body test initially let a no-wait mutant
escape; its passing positive suite is not that failure's acceptance evidence.
The adapter now accepts an optional explicitly owned native transport `close`
capability, captured at acquisition and run once after raw fetch/body settlement.
Global fetch has no native lease to close. The synthetic lease records actual
close before body completion; the revised no-wait mutant hits
`transportClosedEarly` (5ms, no timeout), then restored tests pass. Failure gates
are finalizer-owned, with no fixed microtask drains or sleeps. Preserve both the
escaped original log and the new failure. Current same-count suite/typecheck pass;
complete root pnpm check Lab30/core302 for this native-lease increment passes,
with unchanged Lab input SHA; format/docs/public boundary pass.

## Credential/control/HTTP increment (author WIP)

The new credential owner and loopback HTTP/control composition consume public
signature/genuine-ledger/submission APIs. Synthetic account labels and the frozen
Lab possession domain/nonce/token TTL remain test contracts, never production
identity, JWT claims, ordinary leeway changes or approved strict deadline B.
SQLite mint and nonce consumption require actual readback; SQL IGNORE cannot return
a phantom credential, and a trigger restoring a consumed nonce rejects the attempt.
Two additional original HostMeta SQL-boundary probes reproduce those failures; source
SHA remains 8f40941246e5745b441aaaf0bdc93f5e8b994656b24eea7f58b1229d63ee28c3.
These are not whole original host regressions or the original Lab2 closure.

Control uses public complete-prefix admission and SDK pinned CAS, not a second P09.
HTTP verifies stored bearer, canonical Org/path, one bounded framed record and
possession proof; hostile offset/lifecycle headers cannot reach the SDK capability.
A genuine checkpoint is an independently provided harness input. Durable workspace
registration/checkpoint crash-gap handling, joins, notes, key/content routes and
startup remain pending. No generic proxy or snapshot wire is restored.

A shared operation owner waits every child even when another finalizer defects,
then propagates the failure. Runtime tests exercise real SQLite/SDK lifetimes with
an explicit synthetic finalizer-fault boundary. The fresh 1087+7-file SHA overlay
passes Lab36; removing child waits hits real Riverrun closedEarly (no timeout),
restoration passes. The added real HTTP test passes, for 37 current owning tests;
Final SDK-ACK complete root pnpm check passes core302/Lab37 with unchanged Lab inputs; root format/docs/public boundary pass. One inherited Git helper failure in unchanged CLI is retained; removing GIT_EXEC_PATH only in test subprocesses gives focused6 and full-root pass. Fixed-head reproduction follows commit.
Frozen 1087 Lab30 evidence does not certify these new files.

The actual published StreamsClient consumes the HTTP CAS path using its auth API; successful ACK includes the required Stream-Next-Offset header. An initial synthetic consumer incorrectly supplied bearer through generic headers (the SDK removes it); that 401 is fixture evidence only. After using auth correctly, the missing-ACK-header old failure and repaired new pass are preserved separately.

## Authenticated mailbox increment (WIP after dd718)

The actual loopback host binds a stored bearer to its device and bound Org for all
seven original mailbox operations; JSON never selects a principal. The public
SQLite host retains crypto/eligibility/store/report/repair admission. No copied
core or independent acceptance shortcut. Native credential requests and response
bodies in the synthetic fixture have explicit scoped raw ownership. The actual
HPKE/save/readback/report round now consumes challenge/bearer HTTP, preserving
prior tampered-frame no-install/no-report and Recovery reopen no-send assertions.
An actual owner-signed stored frame with hostile owner JSON under a Recovery bearer
is refused. R's own receive-slot repair advances revision once; same ID retry does
not advance again. Unauthorized HTTP401 maps to the adapter's unauthorized error.
The server preserves 512-byte envelopes/reports, 8192-byte publication records and
existing bounded arbitrary repair IDs; no new wire format, production identity or
strict B. Focused5/typecheck and current full-root core302/Lab37 pass, with unchanged Lab input SHA through format. Docs/public boundary pass. The first DTO static consistent-return failure is retained and fixed with a fail-closed branch. Fresh dd718+5-file overlay37 passes; JSON-principal mutant returns200 where403 is required, a direct assertion without timeout; restoration passes. Fixed-head reproduction follows commit; no independent whole-Lab review/CI acceptance.

The next joins/host-metadata storage work also has two read-only original SQL
reproductions: ignored join insertion returns success without a row, and ignored
first-user account binding lets a later different synthetic account claim the same
user ID. These probes use explicitly unchecked synthetic DTOs against HostMeta
storage only; they are not full HTTP/signature acceptance or product identity
findings. Source SHA is unchanged. The migration must verify both request and
binding rows inside the same transaction before acknowledging. That implementation
and the real authenticated joins route are still pending.

## Remaining work

Migrate the actual host/actors, content sessions, Loro/Flock persistence, driver,
attacker capability, captured replay, fixtures and CLI, then independently rerun
the original Lab2 scenarios. Snapshot wire/offset, replay randomness, recovery
vault, D12 and permanent publisher-loss decisions remain open. Entire-stack CI
and acceptance are pending. No production E2EE, native custody or deployment.
