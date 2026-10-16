# Workspace Repo ownership

Workspace roots call `make` from `loro-repo/effect` in their owning Scope.
Borrow document and room leases in caller Scopes; `openDoc` preserves absence,
while `createDoc` explicitly registers an identity. CLI directory reads and metadata
confirmation use this Repo directly at their business entry points.

`streams.ts` configures the native SDK with the existing token service.
`local-transport.ts` is the product's v7 client. The previous client is a frozen
host compatibility fixture under `test-support`, excluded from package exports.
Peer convergence, server upload confirmation and local durability remain separate.
Same-store Doc cursors are reused explicitly; Meta/Flock checkpoints stay bound
to their replica, and isolated eager workers use volatile checkpoints.

Existing Promise consumers enter through `WorkspaceRepoLegacy`. Store disposal
stops projections, then releases the native lease; failed release is automatically
retried by the next acquire. Workspace shutdown continues independent cleanup and
reports failures afterwards. Calling dispose again retries retained owners while
new work stays fenced; unsettled writes keep their storage owner.

Room handles retain the native `RoomLease` and the small UI status view still in
use. Inventory and transport snapshots come from native leases; the local owner
registry exists only to release borrows during purge. Native reconnect retries
failed attaches and owns pending SDK work. Application recovery loops request
that operation rather than supervising a second set of per-room rejoin jobs.
The local v7 client keeps its 1,024-event and default 64 MiB queue bounds.
After overflow, reconnect (including a physical online edge) drains the failed
worker and replaces its queue, clears incomplete protocol state, then catches up
from the retained replica. Pending barriers fail; new barriers can succeed after
recovery. The Doc/Meta/Flock leases and other rooms remain owned by their Scopes.
Native waits at Promise entries use the room borrow's signal so retiring one
Session cancels only its wait while independent borrowers remain writable.
First-sync readiness stays separate from `waitUntilSynced`: the latter captures
the current version for a server upload ACK, or requires a selected peer protocol
receipt. Offline, absent and unsupported routes cannot report write success.
Transport Scope owners are registered before adapter construction and native
connect. Removing one cancels its acquisition and closes its Scope, including
native registration and accepted connection work. Late completion cannot publish
the old owner or delete its successor; the next add retries failed release.

The writer records newly authored Provider rows. A local ACP probe waits for
Machine Flock peer coverage only while its config has a pending write, returning
a failure response on an unconfirmed handoff. Routine refreshes do not wait for
the data plane; saves remain local-first. Cancellation or disposal prevents late
process launches.

Implementation rationale and acceptance limits: [native ownership](../../../../.agents/notes/proposed/architecture/2026-10-16-native-workspace-repo.md).
