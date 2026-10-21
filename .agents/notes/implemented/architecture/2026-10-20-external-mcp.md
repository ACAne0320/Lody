# Local external MCP access

Status: implemented
Translation: current
PR: [#1766](https://github.com/LodyAI/Lody/pull/1766)

[中文](2026-10-20-external-mcp.zh.md)

## Abstract

External agents can now use the local Lody HTTP host without an active caller
Session. A separate opt-in route authenticates a workspace-scoped local token and
reuses discovery, history and Session command services, while internal MCP retains
its active-Turn authorization. External writes persist fixed request/target ids
before submission and never automatically replay uncertain outcomes. The first
release covers discovery, own-user/own-machine Sessions and task submission/result
inspection; it does not provide cloud account-token authentication or completion
callbacks.

## Decision and scope

The selected deployment is the existing loopback HTTP host, using `/mcp/external`.
`mcp access enable` issues a token shown once, `status` reports its endpoint, and
`disable` revokes new calls. Only a hash and explicit user/workspace/machine binding
are persisted. Rotation preserves external request identities. The CLI queries the
supervisor's current port through local IPC health, without an endpoint file or
cross-daemon port persistence. The supervisor retains its preferred port in memory
for host recovery; a daemon restart may change the client URL. Probe responses
contain only the port, never the internal token. Missing support and a temporarily
unavailable host remain distinct errors, and query failure cannot rotate a token.

This is a new authentication/durability boundary requiring human review, recorded
in the draft [external MCP Spec](../../../../specs/external-mcp.md). The existing
[daemon-hosted MCP decision](2026-10-16-daemon-hosted-mcp-workspace-commands.md)
continues to govern internal callers. Neither the Spec's draft status nor passing
tests implies human approval of the detailed contract.

Discovery reuses the catalog registration and resource service; history uses the
same bounded reader. Create/chat reuse existing command services through a daemon
entry authenticated independently from Session tools. Reads/writes of Sessions
are restricted to the bound user's Sessions on this machine. Creation requires an
Agent config and optionally a local project, with model/mode/config options.
No Roles, attachments, parent selection, batches, schedules or catalog mutations
are exposed as external writes. Explicit `currentSessionId: null` prevents ambient
`LODY_SESSION_ID` from supplying a caller or creation provenance.

## Request ownership and failure behavior

The internal Operation store keys requests by parent Session and owns automatic
Inbox continuations. Reusing it unchanged would fabricate provenance. External
receipts instead key by user/workspace/machine/operation id, storing a canonical
argument hash and fixed Session/Turn ids, without prompts, tokens or output.
Exclusive file creation claims the write before invoking the command; files use
0600 and new directories 0700. Concurrent duplicates cannot execute again.

The daemon owns admitted commands independently of HTTP waiter disconnection.
Both HTTP and authoring boundaries check the current credential; revocation
affects subsequent admission, not work already admitted. Successful command
return plus repo flush marks acceptance, not Agent completion. A crash or failure
after the claim remains uncertain and requires inspection of its fixed targets.
There is no automatic materializer, expiry or receipt deletion; new token
generations do not permit reuse of old request ids.

Effect feature/fix assessment: the changed services and HTTP owner still depend
on existing Promise command orchestration. This change does not migrate those
owners or claim native lifecycle completion. The HTTP/CLI application boundaries
use the existing native IPC/catalog programs; new receipt I/O is a filesystem
adapter with no independent timer, runtime or recovery worker.

## Validation and limits

Tests exercise real daemon-owned Loro history creation/chat, fixed-id retries,
absence of parent provenance, hidden tools, cross-user denial, credential
rotation/revocation, persistent receipts and concurrent duplicate fencing.
The real MCP client is exercised over in-memory transport, and HTTP admission
has an in-memory request/response test. CLI type checking and public/platform/
local-writer/Inbox boundary guards pass. This does not claim testing with a
third-party desktop client, a hosted cloud account, or power-loss fault injection.

Endpoint tests cover unsupported older daemons, unavailable/live/recovered hosts
and fresh port reads. The existing IPC server suite verifies dynamic port changes
through the real probe handler and shared client parser.
