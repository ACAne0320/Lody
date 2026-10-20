# Local external MCP access

Status: draft
Translation: current

[中文](external-mcp.zh.md)

A user can connect another local Agent to Lody using an HTTP URL and bearer token,
without inventing a Lody caller Session or keeping a Turn active. Access is opt-in.
The shared HTTP host remains loopback-only, with a separate external route and
local token bound to the installation's user, machine and one workspace. This
local token is distinct from both internal MCP credentials and cloud CLI account
tokens. Local composition must not authenticate against the product cloud.

External tools share business services with internal MCP. First-release writes
create standalone Sessions or send input to the authorized user's Sessions on
this machine. Reads provide authorized resource discovery, own-user/own-machine
Session summaries, live status, bounded history and external request receipts.
No internal caller identity, parent relation, automatic completion callback or
ambient shell Session is inferred. Token possession authorizes these actions as
the bound user; every authoring request rechecks the credential and daemon scope.
Revocation rejects new calls, but does not cancel previously admitted work.

Each write requires an operation id. The server fixes its Session/Turn ids and
claims the request before invoking the write service. Reusing an id with different
arguments rejects; the same id never submits a second write. Interruption after
claiming is an uncertain outcome, not permission to replay. Clients inspect the
fixed targets and must not automatically replace an uncertain request with a new
id. An accepted receipt describes dispatch acceptance, not task completion.
External receipts have no automatic expiry and survive local token rotation.

## Evidence

Implementation and limits: [MCP README](../apps/cli/src/mcp/README.md#http-and-loopback).
This draft records the new external authentication and request-durability contract;
it does not approve or alter the internal [Session orchestration](session-orchestration.md) contract.
