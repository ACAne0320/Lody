# Workspace Repo ownership

Workspace roots call `make` from `loro-repo/effect` in their owning Scope.
Borrow document and room leases in caller Scopes; `openDoc` preserves absence,
while `createDoc` explicitly registers an identity. Directory and metadata sync
helpers bind directly to that Repo, without an extra Context or Layer.

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

The writer records newly authored Provider rows. A local ACP probe waits for
Machine Flock peer coverage only while its config has a pending write, returning
a failure response on an unconfirmed handoff. Routine refreshes do not wait for
the data plane; saves remain local-first. Cancellation or disposal prevents late
process launches.

Implementation rationale and acceptance limits: [native ownership](../../../../.agents/notes/proposed/architecture/2026-10-16-native-workspace-repo.md).
