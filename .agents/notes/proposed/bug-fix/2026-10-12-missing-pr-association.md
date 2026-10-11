# Explicit confirmation for missing session PR associations

Status: proposed
Translation: current

[中文](2026-10-12-missing-pr-association.zh.md)

## Abstract

A machine can publish a verified PR summary while hosted association fails, so
the PR tab has a link but cannot verify the session's repository identity.
Retry can stamp a proven existing legacy link; it cannot reconstruct a missing
original binding from a URL or PR cache. This change offers workspace
administrators an explicit new association after reviewing the currently verified
PR. It preserves automatic fail-closed behavior and GitHub authorization; it does
not recover unknown historical provenance.

## Decision and limits

Repository names can be reused, and session PR summaries contain only URL/status.
A current cache row's numeric repository ID proves the PR's repository, not the
historical session's original repository. Automatically rebuilding a link from
those facts would silently attach old sessions to another repository.

The server distinguishes a missing association from existing unverified or
conflicting links. Only a real app-authenticated workspace owner/admin can preview
and confirm a new link. Preview verifies the live GitHub App/workspace/repository
connection and actual PR. Confirmation compares the same repository ID and PR
node ID, then atomically rechecks membership, deletion fences, repository access,
installation ownership/liveness and conflicting associations. It inserts the
missing association without replacing legacy links or PR caches. A unique link
with the same verified numeric ID is idempotent; if a concurrent CLI link used a
renamed repository, confirmation updates only its lookup alias, preserving the
binding and creation time. The requested name remains a lookup alias; canonical
reads use the immutable repository ID, including after rename.

Consent is scoped to the app login, workspace, owner-session and PR. Changing
any target invalidates it, and failed confirmation requires a fresh preview.
Ordinary Retry never invokes confirmation. The UI accurately calls this a new
association for details and future updates; later webhook fan-out may update PR
metadata. The backend does not read Streams or establish session existence.
The UI uses the selected owner-session, and navigating away discards its preview.

The alternative is preserving the blocked state until machine reconciliation
succeeds. Original immutable session provenance would permit a separate automatic
recovery protocol, but those facts were not captured for historical records.
Machine credential read fallback and authorization-isolated read caching remain
separate work. Issue #1378's exact production rejection is not established by
this repair; tests reproduce the missing-link state at the client/server boundaries.

## Verification

Behavior tests exercise missing links with a populated numeric PR cache, explicit
confirmation, canonical reads after rename, idempotence, unauthenticated/member
callers, identity changes, role/revocation/deletion races and conflicting records.
UI tests cover blocked read/write gates, visible preview errors, explicit consent,
and stale previews after navigation or login changes. Fixtures are synthetic;
no production association is changed during verification.

Contract: [PR observation](../../../../specs/local-github-pr-observation.md).
Related publication decision: [observation/association independence](2026-10-01-pr-observation-association.md).
