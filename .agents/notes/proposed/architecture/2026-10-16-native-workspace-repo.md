# Native workspace Repo ownership

Status: proposed
Translation: current
PR: [#1607](https://github.com/LodyAI/Lody/pull/1607)

[中文](2026-10-16-native-workspace-repo.zh.md)

## Abstract

The owner requested native consumer adoption in the same PR as the
[released dependency upgrade](../../implemented/architecture/2026-10-16-streams-repo-release-adoption.md).
CLI, renderer, eager workers and private shortcut rooms consume the published
native Repo/SDK. One workspace Repo owns replicas; existing Promise APIs enter
through one deprecated facade. Review exposed cleanup short-circuiting and
unrecoverable application fences; independent cleanup now continues and ordinary
acquisition retries retained owners. The [WorkspaceData design](2026-10-14-workspace-data-services.md)
remains a proposal, including host storage relocation and upper Session/Turn work.

## Responsibilities and behavior

The lockfile retains the older Streams graph still pinned by E2EE packages added
on main: CRDT 0.17.0 uses Client 0.10.0, alongside their Client 0.9.0 reference.
Pruning those records during this upgrade leaves dangling references in GitHub's
automatic PR merge even though the branch installs by itself. Preserve the exact
existing package integrity and snapshots; the workspace catalog still selects
Client 0.12.0 and CRDT 0.19.0. Validate frozen installation on the merged tree,
not only lockfile-only resolution, which does not detect this missing graph.
The failing CI merge reproduces the missing dependency before the repair and
completes an offline frozen install afterwards with lifecycle scripts disabled;
that verifies dependency closure, not native builds or the full test suite.

- Workspace roots own one native Repo over existing SQLite or renderer IndexedDB.
  Consumers borrow Doc, Flock and room leases in child Scopes. Opening absence
  and creating business identity remain distinct; local mode performs no cloud I/O.
- Session readers wait for catalog metadata on that Repo before backend selection.
  Runtime retirement aborts those waits; Session retirement removes reader
  observations before releasing its borrowed Doc, including construction failure.
  Main's incremental-history wakeups coexist with the retryable native teardown.
  Restoration consumes the selected native room's baseline state, not an upload
  receipt. Native observer tests fake deadlines while leaving worker scheduling live.
- Native Streams transports reuse the token service and replica-bound checkpoints.
  Foreground roots explicitly reuse same-store Doc cursors; eager workers own
  isolated replicas and volatile cursors. Peer baseline, server confirmation and
  local durability never substitute for each other.
- CLI directory reads and metadata confirmation compose native Repo operations
  at their existing business entries. Remove the single-consumer directory and
  authority objects, unused query options and compatibility methods. Identity
  normalization, deletion filtering, ordering and fresh server confirmation remain.
- The local v7 client owns workers, deadlines and bounded queues (including an
  estimated 64 MiB retained-string budget). Chunked input must be complete and
  cover the announced frontier. Normal writes do not advance join epoch. The old
  client is test-only, retaining host wire-compatibility coverage, with no product
  export or application import. Native client tests exercise the real v7 host.
- Legacy room projection includes actual routing/attachment: absent routes are
  detached, even when a native detail ref initially says joining. First-sync
  waits survive deliberate absence, and fail on an attached route's actual failure.
  Handles retain the native RoomLease and only the UI status view still consumed.
  Inventory and transport snapshots read native leases; local room records only
  retain borrow owners for purge. Remove unused aggregate/wait-result APIs and
  parallel adapter/status maps. Native reconnect retries failed attaches and
  retains SDK producers, replacing application per-room rejoin sweeps. Keeping
  the full old subscription contract would duplicate these owners and statuses.

## Release, recovery and causal handoff

Upstream replica release commits and persists the document and metadata before
unsubscribing. Failure retains a `RepoReleaseFailed.retry` and the accepted I/O;
a second acquire can need that release to succeed before constructing a replica.
SDK close stops network admission and drains accepted work; it is not an implicit
fresh server-upload receipt. An offline connection alone does not establish that
shortcut close must fail.

Legacy Doc handles keep the existing cached replica hold separate from each view's
borrow. Session, preview and schedule caches stop projections and release their
borrow, then attempt eviction. Eviction persists before closing the cached hold:
an ordinary quota failure leaves the original native replica active and borrowable.
Repeated and concurrent reopens reuse that replica while storage is still failing;
the next successful eviction saves it and permits a fresh generation. Genuine
native release failures still require recovery before replacement. Simply ignoring
such failures would not work: the installed SDK marks the last replica retiring
before persisting, and its acquire must finish that release. The extra cached hold
is the Legacy cache's existing ownership, removed by successful eviction or workspace
close, not a new retry loop or a second Repo. Native-only borrowers keep scoped release.
Eviction warnings contain no raw error/Cause or user payload.
The eviction waiter uses the SDK release deadline (30 seconds by default). It
does not cancel or duplicate accepted adapter work. A hung save can outlive that
wait while another view borrows the same replica; later durability and close
still join the original write. CLI reinitialization clears a successfully released
borrow separately from the eviction result, preserving this same availability.

Shutdown closes borrowers before Repo, but one failed store must not skip other
stores, transport teardown, joins or Repo close. Runtime disposal attempts these
independent steps and reports errors afterwards. A later dispose retries retained
owners without reopening admission. RuntimeProvider retains retryable closes per
workspace: a failed close cannot poison another workspace, while reopening the
same storage retries its old owner first. Shortcut roots do the same per database;
runtime/remote/index/store failures do not skip independent cleanup or Repo close.
A disposed shortcut runtime can finish its failed retirement on retry. Session
cleanup keeps actual failed borrow releases retryable. Once its borrow is released,
a failed eviction remains reported but does not fence reinitialization on the
still-active cached Doc. The next successful eviction invalidates its local room.
Cache/shortcut acquisition still retries genuinely retiring owners: replacing one
after another failed retry can strand an SDK producer, and native Repo itself may
need to finish that release. This necessary exclusion does not apply to a failed
save that left the cached replica active.
Background stream failures emit a payload-free diagnostic, without an unbounded
Cause history or making a later successful destroy fail. Scope finalizers run once;
the small ownership helper retains native retry owners rather than re-closing a
failed Scope. Private Causes/grants never enter diagnostic logs.

Private shortcut constructor/connect/join finalizers already share the workspace
owner Scope, but SDK retirement failures use `DurableReleaseFailure`, not
`RepoReleaseFailed`. Treating that typed receipt as an unknown Cause permanently
replayed it after the accepted HTTP request finished. The existing Scope recovery
boundary now invokes its actual `retryRelease`, just as it invokes Repo receipts;
success clears the retained failure. Other unknown failures remain visible. This
adds no second SDK owner, replayed finalizer or discarded write, and preserves
the dependency order for producers that still have accepted work.

Borrower Scope failure does not establish that Repo close is independent: private
shortcut SDK producers also live under consumer Scopes and can retain accepted I/O.
Keep the existing dependency order rather than forcing native close past any failure.
Another workspace remains independent, and retry closes the retained owner before
releasing its Repo/storage. No new global gate or background retry loop is added.
The installed SDK exposes no terminal discard/termination API. A permanently failing
or hung raw writer still needs confirmed retirement before a second writer may open
the same storage; bounded lossy termination is not claimed by this repair.

CLI and renderer register the SDK snapshot diagnostic observer at their transport
composition entries. The shared explicit scalar projection preserves snapshot and
request correlation, permission/auth/HEAD/export/encode/PUT stages, encoded body
length, outcomes and monotonic stage/workflow elapsed time. Native Repo error
formatting also preserves `abortKind`, `timeoutKind` and `uploadStage`; it never
forwards private Causes, arbitrary error text, bodies, tokens, headers or sensitive
URLs. Ordinary fetch remains `total-only`: missing transmission substages stay
unknown, and a timeout budget is never presented as elapsed time. Snapshot stages
use debug and failures use warn. Protected-content observers remain composed,
including asynchronous failure isolation; neither logger nor observer failures
change upload, retry, authorization or local-only composition.

Configuration saves remain local-first. The writer records a pending token after
committing an authored Provider row; only a probe for that config waits for the
selected local Machine Flock peer receipt. Routine startup/backstop/forced refresh
has no new data-plane dependency when no write is pending. A confirmed receipt
clears only its captured token, so a concurrent newer write still needs handoff.
Unconfirmed delivery or timeout returns a failure response and keeps the token
for retry. Cancellation/disposal prevents late process launches. Cloud transports
and server authority are outside this local causal handoff.

The compatibility write barrier and attachment cancellation preserve two contracts
that readiness and a completed-handle registry alone cannot provide. After a
baseline, another local edit still needs fresh confirmation: `waitUntilSynced`
uses native captured-version upload ACKs for a server route, and checks the
selected route's protocol receipt for a peer. Missing, offline or unsupported
confirmation fails only that explicit wait. First-sync readiness and local-first
writes gain no new gate. Native Repo owns the bounded upload producer even if a
borrower cancels its wait; cancellation does not retire another borrower's replica.

The transport owner is registered synchronously before adapter construction or
native connect. Remove aborts acquisition and closes that owner Scope; native
finalizers revoke registration and drain accepted connection work. Both before
native registration and before publishing a completed lease, acquisition checks
cancellation. Removal and acquisition cleanup share the existing serialized close,
and delete the registry entry only if it still identifies that owner. A successor
can start after confirmed release. A failed close retains the native retry owner;
the next add for that id retries it, while sibling ids remain usable. Scope is the
lifetime primitive; the registry retains ownership, not another native status.

Local v7 congestion recovery keeps the 1,024-event/default 64 MiB bounds. Overflow
fails only that room's current barriers, including accepted but unconsumed sync
events. Explicit reconnect or a physical online edge interrupts and awaits the
old consumer and its accepted Flock I/O, stops the deadline, then creates a fresh
queue and worker in the same room Scope. It discards incomplete chunks, request
ids and server frontier state before rejoining from the retained replica version.
The CRDT/lease and state references survive; completed catch-up advances the epoch.
An interrupted waiter removes its receipt without retiring the shared replica.
A per-room native semaphore serializes restart with close, so replacement cannot
overtake the previous consumer and close prevents later recovery admission. This
is a local lifecycle boundary, not a workspace readiness or write gate.
Room recovery runs independently: waiting for one accepted import does not delay
another room's catch-up worker.
Physical connection status dispatch also must remain independent of that drain.
Healthy rooms receive status events directly; overflowed members schedule one
recovery fiber per member identity in a transport-scoped FiberMap. Repeated online
edges share the outstanding repair, completed tasks leave the map, and existing
room lifecycle serialization still joins recovery before close. Explicit reconnect
continues to await retirement; a retired transport ignores queued status edges.

## Session repair and remaining failure spread

Repo 0.23.0 exposes selected-room sync/reconcile, but no selected-binding reset.
Session history retries therefore use only their existing room's `sync('streams')`,
with the existing Doc-sync deadline (8 seconds by default) and borrower signal.
An offline/unconfirmed result rejects that attempt; it is not success or an
unbounded readiness wait. Native reconciliation can retry a failed attach. A
terminal SDK generation still needs transport reset, which belongs to the existing
connection-recovery controller and its watchdog/backoff, rather than every pending
Session. This removes K independent N-room resets; it does not claim an unsupported
per-room SDK reset. Healthy sibling SDK generations and presence stay connected
during a Session attempt. The controller's actual transport reset still affects
all its members.

The following design limits remain outside this repair; they are not containment
guarantees or claims of completed terminal shutdown:

| Trigger | Spread and retained owner | Recovery / remaining limit |
| --- | --- | --- |
| Repeated private shortcut `sync()` | Each `connect` adds an SDK lease/finalizer to the room Scope; retention grows with calls until room close | Room disposal releases them. Joining once per room remains follow-up work; there is no independent call-count bound. |
| Borrower Scope close fails | `destroy()` stops before native Repo close; native room/background-stop steps, including autopersist, are not reached | The retained workspace owner retries close; unrelated workspaces remain independent. Background activity persists meanwhile. Bypassing this dependency can strand a private SDK producer with accepted I/O. |
| Persistent IndexedDB quota failure during workspace retirement | RuntimeProvider's same-workspace close gate rejects reopening in this window and can consume a release deadline on each retry | Storage recovery permits retirement. Same-key adoption, bounded terminal shutdown/reporting and a terminal SDK/raw-writer termination contract are not implemented here; this remains a product-level availability limit. |

## Verification and limits

The Session isolation regression fails at `11f89018` with the healthy sibling's
native status observed as `offline`; it passes after the selected-room change.
The real Repo with an injected transport gates connection reset explicitly and
checks imported Doc bytes for both pending Sessions. Joining/offline waits use
fake deadlines, remain retryable after timeout and preserve another borrower.
Cancellation covers both native reconcile and sync. The four owning CLI suites
pass 90 cases, including existing SDK checkpoint and dispatch/recovery coverage.
CLI types, changed-file lint, Effect and boundary checks pass. The root run reaches its local ten-minute
budget during component typechecking; no current complete root pass is claimed.

At `6c5fca07`, the two supplied deep-review regressions fail while the prior 19 cases
pass. After repair, the expanded suites pass 22 cases. Real SDK HTTP remains held
past its abort and release budgets for both `connect`/sync and `join`; after it
finishes, Scope retirement and the same database reopen succeed. A held real Flock
import overflows Meta while a sibling processes repeated later offline/online
edges; releasing the import recovers the same Meta replica, and disconnect remains
closed despite another queued online edge. These are injected boundaries, not
production-network acceptance.

The `6c5fca07` CI CLI group also exposed three Role-history tests added on main
that still constructed the old Promise Repo for the migrated SessionDocument.
Their fixture now constructs the same WorkspaceRepoLegacy used by the consumer;
proposal persistence, idempotency and ownership assertions remain unchanged.

`11f89018` passes all 1,543 Shared cases, 93 affected renderer cases, four Role
history cases, repository types/static checks, 58 script cases, formatting and
documentation/boundary checks. The local root run was stopped during full CLI and
component tests after types/lint/scripts passed; it is not a full-suite pass.
Final merged-head CI remains required.

The persistent IndexedDB save regression fails on `c2dc8435` and passes with this
repair. It checks repeated/concurrent reopens, original Doc identity/bytes, an
independently writable/persisted sibling, successful later eviction and a fresh
durable generation. A separate real Scope/IndexedDB case protects a failed private
SDK producer's storage, proves another workspace can still persist, and closes both
producer and storage after recovery.
The real renderer preview entry and CLI Session reinitialization also reuse the
original replica while persistence remains unavailable; they do not need recovery
to happen before another view opens.
A fake-clock case holds an actual adapter save beyond the eviction deadline,
reopens the same Doc while that write is still accepted, then finishes and verifies
the bytes on disk. The timeout never becomes a durability acknowledgement.
After integration with main `7246f783`, validation covers 143 affected renderer
cases, 175 CLI cases including daemon/MCP and 48 Shared protocol/shortcut/lock cases.
Before that integration, all 1,521 Shared cases passed. Affected-package types,
changed-file lint, formatting, native boundary and documentation checks pass;
real-process/IPC and Git-based guards run outside the restrictive sandbox.
The complete local root test chain was not rerun to completion; these results do
not replace CI on the final PR merge. RuntimeProvider keeps main's bounded client
log event but records only operation/error type, never the private Repo error.

Real v7 host tests exercise two consecutive overflows at the default event cap,
default byte cap, and an injected small byte cap. Schema-valid bursts, including
real Loro update bytes, fail current waits, preserve independent room sync, then
recover both incoming and outgoing writes on the original Doc/Meta replica. A
separately gated real Meta import proves recovery awaits accepted uninterruptible
I/O before replacing the consumer, while a sibling completes its catch-up epoch.
The owning native suite passes 11 cases.
At this repair, full Shared passes 1,522 cases and four affected renderer suites
pass 89 cases. In a separate worktree at `a2f0911d`, all five added congestion
regressions fail against the previous implementation.
The root run also encountered a timeout in the unchanged SubagentTaskPanel
command-details case; its owning suite passes all 19 cases when rerun alone.
Record that separately from the known SSH credential fixture failure rather
than reporting the root run green.

Real renderer SDK fixtures verify plaintext/protected snapshot success, a held PUT
with 275 ms of injected elapsed time, and a 60 s total upload timeout carried
through native Repo error formatting. Throwing log sinks and async observers cannot
fail the upload or skip the configured observer. CLI SQLite/SDK fixtures verify stage records and correlate encoded byte
length and request id with the actual PUT. Added private fields in diagnostic DTOs
are excluded by projection, as are synthetic private payloads and Causes in real
failure paths. Only SDK-provided transmission evidence is logged.
Removing observer registration and the three error classifications makes the
regression fixtures fail.
At `a2f0911d`, diagnostics validation passed 63 affected component cases and 5 CLI cases, plus
full workspace type/static checks, formatting, docs and boundary guards. Full CLI
has 4,313 passes, one skip and the already reproduced SSH `context_unreadable`
fixture failure; root `pnpm check` therefore remains red and not every package's
full suite completed through that command. The script suite passed all 58 cases.

Regression fixtures exercise the real SDK with an upload POST held after baseline,
and a real Streams transport with an explicit connection suspension. They verify
server-received bytes, removal from native inventory and same-id reconnection.
Additional native boundary cases cover cancellation during construction/connect,
late completion versus a successor, release retry, and unconfirmed peer receipts.
Restoring the `d82fea54` facade makes both real regression fixtures fail. At
`95ee59f7`, the sandboxed root check stopped in a script fixture; the same complete script suite
passes outside the sandbox, as do the affected CLI and full Shared suites.
These are synthetic HTTP fixtures, not production-network acceptance.

Behavioral regressions cover automatic retry after failed cache and shortcut
release, shared replica ownership, original-byte preservation after failed save,
background observer failure followed by successful close, continuation/retry of
workspace cleanup and switching after failure, local-room invalidation after failed Session release, and
dirty-only config handoff with cancellation and disposal. Native v7 host tests,
existing legacy peer compatibility cases and snapshot/Streams suites retain their
separate protocol coverage. Final check results are recorded in the PR.
Real native integration also verifies retry after a failed attach, native-only
room inventory, repeated server confirmation versus local authority, and all four
late-reconnect success/failure and waiter-retry shutdown scenarios. A timed-out
waiter shares the retained native producer; another edge does not duplicate it.
Session retirement during reconnect/readiness also cancels only that borrower's
wait, preserving another holder of the shared room and document.

Head `df7de23d` passed full GitHub CI and Desktop E2E; those results are a
baseline, not verification of this revision. The unchanged SSH credential
fixture's `context_unreadable` reproduces locally both before and after this
simplification, so the full CLI suite is not reported green locally. Real production services,
browser-process crashes and cross-platform acceptance remain outside local tests.
Host local server ownership, SessionDocument wrapper cache, Session/Turn/dispatch,
shortcut grants/publication, RPC and migration target uploads retain their existing
application lifecycles. The PR remains one owner-requested adoption unit; unused
framework surfaces and product duplication were removed rather than adding another
migration or changing the reviewed WorkspaceData proposal.
