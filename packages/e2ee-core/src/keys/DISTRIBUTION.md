# Finite key distribution

`./keys/host/distribution/sqlite` composes the existing actual recipient receiver,
repair queue, protected-key store and ciphertext outbox. It adds only a separate
sender task/result journal. Trusted initialization captures one fixed Org/device,
signer, native protector, borrowed ledger/mailbox Effects and original publication
lookup. It creates no keys, Runtime, background rounds or production composition.

```text
startup / genuine ledger change / connectivity return
  reconstruct our own current publication from exact verified original bytes
    actual protected save/reload and receiver report queue
  reconcileCurrentEpoch(limit, cursor)
    observe genuine prefix through the same durable receiver boundary
    discover sorted active recipients from our ledger, including Recovery
    capture remote revision as retry hint; persist task original before dispatch
  resumePendingDeliveries(limit, cursor)
    reauthorize genuine current sender/recipient/epoch
    read existing committed key through the actual protected store
    existing outbox -> original ciphertext; missing outbox -> prepare once
    actual put + exact-byte readback; genuine post-operation recheck
    save Observed result atomically; otherwise retain Pending
  explicit result acknowledgement retains task originals and ciphertext
```

The registered Recovery device can receive/repair but never send. Server target
lists are unused; a forged `Obsolete`, `Ineligible` or `InstallationReported` hint
cannot create a ledger terminal result or substitute for exact ciphertext readback.
Only genuine epoch/revocation changes produce Obsolete/Revoked. Observed means
local exact-byte remote observation, never recipient installation or key possession.

The delivery ID stays the original immutable sender/recipient/epoch ID. Each retry
revision has a distinct local task ID; new tasks retain earlier results and their
explicit acknowledgement. The original outbox bytes win across repair revisions.
If those bytes remain rejected, the task stays blocked for another sender; there
is no silent new ciphertext/ID strategy. A transport revision is never authority.

Both methods are finite pages of1–100; blocked tasks do not prevent later selected
tasks. Cursors are metadata keyset hints, not document/transport progress or global
freshness. The caller carries the next hint across the finite round and explicitly
invokes later rounds. No record is skipped to make old Lab failures disappear.

The dedicated version1 sender journal uses0600, WAL/FULL and explicit create/open.
Every mutation reads back its intended final row and retains all other owned scalar
task metadata and fixed Org/self binding through the transaction, including trigger
side effects. This audit loads scalar metadata, not ciphertexts; its work grows
with retained task history. No old whole-JSON import or cross-file atomicity is
invented. Scope rejects late writes before closing journals; callers cancel/await
borrowed Effects before destroying their owners. Actual protected native operations
retain/await their own work and wipe owned temporary key copies.

Only an already committed, already protected current key is used. Candidate-key
creation, pre-commit recovery backup, D12 atomic removal, recovery-vault format and
permanent publisher-device loss stay under their separate undecided contracts.
This module does not enable product E2EE or replace a native OS protection adapter.
