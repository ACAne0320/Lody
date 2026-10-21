# Device login confirmation and Better Auth 1.7

Status: implemented
Translation: current

[中文](2026-10-22-device-login-confirmation.zh.md)

## Abstract

The device page previously approved a code immediately after checking only the
verification response status. A user tricked into approving an attacker's code
could hand that device an account session. Better Auth 1.7.12 supplies the checked
client and scope; the page now requires a separate review and explicit decision.
The flow still returns a full application session, so displaying scope must not
imply that it restricts that session. Deployed cloud and packaged native login
remain separate validation boundaries.

## Decision and evidence

[GHSA-q84f-53jg-9ppm](https://github.com/better-auth/better-auth/security/advisories/GHSA-q84f-53jg-9ppm)
first shipped a fix in 1.7.0-rc.3; no 1.6 release fixes the missing client/scope
review. This supersedes the version choice in the
[1.6 baseline](2026-09-30-better-auth-1-6.md), not its runtime/auth contracts.
Pin the core, API-key and Electron packages together to 1.7.12 and utils to 0.5.0.
The existing unified Zod override advances to 4.5.4 to satisfy this dependency
set. Release-age exceptions name only the selected security release graph.

The page uses only `GET /api/auth/device` data for a pending request. It checks
its code and the allowlisted `lody-cli` identifier before selecting the trusted
Lody CLI display name. It displays the exact scope string, including an explicit
empty-scope state, and warns that public identifiers cannot authenticate a device.
A prefilled link never approves automatically. Approval and denial recheck the
request; changed details or network failures discard confirmation. Account or
session changes remount the flow and late responses cannot restore confirmation.
The 1.7.12 package source binds review/decision ownership to the user ID; do not
infer the stronger same-session restriction from newer online documentation.

Keep the API-key patch removing request-time expired-key sweeps while retaining
the explicit cleanup endpoint. Electron 1.7.12 already removed the Node-only
imports: its new patch preserves constant-time challenge comparison and leaves
upstream S256 generation and single-use verification consumption intact.

The Convex integration remains 0.12.5 and declares Better Auth `<1.7.0`. This
upgrade intentionally crosses that unsupported peer range to address the
advisory. Consuming cloud applications must validate their adapter and schema
compatibility separately before rollout; changing the peer declaration alone is
not evidence. The public patch preserves the SDK's existing discovery document and removes its
reference to the removed Better Auth OIDC helper. That helper was never registered
as an authorization provider: this does not replace or remove an enabled provider.
The consumed SDK's generated declarations and schema-generation options are updated
alongside runtime source. Client/react entry points, cross-domain cookie handling,
JWT creation and API-key behavior are unchanged. Hosted adapter atomic operations
and persisted schema remain the responsibility of the consuming cloud application.
A regenerated schema must not silently delete historical OIDC tables.

Better Auth 1.7 moves device/user code uniqueness from field flags to table-level
indexes. The SDK patch also recognizes single-field unique indexes and maps
`fieldName`; compound indexes must not make individual fields unique. Creation
and update retain their indexed uniqueness check inside the existing Convex
mutation. Pre-existing duplicates fail closed rather than selecting the first row.
New duplicate errors include `Unique constraint`, which the official device-code
generator recognizes for its bounded collision retry. No records or tables are
rewritten by this patch. The companion regression exercises the real component
API, both code collisions and legacy duplicates. Independent counterexamples also
cover renamed fields and compound indexes.

Public review: [LodyAI/Lody #1798](https://github.com/LodyAI/Lody/pull/1798).

## Verification and rollout boundaries

The owning route suite exercises explicit review, approval and denial, malformed
or untrusted responses, failures, changed request details, account changes and
late responses. Storybook includes confirmation, empty-scope and denial states.
Workspace `pnpm check`, final full typecheck/lint, CLI and Electron production
builds, frozen/offline lockfile validation and documentation checks passed. The
final auth-focused suites passed 68 tests, including discovery compatibility and
native/cross-domain session contracts. The dependency audit contains no Better Auth
advisories; unrelated historical findings remain outside this change. Neither local tests nor a clean advisory result proves
real-account OAuth, cross-domain cookies or packaged Electron/Capacitor login.

Retain the earlier patch files until consumers advance. Merge the public change
first, promote the consumer submodule pointer separately, then merge its matching
private integration. Never bundle that pointer change into its feature PR.
