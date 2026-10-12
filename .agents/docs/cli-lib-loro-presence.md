# CLI presence: origin partition, single ownership, delivery budget

How the CLI produces liveness on the Loro ephemeral presence channel, and what bounds
every writer. [`apps/cli/src/lib/loro/AGENTS.md`](../../apps/cli/src/lib/loro/AGENTS.md)
requires this page to be read before presence is published or `presence.ts` /
`session-active-presence.ts` change, because the rules below bind those files. Human
intent and the reader contract are in
[`specs/loro-ephemeral-presence-channel.md`](../../specs/loro-ephemeral-presence-channel.md).

## The channel is a shared, serial delivery budget

Durable documents and presence travel on different transports. Healthy conversation
sync therefore proves nothing about presence delivery, and a machine can sync
perfectly while reading offline.

One workspace owns ONE presence transport, and the machine heartbeat shares it with
every other presence writer in that workspace. Publication is serial. In
`@loro-dev/streams-crdt@0.16.2`, the built-in `EphemeralStoreAdaptor` supplies
`localUpdateKey`: newer single-key set/delete updates replace older unsent updates
for the same key, while in-flight and unknown/multi-key updates remain independent.
All three Lody construction sites use that adaptor directly. Coalescing does not
prioritize heartbeats or bound distinct-key traffic, so publishers still own the
rate and size budget. The subscription's `pendingLocalCount` counts unacknowledged
logical updates, not the number of POSTs after coalescing.

The failure mode is specific and quiet. A heartbeat's `updatedAt` is taken when the
entry is created, not when it is sent, so an entry that waits longer than
`LODY_PRESENCE_TTL_MS` (90s) arrives already expired — readers receive it and still
classify the machine offline. Throughout, the room reports `joined`, because a backlog
that drains successfully is not an error; `handleRoomStatus` only reacts to `error`
and `disconnected`, so no recovery path observes the problem, and `joined` even
triggers `republishLocalState()`, adding more writes.

### What this forbids

Trigger a presence write ONLY from a timer, a lifecycle transition, or a user
navigation. Never from a stream, progress or chunk callback, however small one payload
is. Throttle a high-rate source to a fixed ceiling before it reaches the channel, so
the publication rate is a property of the publisher rather than of the source. Bound
every field in `packages/shared/src/presence.ts`; unbounded strings and accumulated
text are not liveness state.

`SessionActivePresenceController.setPhase` dedupes on `(phase, detail)`. That guard is
NOT a rate limit: a `detail` that changes on every emit — a percentage, a counter, a
streaming label — defeats it completely and publishes at the source's rate.

`packages/shared/src/local-loro-data-plane-server.ts` relays presence to the renderer
over local IPC and already collapses a burst into a single frame, snapshotting at
write time. It is the template to copy when a producer is genuinely bursty.

## Token-provider ownership

Durable and ephemeral consumers may borrow the same token provider, but each
native auth call owns only its waiter lease. Cancelling one call cannot abort a
refresh another lease still needs. Last release, credential replacement and close
await actual token I/O; bounded failure retains the old owner and fences new work.
Only terminal credential auth failures become undefined; transient failure,
deadline, interruption and cleanup failure stay observable. The official cloud
composition provides native token ports, while unmigrated consumers retain the
explicit Legacy facade. See [the provider contract](../../packages/shared/src/loro-streams-token/README.md).
This does not change presence payloads, rate limits or durable CRDT work.

## Two stores, partitioned by origin

`CliPresenceRuntime` (`presence.ts`) keeps TWO stores and the distinction is
load-bearing:

- `store` is the workspace-wide replica: this process's writes PLUS every peer seen in
  the shared room. Machine-online checks and the PR poller read it.
- `localOriginStore` holds ONLY entries this process authored, and is the sole payload
  of the local data plane (`encodeLocalOriginPresence` / `subscribeLocalOriginPresence`).

The local plane splits by ORIGIN, not by content. Relaying the replica would hand the
renderer's "local" snapshot authority over peers it already replicates live from the
cloud. Write locally-authored presence exclusively through `writeLocalOrigin` /
`deleteLocalOrigin`, never directly to a store; `specs/local-first-two-plane.md`
explains the partition.

Presence production does not depend on the cloud. The store and the 30s heartbeat
timer run whether or not `attachStreams` ever happens, so a local-first renderer reads
liveness over the local plane while offline.

## Session active presence has exactly one owner

`session-active-presence.ts` alone owns session active presence. It starts once for a
visible CLI turn, accepts phase updates, heartbeats while active, and clears on the
owning Effect release. Never publish or clear session presence from `setStatus`, RPC
dispatch, permission or image callbacks, or watcher recovery paths — a second writer
makes the clear path unreliable and leaves sessions showing work that ended.

Its scope covers ALL turn-finalization stages, so optional cloud side effects inside
it (usage flush, completion notification, Live Activity sync) MUST go through
`MessageHandler.runTurnCloudSideEffect`. Third-party calls such as GitHub and model
APIs are a different reachability domain and are NOT gated by it.

