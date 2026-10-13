# E2EE core and Lab migration

[中文](e2ee-migration.zh.md)

This migration brings the public library, protocol drafts and runnable local Lab into one implementation. It does not activate product E2EE, migrate production data, publish packages, or establish native key custody or platform acceptance. The [whitepaper](../../specs/e2ee/whitepaper.md) describes proposed architecture; its implementation claims refer to the pinned prototype until the owning public layer is verified.

## Source and ownership

The [per-file manifest](e2ee-migration-manifest.json) records source SHA-256, target owner, disposition and layer. `已迁` means the functionality has an existing public owner, not byte-for-byte copying or whole-module acceptance; `需迁并修复` includes unfinished implementation, `旧方案淘汰` retains the pinned source as history, and `待明确决定` requires a protocol or product decision. Planned target paths are not claims that those files exist.

- Public base: `984c35c5b30600d68abec1ec3e585eca73bcd4f0`, including HPKE [#1432](https://github.com/LodyAI/Lody/pull/1432).
- Original core: `f1bc0c52649c21d2e9b620fe3558874c40545e38`.
- Candidate: `bd5a9c1ec71ed7fa8085e51faec4f1e8dbe985b8`; staged patch SHA-256 `4c36a1e507f2e7bcc55e9e88906ffe2b617e9d9c9aed55ab5e76745bd4d7ee71`; unstaged diff empty. Original source and candidate stay read-only.
- Public Effect resolves from `packages/e2ee-core` to **4.0.2**, matching the root lock/catalog. The prototype's separate v4 catalog does not justify upgrading or adding another Effect runtime.
- Actual Lab source is `packages/e2ee-lab`: local HTTP/SQLite Riverrun host, honest Loro/Flock clients, scheduling, attack capability, replay packs, synthetic fixtures and crash subprocesses. Both pinned sources contain this package. The playable tutorial has drafts but no corresponding application source in either pinned tree. The source independent-demo note explicitly records removal of `packages/e2ee-demo` after host/session coverage moved to `packages/e2ee-lab`; its obsolete startup commands are not runnable migration commands.

The design source's public whitepaper and permission text are carried here with internal plan/evidence links removed. Private decision records, implementation plans, production configuration and transcripts remain in their owning repository. Their fingerprints identify the constraints without publishing their contents.

## Stack and shared files

Each layer compares only with its direct parent. Actual branch/head/base and validation are recorded in its Draft PR; the final layer also validates the complete diff and test tree. A layer may split when independent review needs a smaller risk boundary.

| Layer | Responsibility                                                                      | Shared owner and dependency                                                                                                                                     |
| ----- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L0    | Public bilingual architecture, protocol provenance, inventory                       | Specs stay draft; no inferred approval.                                                                                                                         |
| L1    | Authenticated ledger snapshots, comparison and historical author authorization      | Extend `src/ledger` records/policy/replay, opaque verified views and strict signature verifier. No candidate verifier injection or arbitrary-state constructor. |
| L2    | Signing, content and document-key workflows, SDK provider                           | Reuse `src/crypto`, v0 domains and existing public byte wrappers; published SDK only.                                                                           |
| L3    | Host snapshot admission, exact position and client document recovery                | Trusted caller context/AAD; persistence precedes cursor advance; one bad document does not stop unrelated documents.                                            |
| L4    | Epoch envelope/history, rotation, durable mailbox, installation reports and repairs | Fixed HPKE suite; exact pending/outbox bytes; finite explicit rounds; no hidden runtime. D12 format and permanent-loss backup are separate decision gates.      |
| L5    | Settled recovery authorization and cleanup contracts                                | Independent R per workspace; one-file direction. Vault/file encoding, wrapping, concurrency and retention remain undecided.                                     |
| L6    | Lab integration, local host, replay, fixtures, commands and fault acceptance        | Consume the new public core and registry SDK. No copied core, old two-step member-removal story or unpublished vendor tarball.                                  |

`package.json`, the root lock/catalog, entry maps and module README/AGENTS belong to the first layer that consumes each change and are updated incrementally. Node-only storage has an explicit subentry; no native custody or runtime is silently installed through the portable root. Test fixtures belong to their behavioral owner. Lab owns synthetic storage adapters and its process resources; core owns protocol policy.

Platform custody, private cloud ledger/projection/JWT/mailbox, Web/mobile composition, published upstream changes and production deadline enforcement are linked workstreams in their respective repositories. They cannot be represented by one public Git stack.

```mermaid
flowchart LR
  A[L0 Documents] --> B[L1 Ledger trust]
  B --> C[L2 Content]
  C --> D[L3 Snapshot recovery]
  D --> E[L4 Key distribution]
  E --> F[L5 Settled recovery]
  F --> G[L6 Lab acceptance]
  X[Atomic format / vault / permanent-loss decisions] -. scoped gates .-> E
  X -. scoped gates .-> F
```

## Decisions that remain open

- SDK content-snapshot position: old snapshot header4 hides the offset in ciphertext, so host verification cannot establish the actual submitted position. Proposed new snapshot header binds an exact-offset SHA-256 digest through existing SDK v2 AAD; alternatively change upstream SDK and consume a published release. New tag/domain and old-reader/admission compatibility remain unapproved. Provider and host admission must be reviewed together.
- Strict deadline B: no new claim and no change to ordinary 60-second tolerance.
- Recovery-vault format, wrapping, identity/version binding, concurrent updates and retention. The old shared-R/file prototype is not approved as that format.
- New-key backup and recovery when the publishing device is permanently lost after commit and before delivery. A process restart cannot validate permanent-loss recovery.
- D12's new atomic-removal encoding/version/old-reader rejection. Reject standalone old tag2 removal; do not invent replacement fields until confirmed.
- Self-device-revocation rotation scheduling, exact machine-operation scope and any newly discovered protocol conflicts require their owning decision. These do not block unrelated snapshot/content work.

Settled requirements include per-workspace R, client recovery of bad snapshots, document-local sync failure, native secure key custody preference without changing algorithms, durable offline edits, and disabled production E2EE.

## Reproduced prototype failures

Run these only in an independent frozen copy with synthetic keys and local sockets. The source candidate is not a test worktree.

```sh
pnpm --filter @lody/e2ee-core exec vitest run test/review2-a.test.ts test/review2-c-delivery.test.ts test/review2-c-rotation.test.ts test/review2-e-api-boundary.test.ts
pnpm --filter @lody/e2ee-lab exec vitest run test/review2-b-sync.test.ts
```

The first run independently reproduced **7 failures / 5 passes**; the Lab run reproduced **2 failures / 12 passes**. These are selected review suites, not full-suite totals. Retain old failure evidence and new passing behavioral reproduction in each owning layer.

| Reproduction                                                  | Owner                 | Required disposition                                                                                        |
| ------------------------------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------- |
| Reflective construction of a forged LedgerView                | L1                    | Public closure-backed views already reject constructors; test equivalent attack through real exported APIs. |
| Caller-supplied always-success signature verifier             | L1                    | Public authority creation must perform the pinned real verifier, never accept injected success.             |
| Admin-signed snapshot leaving Owner without personal/R device | L1                    | Structural reachability check at snapshot import.                                                           |
| Substituted journal endorser becomes trusted Owner            | L1 + #1434            | Restore requires independently retained trust; journal contents grant no trust.                             |
| Duplicate envelopes exceed read limit and block delivery      | L4                    | Bounded resumable paging and exact cursor progress.                                                         |
| Sending 4097th envelope fails lifetime outbox limit           | L4                    | Durable bounded pending/result lifecycle, not a permanent lifetime counter.                                 |
| Rotator permanently loses current key before delivery         | L4 + backup decision  | Keep unresolved; no claim that local restart fixes permanent loss.                                          |
| Duplicate committed control record accepted at later offset   | L6 + ledger transport | Reject it with state and cursor unchanged.                                                                  |
| Rollback page rewinds persistent cursor                       | L6 + ledger transport | Reject it with prior durable state/cursor retained.                                                         |

Full frozen-copy confirmation: core **574 passed / 7 failed / 1 skipped**; deterministic Lab **182 passed / 2 failed**, excluding the external-model suite. All nine failures match the table. The public submission target is `src/submission/index.ts` with SQLite in `src/submission/sqlite.ts`; candidate transport framing must adapt to that contract after it lands.

Also reproduce and fix the known snapshot continuation-offset substitution in L3. No test removal, missing export or disabled functionality substitutes for a fix.

## Acceptance and resource ownership

Core workflows remain inert Effect values. Application/Lab composition owns Scope, creation, cancellation, waiting and bounded awaited close. Promise APIs pass cancellation to cancellable work; non-cancellable native work is awaited before temporary secret cleanup. `Result.gen` early failure does not run a generator `finally`: cleanup must use an ordinary outer `try/finally` or a scoped Effect resource.

Lab acceptance uses real HTTP/SQLite persistence, process reopen, two clients, Loro/Flock/Repo SDK paths, durability barriers, retained cursor on decrypt/import/save failure, document isolation and bad-snapshot client recovery. Controlled transport faults and synthetic key protection are stated as test boundaries. External-model exploration is optional, separate from deterministic CI and does not access real keys. SIGKILL recovery is not power-loss or device-loss acceptance.

The complete stack is unfinished. Migrating the manifest is not migrating its remaining implementations; no layer is Ready, merged, deployed or published by this work.

Current implementation base: all three prerequisites have landed. Submission #1434 merged as `7c58cabe1d05f132b7133a52b45a16b79274ea6a`; L0 now includes actual main `984c35c5b30600d68abec1ec3e585eca73bcd4f0`. L1a migrates historical authors, signed epoch facts and current content permission queries without wire changes. Snapshot format/old-reader compatibility remains a separate decision gate.

## Current implemented stack

This is the refreshed Draft stack snapshot before this layer. Parent head is the exact selected stack basis. Main continues moving; the frozen bottom ancestor is not a claim about latest remote main. Independently review each current PR head/base.

| PR | Branch | Head | Parent head |
| --- | --- | --- | --- |
| [#1438](https://github.com/LodyAI/Lody/pull/1438) | `e2ee-migration-baseline` | `59c3840b0165ce8a6637418c1e2b2095b13f6b88` | `984c35c5b30600d68abec1ec3e585eca73bcd4f0` |
| [#1439](https://github.com/LodyAI/Lody/pull/1439) | `e2ee-ledger-content-facts` | `946965a7fd3ccc10c6a18f41f8f54a38c74232a3` | `59c3840b0165ce8a6637418c1e2b2095b13f6b88` |
| [#1442](https://github.com/LodyAI/Lody/pull/1442) | `e2ee-document-workflows` | `543f82d1c4f4470436d4ad183f0f53259faddf49` | `946965a7fd3ccc10c6a18f41f8f54a38c74232a3` |
| [#1446](https://github.com/LodyAI/Lody/pull/1446) | `e2ee-epoch-history` | `b67e0c062c667046d8c90b7a2512dbbd0834be40` | `543f82d1c4f4470436d4ad183f0f53259faddf49` |
| [#1447](https://github.com/LodyAI/Lody/pull/1447) | `e2ee-ledger-signing` | `d87ee2d444a60079ae1adf84565a7bd53faf905e` | `b67e0c062c667046d8c90b7a2512dbbd0834be40` |
| [#1448](https://github.com/LodyAI/Lody/pull/1448) | `e2ee-epoch-envelopes` | `0a73d464b5c93fab4b4e0f7ce704778ba437ac94` | `d87ee2d444a60079ae1adf84565a7bd53faf905e` |
| [#1450](https://github.com/LodyAI/Lody/pull/1450) | `e2ee-key-delivery` | `34b918367fe23f6bf9c2ff1cea31b154de298cb2` | `0a73d464b5c93fab4b4e0f7ce704778ba437ac94` |
| [#1464](https://github.com/LodyAI/Lody/pull/1464) | `e2ee-ledger-snapshots` | `5d3967ec94e3b10fdec76220937e9fcfe2623590` | `34b918367fe23f6bf9c2ff1cea31b154de298cb2` |
| [#1472](https://github.com/LodyAI/Lody/pull/1472) | `e2ee-key-mailbox` | `58cbd49c6869f28d09efb60d3b9a7ec10243e93a` | `5d3967ec94e3b10fdec76220937e9fcfe2623590` |
| [#1474](https://github.com/LodyAI/Lody/pull/1474) | `e2ee-content-snapshot-auth` | `f6bedf5092b921e8a34f1baacc9a50c6bb9d5a08` | `58cbd49c6869f28d09efb60d3b9a7ec10243e93a` |
| [#1479](https://github.com/LodyAI/Lody/pull/1479) | `e2ee-ledger-admission` | `f7dc8e53b1f5a10f11d3eeebab3a292c3fc3023b` | `f6bedf5092b921e8a34f1baacc9a50c6bb9d5a08` |
| [#1480](https://github.com/LodyAI/Lody/pull/1480) | `e2ee-host-epoch-protection` | `ec6a02f97aea1445a89ee1bc5a4d72e38f1bf9ee` | `f7dc8e53b1f5a10f11d3eeebab3a292c3fc3023b` |
| [#1482](https://github.com/LodyAI/Lody/pull/1482) | `e2ee-epoch-receive-reports` | `4134109a76739d8b36ff5a8a1209e37e16518703` | `ec6a02f97aea1445a89ee1bc5a4d72e38f1bf9ee` |
| [#1484](https://github.com/LodyAI/Lody/pull/1484) | `e2ee-ledger-feed` | `14e7c5a1a7fd5beb273d77c5dd936c2b7155a1b8` | `4134109a76739d8b36ff5a8a1209e37e16518703` |
| [#1485](https://github.com/LodyAI/Lody/pull/1485) | `e2ee-mailbox-repairs` | `680686d1442e7f8b12f6f8b84af3f17f3c514b97` | `14e7c5a1a7fd5beb273d77c5dd936c2b7155a1b8` |

SDK preparation #1433 and submission #1434 landed; the latter merge is `7c58cabe1d05f132b7133a52b45a16b79274ea6a`. Their implementation remains unchanged. Host protection direction A is settled: trusted composition initializes protect/unprotect once, binds purpose/Org/recipient/epoch/commitment and requires actual save/reload before reports. Synthetic protection is not native platform custody.

L1d [full-history feed](../../packages/e2ee-core/src/ledger/FEED.md), L4g [durable repair](../../packages/e2ee-core/src/keys/REPAIR.md) and L4h [recipient fetch composition](../../packages/e2ee-core/src/keys/RECIPIENT-MAILBOX.md) have public owners. Full-history final comparison uses independently owned bytes; terminal repair and acknowledgement preserve all originals. Active registered R may receive/repair epoch keys without sending/writing/managing rights. Original Lab2 failures await the actual migrated consumer. Sender discovery/current-key/outbox rounds, SDK CAS/provider/snapshot bootstrap and Lab/recovery scopes remain unfinished. Legacy whole-JSON journals are retired without implicit import. Original labeled entropy replay requires an explicit Lab capability decision because public first seals use fixed secure randomness; no global crypto override or unapproved primitive change is made.
