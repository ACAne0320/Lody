# D12: atomic removal encoding proposal

Status: draft
Translation: current

[中文](atomic-removal.zh.md)

## Settled intent and current implementation

One record and one CAS remove a member and activate the next epoch together; atomicity is already settled. Persist the candidate key and original signed bytes, reconcile unknown outcomes by those bytes, and distribute only after verified inclusion. Remove the target membership's personal, machine and Recovery devices; retain other admitted devices. Delivery is outside this CAS.

The public ledger uses canonical CBOR v1: genesis body `[1, signer, user, member, encKey, commitment]`, ordinary body `[previousHash, signer, operation]`, record `[body, signature]`. Ordinary bodies have no separate version field. Signatures cover `lody-e2ee/sig/v1\0 || canonical(body)`; record hashes cover `lody-e2ee/rec/v1\0 || canonical(record)` with SHA256. Unknown genesis versions fail unknown-version. Unknown operations and obsolete tag2 fail unknown-operation, never skip. Current tag7 publishes an epoch only; tag2 plus tag7 cannot implement D12.

## Recommended implementation

Add unused tag8 with operation `[8, targetMembershipId, nextEpoch, commitment, previousEpochKey]`. Use ordinary framing, explicit signature/hash domains and exact arity; do not revive tag2. The function may be removeMemberAndPublishEpoch. The final ledger format must define the supported operations explicitly. There is no deployed legacy-ledger or old-client compatibility requirement.

Pre-state authorization requires the current Owner's active personal device. The target must exist and cannot be Owner; use the existing transfer first. Require exactly the next epoch, reject overflow and reused commitments, and reuse the current Org/epoch-bound commitment rules. One private transition removes the current target member/devices, retains historical author and retired identity/key facts, stores the commitment/history packet, and clears rotationRequired. A failed check publishes no new view or durable cursor.

Reuse the existing 72B history packet: 24B nonce, 32B old key encrypted under the new key, and 16B AEAD tag. AAD contains epoch-history/v1 purpose, Org and u32be new epoch; the predecessor is n-1. Include packet and commitment in the same signature/CAS. The publishing client opens it and checks the prior commitment before submission. Host/pure replay check shape, order, signature and pre-state authorization; an opaque packet does not prove correct key contents. Recovery checks each old commitment.

## One coherent prelaunch format

E2EE has not shipped. Remove old-client upgrade paths, dual snapshot readers, downgrade emission and capability pins whose only purpose is distinguishing prelaunch formats. Unsupported formats and operations fail; there is no compatibility migration.

The final atomic-removal format and permission snapshot must represent the same state transition and exact authenticated position. Their encoding and signature/hash domains still need review before implementation. A current snapshot must not bypass authorization or independently pinned freshness; snapshot self-claims never establish authority. This does not require retaining a v1 reader after a replacement is selected, nor does it select snapshot-v2 or any new domain by default.

## Review delta

Atomicity, Owner authority, target exclusion, exact-byte reconciliation and post-inclusion delivery are settled. Field/function names are engineering choices. Review the final operation/snapshot encoding and authenticated position contract together. Old-client compatibility is excluded. No Admin/Recovery authority, algorithm, historical sharing or U03B change is proposed. This draft is unapproved and inactive; the current codec still rejects tag8.

## Evidence

[Codec](../../packages/e2ee-core/src/ledger/records.ts), [policy](../../packages/e2ee-core/src/ledger/policy.ts), [history packet](../../packages/e2ee-core/src/keys/history.ts). Inspected implementation and proposal only; no new-format interoperability test or security proof.
