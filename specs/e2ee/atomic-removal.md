# D12: atomic removal encoding proposal

Status: draft
Translation: current

[中文](atomic-removal.zh.md)

## Settled intent and current implementation

One record and one CAS remove a member and activate the next epoch together; atomicity is already settled. Persist the candidate key and original signed bytes, reconcile unknown outcomes by those bytes, and distribute only after verified inclusion. Remove the target membership's personal, machine and Recovery devices; retain other admitted devices. Delivery is outside this CAS.

The public ledger uses canonical CBOR v1: genesis body `[1, signer, user, member, encKey, commitment]`, ordinary body `[previousHash, signer, operation]`, record `[body, signature]`. Ordinary bodies have no separate version field. Signatures cover `lody-e2ee/sig/v1\0 || canonical(body)`; record hashes cover `lody-e2ee/rec/v1\0 || canonical(record)` with SHA256. Unknown genesis versions fail unknown-version. Unknown operations and obsolete tag2 fail unknown-operation, never skip. Current tag7 publishes an epoch only; tag2 plus tag7 cannot implement D12.

## Recommended implementation

Add unused tag8 with operation `[8, targetMembershipId, nextEpoch, commitment, previousEpochKey]`. Preserve ordinary framing, signature/hash domains, existing record bytes and exact arity; do not revive tag2. The function may be removeMemberAndPublishEpoch. An atomic-removal-v1 capability identifies this extension; genesis-v1 support alone does not imply support for every operation.

Pre-state authorization requires the current Owner's active personal device. The target must exist and cannot be Owner; use the existing transfer first. Require exactly the next epoch, reject overflow and reused commitments, and reuse the current Org/epoch-bound commitment rules. One private transition removes the current target member/devices, retains historical author and retired identity/key facts, stores the commitment/history packet, and clears rotationRequired. A failed check publishes no new view or durable cursor.

Reuse the existing 72B history packet: 24B nonce, 32B old key encrypted under the new key, and 16B AEAD tag. AAD contains epoch-history/v1 purpose, Org and u32be new epoch; the predecessor is n-1. Include packet and commitment in the same signature/CAS. The publishing client opens it and checks the prior commitment before submission. Host/pure replay check shape, order, signature and pre-state authorization; an opaque packet does not prove correct key contents. Recovery checks each old commitment.

Old public clients stop this Org's permission advancement and dependent new authorization at tag8, retaining prior history/cursor. No skipping, two-step downgrade or unqualified read-only fallback. Product listing/credential capability gates follow settled policy and preserve ordinary workspaces. Friendly messages in old binaries require actual package tests.

## Snapshot entry points must not bypass capabilities

Current snapshot-v1 has no required-operation set. An old snapshot reader may accept a valid signed post-removal state without encountering tag8. Unknown feed-tag refusal alone is insufficient.

Recommend snapshot-v2 for an Org whose history includes tag8. Bind version and a monotonically retained requiredOperationTags set (at least8) with Org, head, length and complete state. Keep a six-element outer body with leading2 and required tags inside the v2 state encoding. Use separate v2 snapshot/head-attest/digest domains; forbid downgrade emission to v1. State-digest/security-note comparison includes format version; normalize authenticated encoding across versions before comparison rather than reporting a legitimate re-encoding as a same-position fork. Private full-replay views, v2 bootstrap and suffixes retain required capabilities. A v1 snapshot cannot prove the historical absence of tag8: require independently obtained Org/snapshot-format capability pins, or audit the existing full history before qualifying v1. Snapshot self-claims cannot create authority.

Snapshot import, vault bootstrap and current-view consumers check required capabilities. Server listing/direct-link/credential admission follows the settled old-client gate. Old v1 readers must reject actual v2 with unknown-version and retain state/cursor. Producers do not emit v1 snapshots after tag8. Cached pre-transition v1 represents an old position and cannot replace independently fresh endpoint/admission checks. No new guarantee against lying malicious endorsers is added; existing snapshot trust remains explicit.

Snapshot-v2/capability pins are a real interoperability delta requiring review; current implementation is unchanged. UI changes or hiding tag8 exports alone are not compatibility acceptance.

## Review delta

Atomicity, Owner authority, target exclusion, exact-byte reconciliation and post-inclusion delivery are settled. Field/function names are engineering choices. Confirm the tag8/snapshot-v2/capability-pin interoperability contract and concrete old-client refusal entry points. No Admin/Recovery authority, algorithm, historical sharing or U03B change is proposed. This draft is unapproved and inactive; the current codec still rejects tag8.

## Evidence

[Codec](../../packages/e2ee-core/src/ledger/records.ts), [policy](../../packages/e2ee-core/src/ledger/policy.ts), [history packet](../../packages/e2ee-core/src/keys/history.ts). Inspected implementation and proposal only; no new-format interoperability test or security proof.
