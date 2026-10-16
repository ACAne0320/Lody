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

- Workspace roots own one native Repo over existing SQLite or renderer IndexedDB.
  Consumers borrow Doc, Flock and room leases in child Scopes. Opening absence
  and creating business identity remain distinct; local mode performs no cloud I/O.
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

Shutdown closes borrowers before Repo, but one failed store must not skip other
stores, transport teardown, joins or Repo close. Runtime disposal attempts these
independent steps and reports errors afterwards. A later dispose retries retained
owners without reopening admission. RuntimeProvider retains retryable closes per
workspace: a failed close cannot poison another workspace, while reopening the
same storage retries its old owner first. Shortcut roots do the same per database;
runtime/remote/index/store failures do not skip independent cleanup or Repo close.
A disposed shortcut runtime can finish its failed retirement on retry. Session cleanup also invalidates the local
room when lease release fails and privately retains its retry handle. The next
cache/shortcut acquire automatically retries its retiring owner. Rebuilding after
another failed retry was rejected: it can strand an SDK producer and native Repo
itself may still need to finish the previous release. A persistent storage failure
remains visible and recoverable; it no longer requires an explicit external unlock.
Background stream failures emit a payload-free diagnostic, without an unbounded
Cause history or making a later successful destroy fail. Scope finalizers run once;
the small ownership helper retains native retry owners rather than re-closing a
failed Scope. Private Causes/grants never enter diagnostic logs.

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

## Verification and limits

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
