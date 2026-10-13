# Released SDK and P09 submission composition

Status: implemented
Translation: current
PR: https://github.com/LodyAI/Lody/pull/1491

[中文](2026-10-11-e2ee-sdk-submission.zh.md)

## Abstract

Original StreamsLedgerStream read/CAS still needed a real consumer for the landed P09 engine. Directly base this layer on #1487 `098e274221aae13305d29ff75629bee168678ded`: adapt the actual released SDK0.9 shape while keeping HPKE and P09 implementation untouched. Source fingerprints and the [adapter contract](../../../../packages/e2ee-core/src/submission/STREAMS.md) record the narrow responsibility.

## Responsibility and corrections

Trusted initialization captures SDK read/CAS and one independent checkpoint selector. Full-history signature replay and genuine prefix continuation establish a private endpoint/opaque-offset mapping. Failed reads never replace it. CAS only accepts a genuinely extending ordinary record against that matching mapping; no unconditional append, invented producer retry or ACK-derived commitment. P09 persists originals and independently reads back outcomes.

The original source screened repeated transport positions. In actual SDK partial-frame testing, the migrated reader assembled valid signed history while offsets cycled `-1→a→b→a`; the correctly rejecting assertion failed before the correction. Restore seen-position screening in the shared ledger reader and reject empty position jumps; do not duplicate a reader or conceal the behavior through a missing export. New SDK case passes alongside all19 existing feed cases. This shared-file correction belongs to ledger transport and does not retroactively alter #1484's pinned review evidence.

Read cancellation aborts and awaits raw SDK work. SDK0.9 CAS has no per-call signal; retain the exact raw promise and await it on interruption/Scope close, refusing late completion. Caller chooses bounded SDK timeouts and cancels/awaits borrowed checkpoint effects. A never-settling raw request cannot be declared stopped. No Runtime/background worker or production E2EE is created.

## Evidence and remaining boundaries

Owning9 uses registry SDK0.9, synthetic loopback HTTP and real SQLite/P09: exact original conditional framing, lost ACK readback, unsupported CAS retaining pending then same-original retry, concurrent valid branch Conflict, wrong Org/unmapped or bad signed inputs, corrupted full history, byte budgets/captured methods, cyclic partial positions, and actual Scope close waiting for held non-abortable CAS. Normal/lost-ACK cases also reopen the same journal in another real OS process, consuming public entries without signing anew. Owning9/feed19 and package typecheck pass; complete root checks also pass with core287. Accurate CI and independent review remain separately bound.

Ordinary sandbox rejected loopback listen (EPERM), then the same tests ran with authorized local HTTP access; this is environment evidence, not six cryptographic failures. Existing node_modules cannot be purged noninteractively, so tests explicitly link the declared devDependency to the existing verified registry0.9 cache; no fresh clean install is claimed. The new three-line importer parses identically to pnpm's offline lock refresh; dependency versions/integrities and parent lock layout stay unchanged.

Qualified snapshot bootstrap, snapshot-offset protection/provider, sender publication reconstruction, complete Lab and original Lab2 remain unfinished. Strict deadline, vault format/concurrency, permanent-publisher-loss backup, D12 and Lab replay randomness keep their decision gates. These synthetic HTTP/process results are not deployed backend, native-platform custody or full product acceptance. All PRs stay Draft under coordinator-assigned independent review.

The actual SDK empty-page jump also has a negative reproduction with the exact parent098 reader bytes: one correctly rejecting test fails before correction, then SDK9/feed19 pass on the shared fix. Normal framing remains accepted; empty/repeated positions never become a CAS mapping. Early missing test-mode type union is a static harness correction, retained separately.

Delivery resumes under the revised maximum of24 migration PRs. This layer keeps the exact098 parent; no reviewed parent is rewritten or Ready state inherited. Fetch confirms current main e395d84f and all three prerequisites, with no new core/RPC overlap since frozen main984c. Prior freeze archives remain unchanged as original evidence.
