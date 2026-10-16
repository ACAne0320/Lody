# Workspace Repo ownership

`repo.ts` composes the released `loro-repo/effect` API. Provide `WorkspaceRepo`
through its Layer, then borrow document and room leases in the caller's Scope.
`openWorkspaceDoc` preserves absence; `createWorkspaceDoc` registers a new identity.
`SessionDirectory` reads the shared native catalog without opening document bodies.
`SyncAuthority` requires fresh server confirmation for remote workspaces and uses
local authority without cloud requests in local-only composition.

`streams.ts` supplies native Streams transports using the existing token service.
`local-transport.ts` implements the v7 peer protocol with scoped workers, bounded
input and version coverage receipts. Peer convergence is never server upload proof.
Foreground SQLite/IndexedDB roots explicitly reuse same-store document cursors;
Meta/Flock progress always belongs to the exact loaded replica. Prefetch workers
use isolated memory and volatile checkpoints.

Existing Promise consumers enter through the deprecated `WorkspaceRepoLegacy`.
It executes the same native Repo and owns child Scopes; it does not instantiate
the old Repo. Store disposal stops projections before releasing the native lease.
Release failures fence replacement until retry succeeds. Shutdown closes consumer
Scopes before Repo close, retaining original failed owners and Causes for recovery.

This adoption does not migrate upper Session/Turn orchestration, shortcut grant
lifetimes, the host's local server engine, RPC or OSS migration target uploads.
The proposed WorkspaceData host/storage relocation remains separate.
