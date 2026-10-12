# Native workspace presence ownership

Status: proposed
Translation: current

[中文](2026-10-12-effect-workspace-presence.zh.md)

## Abstract

Workspace presence currently owns timers and Promise joins, but clears a remote
handle before its cleanup is confirmed and leaves expired bootstrap readers registered.
The proposed native kernel keeps synchronous CRDT state, owns heartbeat and remote
work in child Scopes, and retains failed releases with their complete Causes.
A shared application registry and one explicit Legacy facade will connect existing
consumers. Production integration is unfinished until the token and upstream
native ephemeral APIs are stable and consumed at a formally published version.

## Behavior contract

An authorized attach starts a remote generation; local stores and 30-second machine
heartbeats exist independently of cloud authorization. Remote detach first closes
admission, interrupts its work, starts transport shutdown, awaits actual exits with
an independent bounded observer, then closes its Scope. A timeout keeps the original
Fiber, resource owner and complete Cause reachable and prevents replacement.
Concurrent stop/detach callers share a Deferred receipt. Recovery joins original work
and invokes the underlying recovery API only after a failed release settles.
Reader cancellation ends only its bootstrap/barrier/token waiter, never the shared
producer or workspace token provider. Root shutdown owns workspace release; session
leases and the local relay pacer remain separate P6/P7 units.

The two stores preserve origin partition: the remote room merges into the workspace
replica; local relay encodes only locally authored state. CRDT encode/decode, parsing,
set/delete and snapshots remain synchronous. No periodic durable metadata writes,
second POST/SSE queue, per-workspace ManagedRuntime, or duplicate token cache is proposed.

Bootstrap readiness, captured queue barriers, send acknowledgements and peer receipt
are distinct evidence. A joined read loop cannot prove fresh delivery. Lack of upload
progress produces a bounded safe diagnostic without triggering automatic reconnects.
Health `idle` means the local queue is empty, not that a peer observed fresh state.
Terminal-room retries retain flap history and reassert latest local state after rejoin.

## Dependencies and integration limits

This partially replaces the workspace ownership mechanism described by the
[presence budget decision](../../implemented/architecture/2026-09-20-ephemeral-presence-channel-budget.md),
without changing its publisher rate/size obligations or three-state reader contract.
The root [roadmap](2026-09-27-effect-lifecycle-migration-roadmap.md) remains coordinator-owned.
The consuming CLI resolves Effect 4.0.2; its complete AGENTS and relevant resources,
services, Fiber/Scope and testing source are the implementation reference.
Scope.close does not join a previous close, and interrupting an uninterruptible
release cannot impose a deadline: explicit shared receipts and retained release Fibers
are required here. This is custom coordination over official Effect primitives,
not a transport reimplementation.

Committed acceptance uses injected native Services and real EphemeralStores.
Two additional isolated experiments consume the actual upstream native entry and
P4 token producer, as described below. They do not establish a formally published
dependency, the product durable Legacy facade, P1 log projection, doc/bridge
consumption or product application shutdown.
Those integration gates must be completed before claiming P5 delivery. No production,
npm publication, macOS/Windows, daemon end-to-end or throughput acceptance is claimed.


## Development evidence

