# Verified historical facts and content permission queries

Status: implemented
Translation: current

[中文](2026-10-11-e2ee-historical-facts.zh.md)

## Abstract

Full ledger replay retains signing-device admission identity and signed epoch-history packets in its private accumulator. Historical attribution survives revocation and role changes; it never grants permission to publish new content. Queries require the existing closure-backed verified view. Current write permission allows active personal/machine devices of non-Guest members; Recovery cannot write. The separate honest seal gate also waits for required epoch rotation, preserving admission of previously sealed ciphertext.

This migrates settled source behavior without changing record arrays, domains, algorithms or versions. It extends [ledger replay](2026-10-11-e2ee-ledger-records.md) and [submission](2026-10-11-e2ee-pending-recovery.md) already on actual main. Snapshot encoding/old-reader compatibility, atomic-removal encoding, vault format and permanent-loss backup remain decisions in the [migration guide](../../../docs/e2ee-migration.md); no candidate choice is silently approved. Snapshot partial-history identity fallback is deferred, because this layer permits only complete verified replay.

## Ownership and verification

The portable ledger entry owns the queries and public result types. Public byte wrappers own immutable copies; returned history packet bytes are detached. Epoch zero has no previous-key packet. Packet publication authenticates signed bytes, not decryption or the commitment preimage. The caller still supplies trusted genesis, expected endpoint and freshness; content scope binding and crypto are subsequent layers. Source fingerprints and adaptations are in [ledger provenance](../../../../packages/e2ee-core/src/ledger/provenance.json).

The owning replay suite uses fixed synthetic native Ed25519 signatures. It checks attribution after revocation, role/device-kind permissions, rotation wait/resume, full/incremental equality, detached packet mutation, invalid/unknown epochs, forged/cloned views and atomic failure with no facts leaked into the prior view. Root/workflow checks are reported independently in the Draft PR. This layer does not import snapshots, enable product E2EE, access native private keys or establish platform/device-loss acceptance.

Direct parent: L0 `59c3840b0165ce8a6637418c1e2b2095b13f6b88`, containing actual main `984c35c5b30600d68abec1ec3e585eca73bcd4f0`. Package tests 133/133 and typecheck pass. Root check passed typechecks/lint and reached tests; it stopped on seven unchanged shared local-socket tests with sandbox `listen EPERM`. The same two suites passed 14/14 with local sockets allowed, without source changes. The earlier native Git failure did not recur with `GIT_EXEC_PATH` unset. Root format, docs, public/platform/process boundaries and i18n checks pass. Remaining root test stages are not reported green.

Draft: [#1439](https://github.com/LodyAI/Lody/pull/1439).
