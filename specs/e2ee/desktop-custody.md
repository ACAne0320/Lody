# Desktop E2EE key custody

Status: draft
Translation: current

[中文](desktop-custody.zh.md)

## Main-process owner

Electron main explicitly creates the core protection capabilities during composition. A random 256-bit KEK is encrypted by real asynchronous safeStorage and stored as a private file. Existing authentication cookie string storage is not reused. No startup hook, IPC route or product E2EE switch is enabled by this module. Web/mobile/CLI custody remains unavailable.

Reject when safeStorage encryption is unavailable. On Linux reject basic_text and unknown/unavailable keyring backends. Never fall back to a plaintext key file. The owner encrypts device signing/encryption private keys, installed epoch payloads and local rotation-candidate payloads with XChaCha20-Poly1305 and fresh secure 24-byte nonces. AAD authenticates each purpose and complete existing Org/recipient/epoch/commitment context; candidate protection additionally binds the original signed candidate. Device protection binds its Org, actual public key pair and personal/machine kind. R secrets never use the persistent device path.

## Persistence and cleanup

Publish complete encrypted files atomically and preserve the first original. Corrupt or incompatible retained files fail without replacement. Reopen decrypts KEK through safeStorage and checks protected key-pair binding. Files are private; no plaintext keys are persisted or logged. Scope close rejects new work, waits actual native operations, then clears owned KEK bytes. Native handles and JavaScript strings cannot be promised deterministic zeroization.

## Acceptance boundary

Owning tests use real native crypto/files/OS-child reopen and a synthetic authenticated safeStorage boundary. They verify backend rejection, tamper/AAD rejection, absence of generated secret bytes on disk and actual close waiting. This is not a claim that an OS keychain was exercised. Before product activation, packaged Electron must be verified against actual safeStorage on each supported desktop OS.
