# E2EE foundations

Contract: [foundation Spec](../../specs/e2ee-foundations.md). Entry map: [README](README.md).

- This package has no production entrypoint, transport host,
  private-key export or root signing API. Borrowed signing/document workflows live
  only under `./signing` and `./content`. Keep the root export map explicit; ledger
  records/replay live only under the explicit `./ledger` subentry. Local submission
  workflow/storage live under `./submission` and `./submission/sqlite`; the root stays platform-neutral.
- Preserve candidate wire algorithms, domains and versions. Expected malformed
  input returns Effect 4 Result errors; never silently repair or downgrade bytes.
- Enforce CBOR limits before full expansion or copying: charge shared values by
  their expanded wire size and reject cycles without unbounded traversal.
- Trusted Org genesis, resource, epoch, purpose and signer come from the caller's
  independently verified context. Frame metadata is unverified. Signature success
  establishes neither current permission nor AEAD validity.
- Ed25519 requires canonical nonzero prime-subgroup A and canonical prime-subgroup
  R with `zip215: false`. No caller-supplied point cache or verifier bypass.
- Public byte wrappers own copies. Ordinary secret epoch keys have no public byte export;
  native private-key custody belongs to platform adapters, not this module. The explicit
  host-only epoch protection boundary is governed by [keys rules](src/keys/AGENTS.md).
- Tests use fixed synthetic vectors and negative cases. Record extraction changes
  and source SHA-256 fingerprints in provenance.json; never copy private designs,
  captured transcripts, Lab hosts or unrelated candidate modules.

- Content crypto lives in `src/crypto`; ledger work uses its own directory/entry.
  AEAD primitives do not authenticate authors or grant permissions. Use trusted
  caller scope/header and retain v0 key/AAD domains. New seals require host secure
  randomness; no nonce override, plaintext fallback or implicit retry encryption.
  Keep derived key material opaque, and validate size before copying large inputs.

- Ledger authority starts only at caller-pinned genesis plus an expected head/count,
  or a module-created verified view. The explicit snapshot entry adds independently
  qualified endorsed state with distinct provenance. No arbitrary-state constructor,
  injected verifier, hash placeholder, or journal-derived trust. Failed suffixes preserve the prior view.
- Historical attribution and epoch packets come only from registered verified views.
  Revocation retains old author identity but grants no current write permission.
  Recovery/Guest never write; required rotation blocks new seals. Returned packet
  bytes are owned copies, not decrypted keys or commitment-preimage proofs.
- Reject legacy non-atomic member removal; its replacement belongs to P12.

- Submission persists original signed bytes before CAS, retries exact bytes, and
  reads back before reporting success. Conflicts never re-sign. Terminal result,
  pending removal and verified rollback pin save atomically; explicit consumption
  is required. Application Scope owns storage; closing never deletes pending.
- Journal bytes/checkpoints do not establish permissions. Reverify complete history
  from external trusted genesis, including stored terminal results. No legacy-state
  import, checkpoint restore, implicit repinning or bad-history skipping.

- HPKE is the fixed Base X25519/HKDF-SHA-256/ChaCha20-Poly1305 epoch
  primitive, not an authorized envelope workflow. Keep the existing info and
  canonical AAD; never accept an algorithm/info override. Caller-owned native
  device key handles stay external; no key generation, storage or delivery here.
  Await non-cancellable native work and temporary-buffer cleanup on interruption.

- Document workflows accept only genuine full/qualified-endorsed views and bound document keys.
  Current write/rotation checks precede encryption and repeat after signing; the
  fixed verifier checks signer output. Historical signature evidence is neither
  current permission nor AEAD validity. Host admission remains independent.
- Native signing borrows an existing Ed25519 handle, creates no identity/store/runtime,
  and awaits native settlement plus scratch cleanup on interruption. Document leaf
  import/export owns symmetric copies; it never exports a device private key.

- `./keys` keeps canonical commitment/72B history, not JSON experiment wire. History
  recovery/installation uses real verified views and checks every commitment; no
  partial keys or journal-derived trust. Scope owns volatile copies and awaited close.
  Known revocation/rollback/fork cannot be bypassed with an older cached view.
  No backup/vault/rotation/delivery or durable-cursor claim is implied.

- Ordinary signing lives under `./ledger/signing`: genuine view/proposal provenance,
  shared permission/possession-proof checks before signing, fixed verification after.
  Execute signing once then submit original bytes; no implicit rebase or re-sign retry.

- `./keys/envelope` preserves current envelope bytes: genuine current eligibility,
  independent expected context, fixed outer verification, exact commitment and
  post-crypto verified-prefix recheck. Recovery receives but never sends. It returns
  no durable installation/delivery receipt; failed owned opens wipe/invalidate their key.

- Finite `./keys/delivery` never accepts an injected authorization callback or trusts
  disk as ledger authority. Persist the first ciphertext before send, retry original
  bytes, reverify each send and reject known in-round rollback/forks. Readback proves
  ciphertext observation only. Node `./keys/delivery/sqlite` owns closure through Scope,
  indexes bounded rows and never converts old JSON or deletes pending/history on close.

- `./ledger/snapshot` requires independent exact Org/point/device/member/management
  role/personal-kind confirmation, or a private token from a genuine same-point view.
  Neither snapshot/journal self-claims nor a pubkey pin alone establish qualification.
  Signature-only evidence is never authority. Endorsed bootstrap is explicitly distinct
  from genesis audit; retain only actual known suffix hashes, never sparse placeholders.
- Raw note equality is not independent confirmation. Bind caller-confirmed actual
  genesis/head/count/stateDigest/peer and its manual/authenticated-channel source;
  never infer confirmation from a key list, or upgrade history/permissions by comparison.

- `./keys/mailbox/sqlite` is a public local reference, never production authentication.
  Bind principals only from trusted composition; fixed-verify current envelope/report
  admission. Index recipient rows and deduplicate exact ciphertext; no global read limit.
  Verified observations survive failed pin writes in the same owner; success requires
  exact fixed-context/head/count readback. Failed persistence makes no reopen promise.
  Reports are signed claims, not custody proof. Repair retains history and invalidates
  prior report revision. Separate indexed schema rejects old JSON files without import.
  Scope closes storage; callers cancel/await their own borrowed async resources.

- Content author identity preserves full member mapping when known; endorsed retired
  devices may authenticate only device identity, never a guessed user or current write
  right. Capture seal inputs/capabilities before waiting, wipe owned plaintext through
  a real resource bracket, and reject later views outside the known verified prefix.

- Host header3 update admission lives under `./content/streams`: current genuine
  view, externally authenticated signer, exact resource/model/epoch and whole
  bounded batch are checked before forwarding original bytes. Historical-author
  success is not write permission or proof that ciphertext decrypts. Unknown,
  legacy or snapshot headers fail; no new snapshot protocol is implied.
