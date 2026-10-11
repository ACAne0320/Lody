# Stable-ID mailbox repair queue

Status: implemented
Translation: current

[中文](2026-10-11-e2ee-mailbox-repairs.zh.md)

## Abstract

The original distribution repair request/flush subset still needed durable public
ownership. Adapt it to a dedicated indexed SQLite queue relative to #1484 at
dd2975419c49bf129eff9b037239dac2a64a7bbc. Preserve source request IDs/field binding
and public mailbox idempotency without copying whole-JSON distribution state or
claiming that an ACK means an installed key.

## Responsibility

The [repair contract](../../../../packages/e2ee-core/src/keys/REPAIR.md) and
[source fingerprints](../../../../packages/e2ee-core/src/keys/repair-provenance.json)
own details. Enqueue derives the genuine current self/epoch slot and durably binds
the original before dispatch. Flush uses saved exact IDs outside transactions.
Typed failure or lost ACK retains pending; current genuine epoch/recipient changes
alone terminate work. A protected key/report is not manufactured here. Scope closes
local admission/storage, with caller-owned cancellation/await of borrowed effects.

Indexed keyset pages keep blocked work without starving later tasks. Local results
retain original ID bindings after explicit acknowledgement. Repaired is local ACK
history, not server/key custody or current installation. Source request IDs and
rejected-digest semantics are unchanged; no new wire/domain/crypto ACK, expiry rule,
backup/vault format or native/production integration. The journal stores only public
repair metadata and checkpoint facts, never trusted role certificates.

## Evidence and remaining work

Owning6 uses actual public mailbox and real SQLite/signature replay. It checks
pending-before-network, a lost server ACK, another real OS process reopening the
same journal/mailbox and retrying without a second revision, explicit rejected
ciphertext exclusion, exact ID replay refusal, genuine revocation/Recovery/fake-view
failures, actual SQLite ignored terminal writes with idempotent recovery, 102 tasks
and blocked pagination/result acknowledgement, and explicit Scope closure before
late ACK. Synthetic identity seeds/public local host are declared; no HTTP/native
or deployed acceptance is claimed.

Early source-kind numeric/string adaptation and SQL quote/harness errors remain
separate prototype logs, corrected without deleting behavior. Actual sender target
discovery/current-key/outbox rounds, receive fetch composition, SDK CAS and the Lab
still need their public consumers. Original core/Lab failures and unresolved
protocol gates remain owned by the [manifest](../../../docs/e2ee-migration-manifest.json).
No new head inherits a parent review conclusion; all PRs stay Draft and main
coordinator assigns independent review.

Final author checks: owning6/core254, package typecheck, full root `pnpm check`, format/docs/public boundary passed. A real OS child uses public entries to reopen the same mailbox/repair databases; retrying the saved ID keeps server revision1. Author results remain separate from independent review/accurate CI and do not close original Lab or permanent-loss failures.
