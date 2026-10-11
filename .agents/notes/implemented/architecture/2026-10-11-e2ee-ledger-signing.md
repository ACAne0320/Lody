# Verified ordinary-record signing

Status: implemented
Translation: current

[中文](2026-10-11-e2ee-ledger-signing.zh.md)

## Abstract

A signing workflow must check the existing ledger permissions and target possession proofs before asking a device to sign. The explicit ledger/signing entry prepares canonical ordinary records over a genuine verified view, borrows the existing DeviceSigner, and verifies the resulting signed record with the fixed replay implementation. It preserves current wire bytes and composes with the merged durable submission workflow. Preparation is relative to its exact parent; it does not discover freshness or retry by signing again.

## Ownership and boundaries

Direct parent: epoch-history Draft #1446, b67e0c062c667046d8c90b7a2512dbbd0834be40. A private proposal registry prevents structural clones from becoming prepared commands. Input canonical CBOR and exposed signing bytes are owned copies. Replay and preparation share the same nested-proof and permission implementation on private cloned state. A zero-signature structural container is used only for decoding; it never establishes authority or leaves preparation. Fixed signature verification and full extension run after signing.

Execute signing once, retain its exact returned bytes, and pass them to existing submission. Re-executing an Effect requests another signature; this API does not own durable command identity. Existing submission alone owns persistence, exact-byte CAS retries and readback. A competing suffix leaves an old-parent command valid only relative to the former view, and CAS must reject it. No automatic rebase, genesis creation, high-level operation builder, native key storage, arbitrary-state constructor or transport is added. Legacy removal remains rejected; pending new-format and recovery decisions are unchanged.

This adapts the signing portion of the source LedgerEngine/verification responsibility rather than copying its mutable trusted-state class. The remaining client transport, snapshot restore, distribution and Lab owners stay in the manifest. Source/destination hashes are recorded in signing-provenance.json. The earlier document and epoch notes retain their extraction fingerprints; this layer records its own replay revision.

## Evidence

The owning replay suite exercises native Ed25519 signatures, wrong parent/permission, foreign-org and wrong-kind possession proofs, rejected legacy removal, fabricated proposals, bad signer output and unchanged prior views. A real SQLite integration composes the new signer with unchanged merged submission: CAS commits but loses its response, readback returns the original signed bytes, then closing/reopening the journal resumes without a live signer. Package tests: 152/152 and typecheck. Root validation and exact Draft CI are recorded separately in the migration evidence directory. This is library integration, not process-crash Lab acceptance or production E2EE.

Full root check passed this final 152-test code tree with native Git and local IPC enabled; format and docs check passed. Remote CI remains a separate exact-head claim.
