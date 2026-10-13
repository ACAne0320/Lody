# Bind cloud execution to machine access and authenticated content

Status: implemented
Translation: current

[中文](2026-10-12-machine-execution-authority.zh.md)

## Abstract

Workspace MCP rows and machine Provider rows are replicated configuration, so a
peer can change executable content without owning the destination machine. The
fix preserves owner Web access to private machines while requiring live sharing
for other members. Cloud turns and RPC envelopes carry authenticated content
proofs; private launch paths use local trusted Provider snapshots and reject
workspace MCP. Shared machines intentionally continue accepting workspace
executables, and a crash after durable admission may require a new request.

## Decision

The policy is described in [the draft Spec](../../../../specs/machine-execution-authority.md).
A claimed `userId` in replicated history cannot implement it: the identity must
come from the authenticated authority. Sign queue content at authoring, normalize
through the history write schemas, and verify before dispatch; signing mirror
container IDs breaks promotion. Native session fallback also needs local authority; private machines cannot replay
unsigned replicated history when native resume is unavailable.

Provider saves normalize before signing. Private final launch, speculative launch,
setup probes and Codex account freezing all use the same trusted resolver. A valid
owner update replaces the local snapshot; unsigned peer changes cannot replace it.
This avoids a general per-MCP approval UI while keeping private machines outside
the workspace command trust boundary. Shared-machine sandboxing and comprehensive
Provider revocation remain separate decisions.

## Verification

The subsequent MCP correction replaces the blanket private-machine ban with
authenticated owner executable revisions and a persistent last-accepted fallback.
Only full connection Save requests a new proof; metadata/default changes cannot
launder peer commands. CLI partial connection edits inherit trusted fields only.
The signed payload separates executable revision from preference timestamps.
OS-local turn/Provider authoring now obtains owner-bound HMAC proofs through the
existing local control endpoint, without hosted signing. Tests exercise the real
local handler, concurrent key initialization, proof scope, MCP replacement/rollback,
and the real Flock writer's default-toggle boundary.

Further adversarial review found automatic Provider migration, setup Retry and
partial Pi migration could authorize inherited peer launch fields. Generic writes
now preserve proofs without minting them; only full create/edit submissions opt in.
The local cache reads the committed signed row. Real Flock regression tests cover
these write variants. MCP catalog read failure can also fall back to accepted local
snapshots; unknown selections still fail closed. Partial Pi migration compatibility
remains to be resolved alongside the other workflow gaps below.

This is still a work in progress against the no-regression requirement. Legacy
migration is awaiting a trust decision. Remote send acceptance, offline MCP saves,
private history fallback and the complete offline launch path remain unresolved;
no full three-platform E2E or Windows pipe ACL validation has been performed.

Correction after owner review: the initial patch is implemented but does not meet
the requirement to preserve normal Web, desktop and mobile workflows. In addition
to the private MCP/Provider/replay restrictions, `authorizeTurn` waits for hosted
authorization before the local writer accepts a turn, including dual-plane desktop
workspaces. This violates the existing local/offline send acceptance boundary.
The revised Spec records these gaps; the patch must not be described as experience-neutral.

Behavioral tests cover authenticated owner/private and member/shared admission,
revocation and tampering, queue edit/promotion through real Loro storage, private
Provider resolution, and durable replay receipts. Existing launch/dispatch suites
are included in local verification. Hosted multi-user and real ACP end-to-end
execution have not been exercised for this patch. Adversarial review found no
remaining confirmed P0/P1 within this policy after the replay bypass was fixed.
No PR was opened.

Workspace typechecking, changed-file type-aware lint, targeted regression suites,
documentation checks and public/platform/import boundary guards passed.
`pnpm check:affected` fell back to the full check and stopped at existing lint
errors in unchanged `docs/e2ee/x02` and `docs/e2ee/x03-platform` scripts; the full
repository check is not green.
