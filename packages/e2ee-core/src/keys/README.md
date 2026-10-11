# Canonical epoch history and volatile verified keys

`@lody/e2ee-core/keys` uses the current CBOR ledger's fixed v1 commitment and
72-byte history packet, not the retired JSON experiment's digest/signed frame.
No rotation, delivery, backup, vault/file format or product feature is activated.

- `commitEpochKey(genesis, epoch, key)` preserves SHA-256 over
  `lody-e2ee/epoch-key/v1\0 || genesis32 || uint32be(epoch) || K32` for epoch >= 1.
  Epoch zero deliberately uses only the domain and K32. This exception is retained,
  not silently changed. Commitment validity alone grants no membership/permission.
- `sealHistoryPacket` uses host secure random nonce24 and raw current K32 for
  XChaCha20-Poly1305. AAD is `lody-e2ee/epoch-history/v1\0 || genesis32 || uint32be(n)`;
  plaintext is K(n-1)32, result nonce24 + ciphertext32 + tag16. No nonce override.
- `openHistoryPacket` checks AEAD only. It does not authenticate publication or the
  previous commitment. Returned opaque EpochKey owns a copy; no public byte export.
- `recoverLedgerHistory(view, latestKey)` requires a genuine full verified ledger
  view. It verifies the latest commitment and every reverse link/old commitment,
  returning all epochs or a typed failure without partial keys. Raw maps or journal
  bytes cannot supply authority. Temporary owned material is wiped with ordinary
  try/finally on success and every failure, including a correctly decrypted but
  wrong previous key. Structural raw collection is replaced by the existing
  unverified record decoder plus authoritative verified-view packet queries.

`makeVerifiedEpochKeys(genesis, recipient)` is an inert Effect requiring the
application Scope. It creates only volatile private copies, with synchronous
install/read Result operations and a synchronous clear. Install verifies a genuine view, active
recipient membership and the exact epoch commitment; Guest/R may read but acquire
no document-write rights. Read repeats eligibility and commitment checks and
returns a fresh opaque key. `clear` wipes stored copies; Scope close wipes them,
releases its observed view and permanently rejects use. Caller-owned input and
returned key objects retain their own lifetimes; this is not physical-memory
zeroization or remote key deletion.

The store remembers the latest independently verified prefix it has observed.
`requireLedgerContinuation` compares two real views using private verified hashes;
a lower view or alternate fork cannot bypass a known revocation. A verified newer
revocation remains observed even if read fails. This local authority observation
is not a transport/durable cursor advance, global freshness proof or fork resolution.
Callers still obtain current independently expected ledger endpoints and handle
persistence. The API currently requires full replay, not snapshot restoration.

Tests extend the owning crypto suite: independently generated Python SHA-256 /
PyNaCl 1.6.2 libsodium vectors, real native-signed ledger histories, corrupt links,
wrong commitments, copy cleanup, false views, rollback/fork rejection, active R,
clear and Scope close. The original candidate's wrong-old-key cleanup failure is
reproduced in an isolated copy; no source/candidate worktree is modified.

Regenerate only synthetic fixtures in an isolated Python environment:

```sh
uv run --cache-dir /private/tmp/e2ee-vector-cache --no-project --with PyNaCl==1.6.2 python packages/e2ee-core/test/generate-epoch-history-vector.py
pnpm --filter @lody/e2ee-core typecheck
pnpm --filter @lody/e2ee-core test
```

The fixture generator is optional; runtime tests consume committed bytes and need
no Python/network. Node custody/persistence, exact pending/outbox
bytes, finite delivery rounds, durable reports, publisher-loss backup and recovery
remain separate migration owners.

[Decision/evidence](../../../../.agents/notes/implemented/architecture/2026-10-11-e2ee-epoch-history.md)
 · [Fingerprints](provenance.json).

EpochKey values use a private registry and null prototype; reflected symbols or
structural objects cannot export/substitute material. The prior public slice
accepted a forged symbol accessor, reproduced separately before this fix.

## Signed current-epoch envelopes

The explicit `@lody/e2ee-core/keys/envelope` entry preserves canonical
`AAD || enc32 || ct48 || signature64` and `lody-e2ee/epoch-env/v1\0`.
Expected genesis/epoch/sender/recipient come from the caller; the frame cannot
choose them. `authenticateEpochEnvelope` checks real verified current eligibility,
exact framing and the fixed signature verifier, without decrypting or proving the
key preimage. A host must bind the sender to its authenticated request principal.

`prepareEpochEnvelope` checks the source commitment before real HPKE and borrowed
signing, then checks the verified prefix, current epoch and device/key eligibility
again. Active personal/machine devices may forward keys; Recovery cannot send.
All active recipient kinds can receive, including Recovery and Guest membership.
Execute preparation once and retain the exact bytes for later durable delivery.
This API performs no transport, outbox persistence or retry.

`openEpochEnvelope` fixes caller context/frame/key handles before asynchronous
work, checks outer signature before decryption, checks the plaintext commitment,
then rechecks current authority. It returns a caller-owned opaque key, not a
durable installation receipt. Compose it with `makeVerifiedEpochKeys` for volatile
installation; durable storage/reporting remains a later owner. A failed/cancelled
post-decrypt check wipes and invalidates this operation's newly created EpochKey.
Native primitive settlement is awaited; a native call that never settles cannot
provide bounded shutdown. Successful returned keys live while reachable; JavaScript
cleanup does not guarantee erasure of native/runtime internal copies.

[Envelope extraction note](../../../../.agents/notes/implemented/architecture/2026-10-11-e2ee-epoch-envelopes.md)
 · [Envelope fingerprints](envelope-provenance.json).
