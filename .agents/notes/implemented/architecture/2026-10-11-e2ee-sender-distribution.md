# Verified sender discovery and durable distribution

Status: implemented
Translation: current
PR: https://github.com/LodyAI/Lody/pull/1493

[中文](2026-10-11-e2ee-sender-distribution.zh.md)

## Abstract

The original sender workflow still needed public target discovery and restart-safe dispatch alongside the actual recipient receiver. Compose existing receiver/protected-key/outbox owners and add only a separate indexed task/result journal. Genuine ledger observations decide eligibility and terminal reasons; remote revisions only trigger exact-original retries. This implements distribution of already committed keys, without selecting candidate backup or recovery formats.

## Decision and evidence

Direct parent is SDK #1491 `f82f8634743d5bc4dd8858cf6867b91d80c221ba`. The [module contract](../../../../packages/e2ee-core/src/keys/DISTRIBUTION.md) owns current behavior; source provenance records original key-distribution modules rather than importing their old whole-JSON schema. Host initialization remains the previously settled native-protection boundary.

Local per-revision tasks preserve old results, while the unchanged outbox delivery ID keeps the first original ciphertext. Remote status never creates Obsolete/Revoked/Observed authority. Actual complete current ledger and fixed signature/envelope gates apply before and after dispatch; genuine revocation stays known through the receiver's durable observation. Whole retained scalar task metadata is compared after DML so later trigger rewrites cannot hide an earlier acknowledged result.

Author owning tests use real signatures/HPKE, all three registered recipient kinds, actual public mailbox, protected save/reload, SQLite, publisher-genesis report reconstruction and real recipient installation. Lost readback followed by reopen forbids all new signing while retained originals succeed. A second actual OS process opens the same key/outbox/task/report files without a signer and flushes the original publisher report. Actual IGNORE/rewrite terminal triggers preserve Pending and permit same-original retry after removal. Synthetic protector and local reference mailbox are explicit test boundaries, not native-platform/backend acceptance.

Initial type checks found raw numbers where EpochNumber brands were required and a readonly test-signer mutation; fixed via real validation and a new borrowed signer. A later test incorrectly chose kind1 (machine) for Recovery; the retained failure is corrected to kind2 with an explicit genuine-state kind assertion, not a changed permission rule. Owning9/core296, package typecheck, complete root check, format/docs/public boundary pass. Independent current-head review and accurate new CI remain separate.

Candidate backup/permanent loss, D12, recovery-vault encoding, SDK protected snapshot offset and Lab replay randomness remain open. This is not full migration closure, production composition, key creation, database migration, release or deployment.
