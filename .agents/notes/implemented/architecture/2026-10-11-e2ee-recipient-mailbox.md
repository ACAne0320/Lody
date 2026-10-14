# Recipient mailbox composition

Status: implemented
Translation: current

[中文](2026-10-11-e2ee-recipient-mailbox.zh.md)

## Abstract

The original distribution fetch/install and repair consumers still lacked a public composition. Directly base this layer on #1485 `680686d1442e7f8b12f6f8b84af3f17f3c514b97`. The explicit host-only facade constructs the real receiver/protected store and durable repair queue, captures borrowed capabilities once and keeps the portable root unchanged. Details: [contract](../../../../packages/e2ee-core/src/keys/RECIPIENT-MAILBOX.md), [source fingerprints](../../../../packages/e2ee-core/src/keys/recipient-mailbox-provenance.json).

## Responsibility

Before installation, genuine Org/recipient/epoch checks surround fetch, and the complete bounded page is copied by numeric index before asynchronous recheck. Bad page fields fail before any task/key save. Each envelope then passes actual signatures, HPKE, commitment and protected save/reload before original report persistence. On a later crypto/install failure, earlier legitimate installations and originals remain, while this call returns failure without successful pagination-next. There is no invented cross-database transaction or saved document cursor.

Scope closes local admission/storage; the caller cancels and awaits borrowed transport/ledger work before destroying its owners. No Runtime, background loop, automatic retries, native adapter, new wire, recovery format, stricter deadline or production composition.

## Evidence and remaining work

Ten owning tests use actual public mailbox/signatures/HPKE/SQLite with declared synthetic protector: installation/report, synthetic local key loss and durable repair retaining ciphertext; bad envelope retaining Verify with no next including after valid installation; malformed/oversized/hidden-iterator pages before writes; in-flight revocation; full-page copy across explicit Deferred ledger signals and initialization-captured fetch; closed Scope before late page. The same suite/typecheck passes on the actual680 parent; prototype results alone are not this tree's acceptance.

Sender discovery/current-key/outbox rounds, actual published SDK/CAS consumers, qualified snapshot bootstrap, complete Lab and gated recovery work remain in the [manifest](../../../docs/e2ee-migration-manifest.json). This layer does not close original Lab2/permanent-loss failures or establish native/all-platform/production acceptance. Independent review and accurate CI bind each exact new head; all PRs stay Draft under coordinator-assigned review.

Final author validation: owning10/core273, package typecheck, complete root `pnpm check`, format/docs and public boundary passed. Offline lock refresh parses identically (only ordering), so existing dependency versions/integrities and original layout remain.

Independent dedf review found a known-revocation bypass and mutable-length page violation. Share the actual receiver’s genuine durable `observeLedger` path across facade fetch and repair; receive/protection already use it. Observe before eligibility; persist/read back Org/self/head/count transactionally and keep genuinely validated knowledge on uncertain writes. Fixed initial row count and final length check reject getter shrink/growth before installation. Exact isolated dedf has five selected failures; working correction passes facade15/receiver15/mailbox11, including actual ignored/rewritten observation rollback, same-handle rejection/retry and journal reopen. Copied independent inputs now reject both page faults with zero tasks/keys and known-revocation rollback with checkpoint-mismatch; old reports remain unchanged. Source helper and facade hashes update separately; no whole-module READY is inherited.

Dedf CI really failed the unchanged 500-put dedup case at30s; retain that result. Cache only its genuine, unchanged validated fixture ledger across the same 500 real signed puts, preserving assertions and timeout. Focused mailbox11 now passes (dedup about2.9s); this is neither a timeout increase nor new-head CI evidence. SDK/CAS WIP remains separately stashed.

Final correction author checks: facade15/receiver15/mailbox11/core278, package typecheck, complete root `pnpm check`, format/docs/public boundary passed. These results bind the corrected tree only; original dedf NOT READY/CI failure remains. Exact new-head independent increment and CI are pending.

Failure diagnosis correction: a signed but unopenable early envelope could block the page without identifying the frame for existing targeted repair. `MailboxInstallError` now binds the owned frame digest to its exact public context and retains the underlying Cause, including interruption/defect reasons. It changes neither sender eligibility, wire, automatic rejection nor no-next-on-failure. The real SQLite regression uses fixed synthetic sender order, verifies zero installed keys/reports before explicit repair, reopens the durable repair queue and proves later valid installation/report while both ciphertext originals remain. The old assertion fails at the missing diagnostic tag; reviewer evidence is unchanged.

The 101-blocked-revision receive regression retains every real HPKE/envelope/installation/report and the original 30s bound. Its prepare helper accepts the same already verified immutable fixture lookup used by the receiver instead of replaying that history each time. Dynamic authority tests retain the original lookup; production verification is unchanged. Single-run local cost was 4109ms before and 3538ms after. Owning receive/mailbox suites pass 31/31 with package typecheck; these are author results, not independent closure or permanent stability.
