# Authenticated permission snapshots and comparison boundaries

Status: implemented
Translation: current

[中文](2026-10-11-e2ee-authenticated-snapshots.zh.md)

## Abstract

The old snapshot path accepts an Admin-endorsed state with no Owner governance device, and stored or self-declared signer metadata cannot establish current management authority. This layer preserves v1 complete-state/head signatures while requiring independent role/position facts or genuine same-position verified views; signature-only evidence cannot create authority. Snapshot-origin views explicitly retain only their verified suffix hashes and do not claim a genesis audit. Exact externally confirmed comparison tuples replace the old key-list shortcut that can mislabel raw server notes as independent confirmation.

## Existing intent and ownership

Direct parent is delivery Draft #1450, 34b918367fe23f6bf9c2ff1cea31b154de298cb2. The current permission-ledger/whitepaper intent allows endorsed bootstrap without compulsory genesis replay, but requires an independently authenticated Owner/Admin personal device and comparison of actual state plus head. No role certificate, comparison signature domain, D12 replacement or new snapshot wire is introduced. The explicit ledger/snapshot entry owns canonical state/schema, fixed signatures, preparation/signing, bootstrap/evidence and comparison. Existing submission implementation remains unchanged and continues its full-history contract.

External SnapshotTrust requires an explicitly external confirmation of exact genesis/head/count, device key, membership, Owner/Admin role and personal kind. The library copies/checks these facts and signed-state consistency; it does not establish their external provenance or infer missing roles from the snapshot/journal. Optional stateDigest pins externally confirmed complete state, but cannot replace role facts. Application callers lacking independent current-position qualification remain on signature-evidence mode. Production authentication sources are not wired here. Current means relative to that selected point; old confirmation does not prove a device remains active globally.

The alternative snapshotTrustFromView produces a private registered token only from a real eligible view at that same point. Cloned tokens cannot grant trust. The incoming complete body must match the known actual view, and the returned view retains its existing audit provenance and historical attribution. authenticateLedgerSnapshotEvidence checks signatures/strict structure but returns only claims/digest, never a LedgerView. No trust is loaded from a journal, and decoded state is not an authority constructor.

External endorsed views identify their verification mode and historyStart. They hold only the signed starting head and subsequently verified consecutive suffix hashes, with an explicit offset; no sparse arrays, fabricated old hashes or genesis-audit marker are created. Continuation requires a hash actually retained at the previous point, so an unknown prefix cannot be silently skipped. Failed suffixes preserve the old view. Canonical history/commitment recovery works over the authenticated endorsed state, but does not prove every pre-snapshot publication was independently replayed.

Historical identity retains full attribution in audited/B-returned views. Snapshot-only retired devices can be identified from authenticated replay-prevention facts as device-only, never assigned a guessed user/member. The old strict historicalContentAuthor query stays strict; document-workflow consumption of device-only evidence remains a later owner.

Raw comparison reports equal/conflicting/lagging state/head and always independent=false. confirmIndependentComparison requires caller-obtained manual/authenticated-channel confirmation of the exact genesis/head/count/stateDigest/peer tuple. A known peer key alone, relabeled note or server copy cannot supply this confirmation. It records source and excludes the original endorser/local signer; equality does not upgrade history or grant permissions. Actual channel/human provenance remains caller-owned. An all-Member signed-note format stays deferred.

## Evidence and limits

Isolated unchanged source tests fail for Owner-without-governance state and raw-note signer relabel (each 0/1); new owning behavior rejects both while retaining normal snapshot/comparison functions. Real Node Ed25519 tests exercise Admin bootstrap, same canonical suffix, external role omission/mismatch, fake view/token/state, supplied always-success verifier, journal signer substitution, state/head/count/genesis changes, replay-prevention reuse, strict complete-state facts, signature-only non-authority, large synthetic pinned count without proportional allocation and expanded CBOR budget/cycles. Real XChaCha history recovery/scoped cache runs over an endorsed snapshot; borrowed signing rechecks management eligibility after async work.

Package 187/187 and typecheck pass. The synthetic million-count test verifies bounded representation of a caller-pinned position, not a million-record audit. Full root check/CI are recorded separately. This does not complete product cold-start trust sourcing, document SDK snapshot-offset admission/client recovery, durable trust persistence, complete Lab or production E2EE. Original old core/Lab failure owners remain explicit. Source/destination fingerprints preserve extraction history; new provenance records shared-file revisions.

Final 187-test code tree passed full root check with native Git/local IPC, format/docs/public boundary. The first root attempt stopped at a fixture variable-shadowing lint error; the corrected final tree received a fresh full check. Exact-head CI is a separate record.
