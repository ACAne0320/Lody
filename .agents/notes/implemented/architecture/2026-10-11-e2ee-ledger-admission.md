# Public admission consent and parent-relative ledger intent

Status: implemented
Translation: current

[中文](2026-10-11-e2ee-ledger-admission.zh.md)

## Abstract

The prototype's joining/device proof workflows and ordinary intent conversion were still missing from the hardened public library, leaving Lab consumers dependent on the old engine surface. This layer preserves those signing domains and routes typed commands through real view/proof/permission checks, with a separate producer-only v1 genesis workflow. Borrowed capabilities and fields are captured before waiting and every signer output is fixed-verified. It does not replace account authentication, durable key custody, publication or gated atomic removal/rotation.

## Responsibility and boundaries

Direct parent is content follow-up #1474 at f6bedf5092b921e8a34f1baacc9a50c6bb9d5a08. The [admission contract](../../../../packages/e2ee-core/src/ledger/ADMISSION.md) and [provenance](../../../../packages/e2ee-core/src/ledger/admission-provenance.json) own the adapted source and responsibility. Joining consent retains nullable expiry and original user/device/request binding; a trusted host must still authenticate account ownership and check expiry. Possession proof binds exact Org/member/kind and cannot substitute for admission permission. No caller-injected verifier is accepted.

Ordinary intent conversion reuses the existing private prepared-record registry and real preceding-state policy. It covers the settled five command kinds, and runtime-rejects obsolete RemoveMember instead of restoring tag2. Caller-authored bodies remain parent-relative: sign once, then existing durable submission retries original bytes. Rotation scheduling/key durability, D12's new format, deadline B and recovery-vault decisions are not silently added.

Genesis production borrows a real opaque initial key and existing signer, computes epoch-zero commitment with its established genesis omission, signs public fields and verifies complete genesis rules. It returns producer bytes only; the caller already has to retain the key durably before publication. No key generation, private/symmetric byte export, new protection callback, endpoint/account trust or persistence claim is introduced. Native signer ownership/awaited cleanup remains unchanged. Portable helpers create no Runtime or I/O.

## Evidence and remaining work

The owning ledger suite uses actual Ed25519 signatures and the independent known commitment vector, compares exact independently encoded genesis/admission bytes, verifies resulting real permissions/state and rejects modified signatures, fake initial keys, replay/retargeted Org/member/kind proofs, fake views, unauthorized/unknown/legacy commands and competing-parent records. Deferred mutation confirms the captured original proof remains admissible; malformed signer output/invalid kind/expiry fail explicitly. Ordinary revoke conversion shares the existing record permission gate; its dedicated new integration is recorded with the final suite.

This is creation/consent/intent library behavior, not full LedgerClient transport restoration, remote publication, platform custody, backup, SDK composition or Lab acceptance. Original core7/Lab2 evidence and all decision gates remain retained by the [manifest](../../../docs/e2ee-migration-manifest.json). No existing submission or HPKE implementation changes; all stack PRs stay Draft.

Author validation on the direct-parent combination: core 210/210, package typecheck, full root `pnpm check` using native Git and local IPC, root format and docs check passed. The prior 209 run predates the parent mailbox regression test and is retained separately; neither run is independent review or Lab acceptance.

Parent consistency repair sync: direct parent f6bedf5092b921e8a34f1baacc9a50c6bb9d5a08 includes mailbox58c. Admission implementation/eight new regressions remain unchanged; the resulting core211/typecheck/full root check/format/docs combination passes. Earlier209/210 evidence and the old exact-head review remain separate.