Initial main was verified remotely at `3ac76bad10f46720517a2ca6929f03de4ef5bb9b`.
The isolated branch includes P1 `9c3d354bf283d7957b46f4bb2feb98e39310e5a0`
([#1503](https://github.com/LodyAI/Lody/pull/1503)); other clones and the parent
worktree remain unmodified. It also includes P4's stable implementation
`b79eea2df26e5ecd0e796e9dfd9c32a75a4d13b7` via the actually merged review head
`980b0e595df068ce08815423c9e4f5a61e9f5d73`. Local tested stack:
`9922c8efbc8bdbc31ce8cbcf7cea5f898285133a`; tested source commit
`f20df9c0ba41f79efa88f9fcf462cba750beeb1f`. After Git credential helpers timed out,
publication uses the authorized GitHub API. Remote foundation
`45ecfc491314794f9e0d2f1a9d3676956b0b7ddb` has the identical tree; commit metadata differs.
New native acceptance plus P1 logger/presence suites passed 44 cases;
the application owner's existing shell suite passed 18 cases.
The new Legacy consumer is tested through makeApplicationRuntime, including active
workspace disposal, failure retention and retry after the runtime closes.
Product doc/bridge consumers remain on the old presence implementation.

Retirement fences synchronous writes before notifying subscribers. A subscriber
defect does not skip lower I/O cleanup; complete Cause and a recovery owner survive
it. Explicit retry finishes remaining local retirement and records settled
heartbeat failures without erasing their history. Store destruction is marked
complete only after both real stores are destroyed. These are behavioral acceptance
cases, including writes attempted during a failed close.

The native port explicitly classifies typed SDK release failures: zero pending raw
operations does not mean a failed release succeeded. A first bootstrap still
pending at ten seconds gives a typed unknown-readiness failure and one safe diagnostic;
the shared join remains owned and can complete later, without a reconnect storm.
Readonly availability retires synchronously on a status callback, before the owned
status worker runs. The adapter must implement `isReleaseFailure` against the SDK's
public error type. No source tag or hidden fallback substitutes for that contract.

Temporary integration uses source snapshots from upstream stable
`1c5f4b8c32e4a55c04534871321363d0936acfc9`, including its exact streams-client
sources, bundled only in this clone's ignored directory. Native entry SHA-256:
`fc48c7c89ecb1a5767d656455af5fbf65a8c542228f71d66d6db99ec8f630207`.
Both explicit TestClock/Fetch/SSE experiments pass: an actual POST ignoring abort
keeps replacement fenced until physical settlement and successful retryCleanup;
one P4 native token producer survives room waiter cancellation while another
reader holds a refresh lease, then serves a replacement room that sends a real
machine state observed by another EphemeralStore. Stopping the room leaves that
provider usable. The other reader models durable demand; it is not the product
durable Legacy facade. SDK effects, rather than a Lody POST/SSE coordinator, own
the I/O in these experiments. No artifact, script, dependency override or local
tarball enters product source or the lockfile.

That success is revision-specific. Current stable upstream head `7126a255a5520e66ce05958d5a233b141b1601a2`
has the identical tree to experiment revision
`ad4ec1f6444d0d431753970580574c2d876938fd`; rebuilt entry SHA-256 is
`870f3ebd1a4a218ed66ae9c30a47d0f89bec4ce7c1b0728e7b525b4d2fdd02c7`.
Its rerun passes ignored-POST settlement but fails normal stop after shared-provider
replacement: EphemeralReleaseFailure retains Fail(EphemeralClosed) and a nested
release failure. The owning SDK has been given the controlled reproduction;
classification as a normal-shutdown versus real cleanup failure remains unresolved.
Lody retains the Cause and recovery owner rather than suppressing it. This is a
current integration gate, not grounds to freeze the earlier snapshot as ready.
Probes now call the native subscription's `syncBarrier()` to capture chain
membership immediately, rather than borrowing a lazily captured waitUntilSynced.

Registry verification still reports official streams-client 0.9.0 / streams-crdt
0.16.2. Their new native entry and client helpers require the upstream authorized
release flow. Product integration also needs a borrowed Legacy token facade using
the same workspace provider and application executor; the existing P4 factory
creates a separate owner and cannot be called alongside native acquisition.
No existing compatibility entry is removed in this draft. The new explicit
presence Legacy door is exercised by tests, not yet registered by product startup.

Three temporary mechanism ablations fail behavior assertions: removing the raw Exit
mask drops late typed cleanup failure, forgetting an unresolved generation permits
overlap, and returning immediately to a second close caller violates completion.
The last check uses an explicit second-caller admission signal. On pinned 4.0.2,
`exitFailCause` can strip Fail reasons when interruption skips a recovery handler;
a masked raw-Exit capture preserves the failure before restoring interruption.
Both typed failures and defects stay in the owning Cause. Probe latency uses the
local Clock; server correction applies only to published heartbeat timestamps.
Application disposal retains original owners for recovery while including subsequent
recovery Causes in shared receipts. Scripts remain outside product source.
Workspace typechecks and type-aware lint passed. The previous complete check
reached CLI tests and failed 15 cases in five unrelated process/transport suites;
replacing the sole changed existing production owner with its P1 baseline reproduces
the same 15 failures and four unhandled errors. The stacked root check completed
typecheck/lint and reported CLI 4,045 passed, 17 failed, one skipped and four
unhandled errors. Its two extra worktree cases also time out with the unchanged
application owner at a five-second diagnostic limit (two additional selected
worktree cases also time out there). Other recursive suites, including Electron,
did not complete; component failures observed before abort are not claimed resolved.
Final CLI typecheck, owning behavior suites and serial root lint cover subsequent
clock-fixture and barrier refinements. Root consumers explicitly provide TestClock,
including an observed machine heartbeat, rather than relying on wall time.
Concurrent deletion of a temporary integration test crashed one lint attempt;
serial rerun passes with zero errors. These results do not establish a green full check.

`pnpm format`, `pnpm format:check`, i18n and all five boundary guards pass.
Read-only docs check has six existing absent Kimi/Pi submodule links, no new errors
and no SHA-protected topics; submodule gitlinks are unchanged. No routine snapshots,
validator output or experiment logs are committed. The external-contributor body
checker requires issue/transcript fields that do not apply to this internal PR;
its actual required sections and Mermaid view are preserved without inventing them.