## Reading liveness

Machine liveness is three-state, and the states are not interchangeable. A fresh
heartbeat means online. The absence of one on a SYNCED transport means offline. An
unsynced transport means unknown. `getOnlineMachineIds()` returning null means the
presence room is not joined — status unknown, not offline.

Carry that distinction all the way to the consumer instead of flattening it. Only a
definite offline may block work: the MCP dispatch guards refuse on `'offline'` alone,
so a Machine whose presence room merely has not joined stays usable and fails later
against its own deadline if it really is down. `lody machine list` reports
`onlineStatus` (`online` / `offline` / `unknown`) beside the legacy `online` boolean, so
a `--json` consumer parsing stdout is no longer told a confident offline when the truth
is that nothing could be checked.

Durable `MachineMeta.lastSeen` is retired and is not written even at registration;
machine online checks read presence only. Never reintroduce periodic doc-meta writes
(`lastSeen` / `lastRunningSeen`): they stall Loro flush, and meta timestamps are
written only at status transitions.

## Diagnostics and their evidence boundaries

`presence.ts` temporarily observes the existing auth and fetch boundaries; it does
not duplicate the upstream queue. Each remote attachment has a diagnostic generation.
Attempt numbers identify observed auth/fetch calls, not retries or heartbeat IDs;
auth calls cannot be attributed to read versus write by the published callback.
Successful individual events use trace (`LODY_LOG_TRACE=1`); slow completions use
debug. The machine heartbeat samples health at most once per 30s: pending auth/POST
ages or accumulated failures select warn, otherwise debug. Failures also request
that rate-limited summary; a suppressed failure remains counted for the next one.

| Stage / field | What is actually observed |
| --- | --- |
| `local_update` | Local store write; `pendingLocalCount` counts logical unacknowledged updates, including in-flight and superseded writes. It is not queue depth or queued-ahead count. |
| `auth_start` / `auth_ready` / `auth_failed` | Actual callback starts/completes/rejects. `authPending` and `authAgeMs` retain still-pending raw callbacks. No token or callback context is logged. |
| `post_start` / `post_response` / `post_failed` | Actual fetch starts, returns response headers, or rejects. HTTP 200/204 is accepted by this upstream writer; response timing is not the exact send time. `postPending`, `postAgeMs` and `sincePostResponseMs` describe observed requests. |
| `read_response` | GET response headers, not SSE bootstrap, body consumption, or continuous read health. Workspace snapshots independently show received peer state. |
| `barrier_complete` / `barrier_failed` | One `waitUntilSynced()` snapshot of chains completes/rejects. Same-key successors may replace the original heartbeat; later independent chains are excluded. `barrierAgeMs` is barrier latency, not heartbeat age on arrival. |
| `queueAgeMs`, `retryAttempt`, `peerReceipt` | `unavailable`: the published ephemeral API exposes neither entry age/retry identity nor peer receipts. Auth/fetch attempt numbers cannot fill these gaps. |
| `close_returned` | Upstream close returned. In 0.16.2 it rejects barriers and detaches local updates but can leave POST running without aborting its signal. This is not confirmed I/O cleanup. |

The ephemeral subscription inherits optional `lastLocalAppendAtMs` and
`lastWriteError` declarations but does not implement their getters in 0.16.2.
Diagnostics do not read them. A joined read side can coexist with a blocked POST;
bootstrap can also precede a stuck outbound flush while `join()` has not returned,
so `room` and `pendingLocalCount` may be unavailable before acquisition completes.

Effect logs route through the existing daemon file logger. The adapter reads v4
annotations from the fiber reference and projects only known numeric fields and
closed enums; Cause output contains reason categories, not error contents. No new
telemetry sink is added. Log messages must themselves remain content-free.

Replace the temporary auth/fetch observer when a pinned published upstream native
API supplies equivalent safe stage events and truthful completion receipts. Preserve
these real-boundary regressions while doing so. Presence/token/Turn ownership has
not migrated here; the lifecycle gap remains for the native upstream and Lody owners.

## Diagnosing "machine shows offline"

1. Read independently with `lody machine list --workspace <selector> --json`. A room warning means unknown, not offline. Compare another workspace on the same machine to isolate its transport.
2. Read the rate-limited `health` records in the configured Lody data directory's logs. `room=joined` and growing `postAgeMs` isolate a pending POST; growing `authAgeMs` with no POST isolates a callback wait. Neither proves a production root cause.
3. Enable trace for individual local/auth/POST/barrier events when needed. Check the diagnostic generation and attempt, never interpret a barrier as that heartbeat's exact send or a peer receipt. Slow/failed branches remain available without trace.
4. Check publishers against the rate/size budget. Coalescing helps same-key unsent writes, but distinct-key traffic and in-flight bytes remain independent. Do not infer physical POST counts from `pendingLocalCount`.
5. Keep transport status, local writes, server response, snapshot barrier completion and peer observation separate. Restarting destroys the evidence and does not fix a flooding writer.
