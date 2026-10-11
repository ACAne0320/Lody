# Durable E2EE submission recovery

Status: implemented
Translation: current

[中文](2026-10-11-e2ee-pending-recovery.zh.md)

## Abstract

A lost conditional-append response leaves a signed ledger operation unresolved. This slice persists the exact signed bytes before sending and resolves them against a verified history after restart. A SQLite transaction replaces pending with an unconsumed terminal result and a rollback checkpoint; permission is always reconstructed from an independently trusted genesis, never from a saved state object. Real SQLite fault injection and independent-process reopen tests exercise the workflow, but no production host, checkpoint import, key backup, or automatic re-signing is enabled.

## Decision and ownership

The application Scope owns the SQLite Layer. Closing releases the handle without
deleting pending or results. The adapter reuses the repository's better-sqlite3
catalog (13.0.3) and Effect catalog (4.0.2), with a dedicated local database rather
than changing CRDT/diff-store tables. There was no E2EE journal on main to extend.
One attempt or unconsumed result per genesis is supported. Original signed bytes
identify the attempt; a repeated request must compare the complete body. Explicit
acknowledgement consumes the exact result before a different attempt can begin.
The core workflow creates no runtime, timer, background worker, or signature.

```text
Idle -> verify -> durably save Pending(original bytes)
Pending -> read and verify original result
  original present -> Committed
  parent occupied -> Conflict (no re-sign)
  parent still head -> persist verified pin -> CAS(original bytes) -> verified read
  read/network/save failure or interruption -> retain Pending
Committed/Conflict -> atomically save result/pin and clear Pending
Result -> verify again on reopen -> explicit acknowledgement -> Idle
```

A head/count pin rejects rollback relative to locally accepted evidence. It is
not an authority projection or a global freshness proof. Each read verifies the
complete history and the original record at its authenticated predecessor,
including if the signer was subsequently revoked. Terminal rows are reverified;
a forged local Committed result or Owner object grants no authority. The trusted
remote port must supply independently expected endpoints and enforce P08 CAS
admission. Local disk replacement and a dishonest freshness source are not solved.

## Scope alternatives and gaps

Reusing CRDT/diff tables would mix resource owners and persistence contracts.
An in-memory journal cannot survive process exit. Importing the candidate's state
would expose its journal trust boundary; this slice instead calls the already
merged P08 verifier and has no arbitrary-state import. Foreign/legacy databases
are refused. The journal schema is local implementation data, not a recovery-vault
or wire-format decision, and P12 removal encoding remains untouched.

Authenticated checkpoint recovery is excluded: its trust and continuation contract
is not available on main. Missing history, bad signatures, unsupported records or
rollback stop recovery; no new checkpoint bypasses evidence. Full retained history
is required. Bounded paginated persistence, genesis creation, key custody/backups,
downstream distribution and production Convex/Streams composition remain separate.
There is no Electron/CLI product call path yet; the actual local process entry
`test/submission/reopen.ts` composes the workflow with real persistent backends.

## Provenance and verification

Implementation base: `f1ba33a61244e2da07aaea93a30f06227311c4b6`, fetched only after
P08 #1418 actually merged. P07-b #1417 is also in this base. No unmerged branch or
candidate journal was copied. [Source fingerprints](../../../../packages/e2ee-core/src/submission/provenance.json)
identify the merged dependency closure and new implementation files.
The candidate's seven core and two Lab failures were not rerun or closed.

Package typecheck and 100 tests passed, including 15 submission tests: native
synthetic signatures, independent Node process exit before CAS / after durable
CAS before response, original-byte recovery, duplicate-body rejection, conflict
and revoked-signer recovery, unconfirmed append, SQLite prepare/terminal-save
failure, unreadable/foreign/bad history, forged terminal result, rollback,
concurrent task replacement and Scope interruption/close. Assertions observe
persisted data, verified outcomes and resulting history, not mock counts.

Vitest stays at 3.2.4. @effect/vitest 4.0.2 requires Vitest 5; to retain locked
versions, tests use the existing runner with Effect.scoped and Deferred signals.
The isolated clone initially needed the locked ACP core built before the root
check could build Codex. Root typecheck/lint, format, docs and all static boundary checks passed.
Default full pnpm check failed on seven shared socket cases (listen EPERM);
the same two suites passed 14/14 with local permissions. Remaining CLI passed
3711 with four existing skips; UI 300 and turn-diff 31 passed. Electron had
11 sandbox socket/download failures; their three suites passed 20/20 with local
permissions and an isolated npm cache. The original full check remains failed,
not re-labelled green; CI is tracked in the PR. Focused tests and CI are not production, security-review, installed
client or all-platform acceptance; independent high-risk review is separate.
