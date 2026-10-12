# Recovery vault: entry, concurrency and retention proposal

Status: draft
Translation: current

[中文](recovery-vault.zh.md)

## Settled intent and recommended format

Keep one recovery file and independent Recovery identities per user/workspace. Later configured workspaces join the same vault. Recovery only receives/repairs keys and admits its own new personal devices. Setup may be skipped; add no encryption password. Ordinary epoch delivery uses already registered Recovery public keys without unlocking the file again.

Recommend a separate canonical CBOR vault-v1, not the synthetic device JSON. The file contains version, random vaultId, service locator and random 256-bit unlock material U. Generate independent vault master key V. Derive a wrapping key from U using HKDF-SHA256 with vaultId/entry purpose and wrap V with existing XChaCha20-Poly1305. A verified available Passkey PRF can derive another entry wrapping the same V; login alone is insufficient. Entry AAD binds version/vaultId/type/id; each new encryption uses a random 24B nonce. Entry replacement rewraps V without rewriting the vault; deletion cannot invalidate copied secrets.

Encrypt Recovery entries and the index separately using purpose-separated keys derived from V. External headers need only opaque entryId/revision. AAD binds vaultId, entryId, revision, predecessor ciphertext digest and purpose. Private entries bind genesis, current membership instance, Recovery public/private key pairs, generation and the source of trusted genesis/ledger material. The index binds the same identity tuple and entry digest. Decryption grants no current membership: independently verify the ledger and active Recovery identity; directory Owner claims cannot establish trust.

## Concurrent saving and resumption

Upload an immutable candidate and read back/decrypt it before CAS of the encrypted index with expected revision/digest. Concurrent first setup for the same Org/member uses the winning index reservation's Recovery identity; the loser rereads and reuses it rather than admitting another. Explicitly merge disjoint workspace updates after conflict. Same-identity conflicts remain visible; no last-write-wins. This is a vault concurrency contract, not new ledger authority.

Persist candidate entryId, original index/CAS intent, ledger bytes and stage. Only the selected, read-back private package proceeds to registration. Reconcile unknown ledger outcomes by original bytes. If registration succeeds but delivery fails, resume that identity. Mark a workspace verified only after actual current-key decryption/commitment checks and current ledger qualification. One workspace's failure does not block others. Index, ledger and delivery are separate recoverable steps, not a cross-store transaction.

Recommend no automatic expiry for active entries. For ordinary replacement, verify the new entry/Recovery identity before revoking the old one; retire old entries. Do not GC unresolved progress or ciphertext referenced by the index/pending operations. Retain retired secrets until explicit user cleanup explaining possible recovery-path loss. Confirmed compromise prioritizes revocation. Deleting cloud files does not revoke copied keys. Unreferenced failed candidates may be collected only after checking all pending references; no fixed duration is invented.

## User cost and approval delta

Approve the new wrapped master-key format, index CAS/reservations and default retired-ciphertext retention together. Losing the file without another valid entry prevents unlock. Missing cloud entries cannot be recreated from the file. Conflicts/offline saves show resumable workspace-specific pending state, not backup success. Retention costs storage and increases exposure of old secrets; cleanup removes recovery options.

AEAD binds bytes, not freshness. Existing clients pin the highest revision/digest to reject rollback. Fresh recovery depends on the existing trusted service's fresh read and independently qualified ledger, and cannot infer latest recovery from a valid old vault. Confirm this limit with the concurrency contract. Native custody/temporary-secret cleanup is settled direction; concrete protectors, cross-platform PRF support and complete offline content export are not approved here.

## Evidence

[Permission draft](permission-ledger.zh.md), [whitepaper](whitepaper.md), [protection boundary](../../packages/e2ee-core/src/keys/HOST-PROTECTION.md). Format/workflow proposal only; no vault implementation, concurrency acceptance or full-platform guarantee.

[HKDF RFC5869](https://www.rfc-editor.org/rfc/rfc5869), [WebAuthn PRF](https://www.w3.org/TR/webauthn-3/#prf-extension), [XChaCha20-Poly1305](https://doc.libsodium.org/secret-key_cryptography/aead/chacha20-poly1305/xchacha20-poly1305_construction).
