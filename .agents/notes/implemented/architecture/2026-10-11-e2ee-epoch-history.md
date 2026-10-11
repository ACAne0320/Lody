# Canonical epoch history and scoped volatile installation

Status: implemented
Translation: current

[中文](2026-10-11-e2ee-epoch-history.zh.md)

## Abstract

The source includes incompatible JSON and canonical-ledger key protocols, and its reverse-history failure retains operation-owned secret copies. This layer migrates the current ledger's commitment/72B history and install/read/clear behavior over real verified views, preserving bytes/algorithms while wiping failed recovery copies. Volatile installation requires active recipient eligibility and a local verified-prefix pin; it is not backup, native custody or durable rotation/delivery.

## Decision and ownership

Direct parent is document layer [#1442](https://github.com/LodyAI/Lody/pull/1442), `543f82d1c4f4470436d4ad183f0f53259faddf49`. `./keys` owns commitment/history and application-scoped volatile storage; `src/ledger` owns the verified-prefix relation. No caller-supplied raw state/map, injected signature verifier or journal-derived trust can establish installation authority. The current record/commitment/history domains remain unchanged, including epoch zero's deliberate genesis omission. The JSON prototype's lody-epoch-secret/v1 digest and signed history frame are retired; its observable installation/clear responsibilities are adapted to canonical facts.

All reverse links and old commitments must pass before any recovered keys are returned. Temporary secret copies use ordinary try/finally, not Result.gen iterator-finally. The cache has no async native work within synchronous installation, so no pending install races are introduced. Scope owns creation and a synchronous awaited close; it wipes stored copies and rejects escaped use. Clearing retains known authority observations, preventing a previous view from restoring a known revoked recipient. A verified newer view may remain observed after a local read fails; this is distinct from a remote cursor/durable-state advance. Caller freshness/persistence and final distribution authorization remain external.

SDK snapshot-position format, atomic removal, vault format/concurrency/retention and publisher-loss backup remain proposed decisions in the [migration guide](../../../docs/e2ee-migration.md). No rotation/backup strategy or automatic production feature is inferred from this crypto slice.

## Evidence and limits

An isolated unchanged candidate reproduces a typed failure after decrypting a valid packet with a false old commitment, while 32-byte operation buffers still contain current/old secrets. The same real-crypto failure passes cleanup assertions in the owning public crypto suite. Complete recovery uses native-signed canonical histories and Python/libsodium fixture bytes; bad tags/contexts/commitments, forged views, known rollback/alternate fork, active R eligibility, clear and Scope close are exercised. [Provenance](../../../../packages/e2ee-core/src/keys/provenance.json) records exact inputs and adaptation.

This proves neither durable keystore/rotation, native device storage, delivery repair, device-loss recovery, final runnable Lab nor production E2EE. Original seven core/two Lab failure dispositions remain tracked separately; this additional cleanup reproduction does not close them by omission.

A second isolated old-fail reproduction calls the prior EpochKey symbol accessor through its prototype and can supply a structural material callback to derivation. The final EpochKey uses private WeakMap provenance with no reflected accessor; fake derivation/install fails without a stored slot. Legitimate key bytes/algorithms remain unchanged. The owning suite now has 147 passing package tests, including genuine signed forks.

Validation is separated by tree: full `env -u GIT_EXEC_PATH PATH="/usr/bin:$PATH" pnpm check` passed the 146-test history/cache tree before the final EpochKey provenance fix. On the final code, package 147/147/typecheck, fresh root typecheck/lint, real published-SDK consumers 43/43, format/docs/public boundary pass. No final-tree full-root rerun is claimed; remote CI is recorded against the exact Draft head. Two isolated old-fail reproductions (history cleanup and EpochKey reflection) remain retained alongside new passing behavior.
