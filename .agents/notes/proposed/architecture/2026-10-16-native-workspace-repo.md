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
- Directory and metadata authority helpers bind directly to the existing Repo.
  Unused WorkspaceRepo Context/Layer/acquire wrappers were removed; the current
  single-target refresh takes its policy directly. No second service graph is needed.
- The local v7 client owns workers, deadlines and bounded queues (including an
  estimated 64 MiB retained-string budget). Chunked input must be complete and
  cover the announced frontier. Normal writes do not advance join epoch. The old
  client is test-only, retaining host wire-compatibility coverage, with no product
  export or application import. Native client tests exercise the real v7 host.
- Legacy room projection includes actual routing/attachment: absent routes are
  detached, even when a native detail ref initially says joining. First-sync
  waits survive deliberate absence, and fail on an attached route's actual failure.

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

Configuration saves remain local-first. The writer records a pending token after
committing an authored Provider row; only a probe for that config waits for the
selected local Machine Flock peer receipt. Routine startup/backstop/forced refresh
has no new data-plane dependency when no write is pending. A confirmed receipt
clears only its captured token, so a concurrent newer write still needs handoff.
Unconfirmed delivery or timeout returns a failure response and keeps the token
for retry. Cancellation/disposal prevents late process launches. Cloud transports
and server authority are outside this local causal handoff.

## Verification and limits

Behavioral regressions cover automatic retry after failed cache and shortcut
release, shared replica ownership, original-byte preservation after failed save,
background observer failure followed by successful close, continuation/retry of
workspace cleanup and switching after failure, local-room invalidation after failed Session release, and
dirty-only config handoff with cancellation and disposal. Native v7 host tests,
existing legacy peer compatibility cases and snapshot/Streams suites retain their
separate protocol coverage. Final check results are recorded in the PR.

Head `9b5122ca` passed full GitHub CI and the desktop journey (six scenarios,
40 steps); those results are a baseline, not verification of this revision.
Local root check previously encountered the unchanged SSH fixture's
`context_unreadable`, while the same fixture passed CI. Real production services,
browser-process crashes and cross-platform acceptance remain outside local tests.
Host local server ownership, SessionDocument wrapper cache, Session/Turn/dispatch,
shortcut grants/publication, RPC and migration target uploads retain their existing
application lifecycles. The PR remains one owner-requested adoption unit; unused
framework surfaces and product duplication were removed rather than adding another
migration or changing the reviewed WorkspaceData proposal.
