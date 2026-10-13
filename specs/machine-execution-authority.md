# Machine execution authority

Status: draft
Translation: current

[中文](machine-execution-authority.zh.md)

A machine owner can send a turn from Web, desktop or mobile without sharing the machine. Other
workspace members may execute on it only while the owner shares it. Sharing is
consent to workspace executable configuration, including workspace MCP servers;
workspace membership alone is not that consent.

## Revised acceptance criteria

The owner requires preserved normal workflows on every client, including MCP,
existing Providers, session recovery, and desktop local/offline sending. A blanket
private-machine feature ban or cloud authorization before local message acceptance
does not meet this requirement. No platform may receive weaker authorization merely
because it is local: replicated document contents do not prove transport authorship.

The implementation remains incomplete against these criteria. Configurations are
approved at explicit connection Save, never implicitly by Send or a default toggle.
Legacy unsigned configuration migration is unresolved: silently adopting an existing
replica accepts possible pre-upgrade contamination; authenticated ownership cannot
be reconstructed from `createdBy`. No migration policy has been selected.

## Current implementation (requires further revision)

Cloud clients obtain authenticated, content-bound authorization for turns and
Machine RPC envelopes. The daemon verifies it against current machine access
before dispatch. Replicated user IDs, defaults and terminal markers are not
identity, consent or replay protection. Local-only compositions keep their local
transport and do not call cloud authority. CLI delegation requires access for
both the CLI credential user and the driving requester.

Desktop local turn/Provider authoring uses the existing OS-local control channel
to obtain a host-key proof bound to the daemon owner, destination and content;
it does not need cloud authorization. This is not trust in locally replicated data.
Remote authoring still awaits hosted authorization; preserving offline local
acceptance for Web/mobile and the complete desktop launch path remains open.

Private machines resolve MCP from authenticated owner-saved executable revisions or
the last locally accepted version. Peer replacement, deletion or stale revision does
not replace that trusted executable. Full connection Save authorizes a revision;
metadata/default toggles do not. CLI connection edits inherit only trusted fields.
An unapproved MCP is omitted rather than rejecting the whole session. Provider execution uses
a host-local specification created locally or explicitly saved by the authenticated
owner. Untouched builtins may bootstrap from the host's static implementation;
custom commands, runtime overrides, environment and account bindings may not.
The same rule covers preparation, restore and capability probes. Workspace GitHub
setup/cleanup scripts are disabled on private machines; locally stored project
scripts remain local configuration. Native conversation fallback comes from the
host's session mapping, not mutable replicated metadata. Private machines also
reject automatic replay of untrusted workspace history after native resume fails.

A signature binds the destination and execution payload. Queue editing signs new
content; promotion uses the same normalization as authoring. Durable host receipts
admit each RPC/turn identity once. A crash after admission can require a new request
rather than replaying a possibly executed command. Sharing revocation blocks new
admissions; it does not terminate a process already started.

## Compatibility and limits

Deploy the authority endpoint before the matching clients/daemon. Old unsigned
cloud requests fail closed and need to be resent with an updated client. Customized
legacy Providers and unsigned MCP configurations still lack a migration policy.
Cloud authorization needs backend availability. Local approved Provider
snapshots are retained; this is not a comprehensive approval/revocation UI or a
sandbox for shared machines. Already shared machines intentionally retain workspace
command execution under the agreed trust model.

## Evidence

- `packages/shared/src/machine-execution-authority.ts`
- `packages/components/src/providers/workspace-writer-impl.ts`
- `apps/cli/src/lib/loro/doc.ts`
- `apps/cli/src/lib/message-handler.ts`
- `apps/cli/src/session/session-manager.ts`

Hosted identity and sharing enforcement are supplied by the cloud authority port;
this public repository does not contain that backend.
