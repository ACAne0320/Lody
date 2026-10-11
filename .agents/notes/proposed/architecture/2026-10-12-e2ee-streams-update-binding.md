# Scoped published-SDK update binding

Status: proposed
Translation: current

[中文](2026-10-12-e2ee-streams-update-binding.zh.md)

## Abstract

The original SDK content provider used obsolete authority callbacks and unowned
leaf keys. Add a header3 update Effect codec that consumes public verified content
workflows, checks the real epoch commitment and releases operation-owned keys.
Snapshot format remains a human decision and real SDK/Lab consumers remain the
integration layer's responsibility. This is a partial binding, not full migration.

## Ownership and evidence

Direct parent is sender #1493 `36ca2685b7eefeb15ebd041e50444796c2686652`.
The [content contract](../../../../packages/e2ee-core/src/content/README.md) owns
current behavior. [Provenance](../../../../packages/e2ee-core/src/content/streams-provenance.json)
records immutable source fingerprints. Preserve HPKE, v0 content algorithms and
settled header3. No runtime, signer creation, native key store or nonce override.

Each successful key read transfers a fresh owned opaque epoch key. Genuine
ledger context and fixed historical signatures precede read lookup; exact epoch
commitment precedes lazy leaf derivation. Brackets clear/invalidate owned copies
on success/failure/interruption. Scope closes admission and awaits active leases
before releasing earlier native/storage owners. Caller-owned Effects retain their
own cancellation contract; this codec cannot make arbitrary callbacks stop.

Author owning tests use real synthetic signatures/HKDF/AEAD and genuine ledger
replay, plus published SDK type contracts. They cover late-output refusal, scope
ordering, wrong commitments/AAD, forged author rejection before key reads, and
leaf/sibling/borrowed-key lifetimes. The first close test's signal proved only
entry to closing, not that admission had closed; retain its failure. The corrected
probe starts close to the explicit active-lease wait and verifies closed admission.
Removing that wait makes the actual owner's release-order assertion fail.
These tests are not actual SDK envelope/transport or independent acceptance.

SDK 0.16.2 AAD authenticates its envelope/header but does not include snapshot
continuationOffset. Do not invent a new writer header or silently accept legacy
snapshot4. The manifest leaves provider snapshot/replay and actual Lab consumption
unfinished. Strict B, recovery-vault/concurrent retention, permanent publisher
loss and D12 also remain open. SDK preparation is not a production protector.

Author owning42/core302, package typecheck, complete root `pnpm check`, formatting,
docs and public-boundary checks pass. Frozen install with scripts disabled passes;
the SDK type dependency adds only three importer lock lines and upgrades no pins.
Fresh-clone checks initially lacked ACP dependencies/build output and then found a
new test variable shadow; retain failures and corrected full check. Branch CI and
independent review remain separate and unclaimed.

Evidence correction after the first Draft: the original no-wait negative-control
log was a timeout, not the release-order assertion previously reported. Its failed
assertion entered cleanup that still waited on the unreleased test gate. Retain
that log as insufficient evidence. Own the child Scope and release each gate from
a failure-path finalizer registered after its worker. The revised no-wait control
fails at `ownerReleased` before gate release, and finishes through actual cleanup.
No production code, algorithm, wire, API or dependency changes in this increment.
