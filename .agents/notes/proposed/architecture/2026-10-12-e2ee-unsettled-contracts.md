# Review atomic wire, recovery vault and publisher loss

Status: proposed
Translation: current

[中文](2026-10-12-e2ee-unsettled-contracts.zh.md)

## Abstract

Atomic member removal is settled; interoperable encoding and backup contracts remain unapproved. Three short draft Specs recommend a new operation with existing domains, a wrapped recovery vault with explicit concurrent resumption/retention, and an independent protected candidate before publication. These identify the actual protocol/product deltas without asking the user to choose field names. Existing ledger/key/metadata consumers continue independently; no proposed wire or publication gate is implemented or treated as approval.

## Decisions needing review

- [D12 encoding](../../../../specs/e2ee/atomic-removal.md): existing ordinary v1 domain/CBOR, proposed tag8 and capability; pre-state Owner authorization and existing history crypto retained. Exact-byte reconciliation is already settled.
- [Vault](../../../../specs/e2ee/recovery-vault.md): independent master wrapping, encrypted index reservation/CAS, workspace-specific resumption and explicit retired-secret retention. Fresh recovery does not cryptographically infer currentness from valid old ciphertext.
- [Publisher loss](../../../../specs/e2ee/publisher-key-recoverability.md): recommend mandatory independent protected candidate with a scoped-file option when no vault exists; alternative accepts the pre-first-delivery loss window. A retained key is not recovered management identity or continuous custody.

These enduring decisions need human review of compatibility, data retention and user-visible publication blocking; they are not another small implementation PR. Existing source Specs cover intent but are read-only and incomplete for these deltas; draft companions leave those guarantees intact. No ordinary JWT tolerance/U03B, algorithm suite, platform support minimum or production activation change.

## Validation and ownership

Inspected the current public codec/policy/history and current source decisions/whitepaper/permission-ledger. Current codec rejects proposed tag8 and legacy tag2; no second core is introduced. No protocol implementation/model proof or new permanent-loss acceptance is claimed. The migration manifest tracks partial implementation and absent tutorial application; original failure evidence stays unchanged. Keep these proposals with the integration review until coordination chooses their destination; do not change reviewed ancestor heads to pretend they were already included.
