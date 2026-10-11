# Current-epoch envelope authentication and opening

Status: implemented
Translation: current

[中文](2026-10-11-e2ee-epoch-envelopes.zh.md)

## Abstract

HPKE decryption alone cannot authenticate an epoch-key sender or authorize installation. This layer migrates canonical signed envelope preparation/authentication/opening over genuine current ledger views, fixed signatures and exact commitments, retaining the existing v1 bytes. It rechecks authority after asynchronous crypto and releases newly opened keys on failure or cancellation. Durable delivery and installation/reporting remain separate owners, so a returned key is not an installation receipt.

## Decision and ownership

Direct parent is ledger-signing Draft #1447, d87ee2d444a60079ae1adf84565a7bd53faf905e. The explicit keys/envelope entry reuses merged HPKE and signing primitives without changing their code or versions. Expected context is independent of incoming frame fields and copied at execution before async work. A host must bind the sender to its authenticated request principal. Real verified views, active non-Recovery sender and active recipient membership are mandatory; personal/machine devices can forward, all eligible recipient kinds can receive. This is distinct from document writing and management permission.

Preparation checks the current key commitment before encryption, signs once, then rechecks a genuine verified prefix/current epoch/device key and the final fixed signature. Opening authenticates before HPKE, checks the decrypted exact commitment and rechecks the verified prefix/current authority. No arbitrary raw state or injected verifier grants authority. Local pin observations do not discover global freshness. Return values are opaque caller-owned secrets; volatile installation composes with the existing Scope-owned cache, while durable keystore/mailbox/report workflows remain incomplete.

Effect acquireUseRelease owns the newly opened key during post-crypto checks. Failure/interruption wipes and removes its private registry entry; success transfers ownership to the caller. The package-internal disposal helper can release only a key held by the operation and is not a new public material accessor. Native noncancellable work remains awaited by the existing primitive; no bounded shutdown or all-runtime memory-erasure guarantee is added. Preparation retains the borrowed input key. No recovery wrapping, backup requirement, atomic removal wire, snapshot-header format, production activation or real device custody is inferred.

## Evidence and limits

Owning HPKE tests use real X25519/HPKE and native Ed25519 canonical histories through the public subentry. They cover recipient personal/machine/Recovery installation into the scoped volatile cache, machine forwarding and Recovery-send denial, forged view, wrong caller routing, bad signer output, valid signature with failed AEAD or incorrect plaintext commitment, async frame mutation, revocation during signing/decryption, and deterministic cancellation during post-decrypt authority wait. Captured operation keys become unusable on failed/cancelled opening; prior caller keys remain usable. Package 161/161 and typecheck pass. This proves no durable mailbox, process-reopen Lab, permanent-publisher-loss backup or production E2EE. Source adaptations/fingerprints and remaining module responsibilities stay explicit in the manifest.

Final 161-test code tree passed full root check with native Git/local IPC, format, docs and public boundary. The first root attempt stopped at four test-variable shadowing lint errors; after correction, fresh full root validation passed. No earlier-tree result substitutes for this final-tree result.
