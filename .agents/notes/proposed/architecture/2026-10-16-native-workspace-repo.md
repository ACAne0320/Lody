# Native workspace Repo ownership

Status: proposed
Translation: current
PR: [#1607](https://github.com/LodyAI/Lody/pull/1607)

[中文](2026-10-16-native-workspace-repo.zh.md)

## Abstract

The owner requested native consumer migration in the same PR as the
[released dependency adoption](../../implemented/architecture/2026-10-16-streams-repo-release-adoption.md).
CLI and renderer must compose the published `loro-repo/effect` implementation,
with one workspace Scope owning the Repo and its transport attachments. CLI, renderer, eager-prefetch workers and private shortcut durable rooms now
consume those native entries. Existing application APIs execute through one
explicitly deprecated facade over the same native Repo. The [WorkspaceData design](2026-10-14-workspace-data-services.md)
remains proposed; this change does not move renderer storage to a new host.

## Behavior contract

- Trigger: workspace initialization creates one native Repo over the existing
  SQLite or per-renderer IndexedDB adapter. Local mode performs no cloud I/O.
- Owner: the workspace owns the Repo; consumers borrow document/room leases in
  child Scopes. Open returns absence; creation explicitly registers identity.
- Cancellation: ending one consumer Scope releases its lease, without evicting
  another borrower's replica or canceling a shared accepted upload producer.
- Handoff: Streams uses the native transport and replica-bound checkpoints.
  Existing same-store document cursors are reused on this in-place upgrade.
  Server confirmation, peer convergence and local durability remain separate.
- Recovery: failed release retains the full Cause and retry owner. Shutdown must
  not dispose storage or replace an owner whose accepted I/O remains unsettled.

## Completion boundary

The native kernel comprises Repo composition, catalog-backed SessionDirectory,
fresh SyncAuthority, transport configuration, the local v7 client and retryable
borrower Scope ownership. CLI/MCP directory reads use the Services; CLI session
handles and renderer session/preview/schedule stores borrow native leases.
The eager worker owns an isolated native Repo, transport and volatile checkpoints.
Private shortcut rooms consume the native durable SDK while their grant and
publication workflow remains an explicitly unfinished application boundary.

`WorkspaceRepoLegacy` is the one execution door for current Promise APIs, not a
wrapper around the old Repo. Native modules neither launch programs nor import
that facade; the AST boundary guard enforces this. Cleanup must close consumers
before Repo: Repo close waits for outstanding leases. Scope finalizers run once,
so failed close retains native `RepoReleaseFailed.retry` rather than pretending
that a second Scope.close retries persistence. The store cache retains failed
owners and rejects replacement until release succeeds.

The local client retains the v7 wire format and physical connection. Effect
workers own imports, catch-up, bounded queues and deadlines. A join header alone
cannot finish a chunked snapshot; completeness and advertised version coverage
are required. A peer receipt does not count as a required server transport. The
queue is limited by both item count and an estimated 64 MiB of retained strings;
overflow explicitly requires resnapshot. Normal edits do not advance the epoch.

Same-store Doc cursors are reused only at foreground roots. Meta/Flock checkpoints
remain native replica-bound. Streams borrows the existing native token service;
there is no second token cache. Protocol failures retain private full Causes while
existing log formatters consume only upstream validated scalar projections.

Automatic repair preserves a generation still establishing its baseline; only
explicit backoff reset or an offline/failed route retires it. Repo error classes
can differ across pnpm peer contexts, so the diagnostic bridge recognizes the
originating constructor and creates public projections with the caller's bound
constructor. Real HTTP 503 MCP coverage verifies retryability without logging
private failure payloads.

The Legacy room projection must include attachment and routing, rather than
only the native detail ref: a newly queried ref starts `joining` even when its
transport is absent. Absence projects to `detached`, preserving local-only
workspace health. A first-sync waiter survives that deliberate absence and later
resolves on an attached baseline; actual attached-room failures still reject it.
CI exposed the missing projection through six desktop startup failures. The real
zero-cloud CLI composition and the pre-attachment/attachment/removal lifecycle
now exercise this contract. The observation fixture also borrows a releasable
native handle before handing ownership to SessionDocument.
After correction, native ownership/renderer recovery passes 62 cases, and CLI
observation/zero-cloud/recovery passes 18. The preceding CI passed static checks,
all component shards, other packages, conversation browser tests and the actual
desktop build; final CLI and desktop journey results require the corrected head.

Configuration saves remain local-first, but they do not order an independent
process-launch channel. A local ACP capability probe first takes a native room
receipt for the Machine Flock on the selected local peer. Its version coverage
proves the machine imported the newly authored config; a missing/offline receipt
prevents launch. Cloud transports do not participate in this local handoff, and
peer coverage is never server authority. This restores the causal ordering lost
when synchronous local send callbacks became asynchronous Effect workers. Tests
hold the handoff before launch, reject unconfirmed delivery, and synchronize a
real Flock configuration through the real v7 server and native transport.
Cancellation or workspace disposal while awaiting handoff also prevents launch;
a late receipt cannot start a process after its calling workspace has closed.

Legacy metadata observers project the completed catalog row when delivering a
metadata patch. Native row events can otherwise expose an intermediate owner/backend
combination to history readiness checks. Existing memory-only Legacy persist
methods retain their no-op behavior; the native lease persist API still requires
storage and never claims that memory is durable.

## Verification and limits

Behavioral coverage exercises shared Doc leases and last release, missing bodies,
typed storage load failures, failed-save retry, catalog observations and fresh
server authority; real SQLite/IndexedDB Streams checkpoint and protected snapshot
cases; real local-v7 server convergence after dropped writes; multi-chunk eager
prefetch; asynchronous store release failure and replacement fencing; and private
read-only shortcut SDK synchronization without echo uploads.

The real workspace-close regression verifies that a failed save exposes
`RepoReleaseFailed`, keeps storage open, and saves the original bytes before a
successful retry closes it. History ownership/recovery covers 62 cases; ACP batch
tests fake only their timeout and Date, leaving native fiber scheduling real.

Final affected package typechecks and `check:quick` passed. Shared tests passed
1,512 cases; final CLI/MCP regressions passed 203; renderer recovery passed 50;
native ownership/Streams plus the unchanged iOS suite passed 73. Root `format`
passed. CLI and OSS desktop builds and CLI bundle import/start smoke passed before
the last recovery/diagnostic corrections, so CI must rebuild the final commit.

The full root `check` was run but did not pass: migrated composition fixtures and
an iOS timeout failed, then passed their owning suites after correction. An
unchanged Git SSH fixture still fails in isolation with `context_unreadable`
(23 other cases pass); its cause is unresolved. The full root suite has not been
rerun after those fixture repairs. Final documentation checks are recorded in #1607.
Local browser fixtures do not prove live production, browser-process crash or
cross-platform acceptance. The host local server engine, SessionDocument wrapper
cache, Session/Turn/dispatch, shortcut grants/publication, RPC and migration target
uploads retain their existing registered application lifecycles. Host storage
relocation and the full WorkspaceData proposal remain unfinished.
