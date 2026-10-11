# Public E2EE implementation and Lab ownership

Status: proposed
Translation: current

[中文](2026-10-11-e2ee-complete-migration.zh.md)

## Abstract

The prototype contains protocol and Lab behavior missing from public main, alongside superseded formats and reproducible trust and lifecycle failures. The migration assigns every source file to one public owner or an explicit retired/undecided/linked disposition, preserving the hardened primitives already present. Public architecture text is migrated as draft intent, while private plans and production material stay in their source repository. Implementation proceeds in dependent Draft layers; permanent-loss backup, recovery-vault encoding and atomic-removal encoding remain decision gates.

## Responsibility and evidence

The [migration guide](../../../docs/e2ee-migration.md) owns the stack, shared-file responsibilities, decision gates and acceptance boundaries; its [manifest](../../../docs/e2ee-migration-manifest.json) carries original/candidate source fingerprints and per-file destinations. This extends the [foundation extraction](../../implemented/architecture/2026-10-10-e2ee-foundations.md) rather than restoring the experimental export surface or a second core. [Whitepaper](../../../../specs/e2ee/whitepaper.md) and [permission draft](../../../../specs/e2ee/permission-ledger.zh.md) retain proposed architecture without implying human approval or current product behavior.

The candidate staged patch remains SHA-256 `4c36a1e507f2e7bcc55e9e88906ffe2b617e9d9c9aed55ab5e76745bd4d7ee71`. Independent selected review suites reproduce seven core and two Lab failures with actual crypto and local HTTP/SQLite. Their old-fail artifacts remain outside the public repository; equivalent public regressions belong to the implementing layers. No captured transcripts or private recovery material are committed.

Existing submission #1434 retains its author's ownership; SDK preparation #1433 has since merged. The new bottom is actual public main including #1432; dependent code is not copied from parallel unmerged PRs. Private cloud/production and platform work remain linked stacks in their respective repositories.

## Outcome and limits

The baseline documents and complete source inventory are implemented; remaining library/Lab layers are unfinished. Choosing one public implementation prevents drift but requires adapting source workflows to already hardened opaque authority and byte ownership. Keeping old protocols as pinned history avoids silently reintroducing MLS, JSON/hex Team or non-atomic tag2 removal. Scope creation/cancellation/awaited close and failure cleanup are acceptance requirements, not effects supplied automatically by a type migration.

Document checks and selected old-failure reproduction do not establish full-stack CI, production E2EE, native custody, power-loss/device-loss recovery or all-platform acceptance. Draft creation is authorized; Ready, merge, deployment and publication are not.

Validation: public core 113 tests and typecheck pass, docs check and public/platform boundaries pass, root format passes with no unrelated edits. Root check completed typechecks/lint but stopped on the unchanged CLI native Git fixture (`context_unreadable`); 3723 CLI tests passed, one failed and four skipped. Remaining root stages were not reported green.

Draft baseline: [PR #1438](https://github.com/LodyAI/Lody/pull/1438).
