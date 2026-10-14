# Public E2EE Lab

[中文](README.zh.md)

A private, synthetic Lab consuming public `@lody/e2ee-core` exports and released
SDKs. It runs real loopback HTTP, SQLite, HPKE, Loro/Flock and OS processes.
Migration remains incomplete; this package does not enable production E2EE.
E2EE has not shipped, so old data, ledger and API compatibility is out of scope.

## Run

Use the repository's supported Node and pinned pnpm, initialize public submodules,
and install the frozen lockfile in a standalone checkout. Dependency versions
come from [package.json](package.json) and the root lockfile.

```sh
pnpm install --frozen-lockfile
pnpm --filter @lody/e2ee-lab typecheck
pnpm --filter @lody/e2ee-lab test
pnpm --filter @lody/e2ee-lab lab run /absolute/new-output-directory
pnpm --filter @lody/e2ee-lab lab run /absolute/another-new-directory actions.json
pnpm --filter @lody/e2ee-lab lab inspect /absolute/new-output-directory/evidence.json
```

`run` requires a new output directory. The default plan executes 39 actions;
custom plans are JSON arrays of at most 256 actions. Unsupported actions and
accessors fail before execution; missing required observations fail explicitly.
SIGINT/TERM closes admission and awaits actual child termination.

Negative expectations require an exact refusal, for example:

```json
{ "ok": false, "refusal": { "tag": "LabContentError", "code": "decrypt_failed" } }
```

An unrelated typed failure, defect or untyped error is a harness failure.
Each applicable ok/outcome/text/unchanged-state check retains its own verdict;
a passing check cannot erase another measured violation or missing measurement.

| Exit | Meaning |
| --- | --- |
| 0 | The measured action contract passed |
| 1 | Harness failure |
| 2 | Measured violation or coverage gap |
| 64 | Invalid CLI usage |

`evidence.json` records actual loaded source/release hashes, signed originals,
protected wire bytes, schedule, observations and coverage gaps. Referenced
`fixture/*-transport.jsonl` files contain protected protocol traffic without
credentials; private device exports stay in IPC memory. `inspect` recomputes
judgments from recorded observations instead of trusting saved verdicts. It does
not authenticate an artifact or rerun its scenario. Timing is diagnostic only.
A fixed120s harness watchdog interrupts stalled scenarios, kills/awaits owned
children and releases resources before returning `LabScenarioError/watchdog`
(CLI exit1). Final evidence is written only after successful owner cleanup;
this watchdog is not a performance pass threshold or strict freshness B.

## Entry points and owners

| Entry | Responsibility |
| --- | --- |
| `./workspace-session`, `./full-session` | Existing admitted control/P09, identity, keys and per-document owners; reauthentication closes the previous owner |
| `./join-session` | Durable original signed join intent; retry after lost receipt, then ordinary startup after genuine admission |
| `./key-round` | One finite repair/receive/report/distribution pass; blocked tasks and page cursors remain explicit |
| `./content-session`, `src/platform/flock-session.ts` | Loro/Flock adapters sharing one document lifecycle and atomic native-state/cursor storage |
| `./host`, `./http-identity` | Synthetic challenge/bearer HTTP, signed genesis discovery, joins, mailbox and bounded control/content transport |
| `./driver`, `./actions`, `./scenarios` | Native Effect permits, finite actions, real process crashes and measured evidence |
| `./snapshot-cache`, `./reference-model`, `./replay` | Reverified ledger snapshot bytes, independent predictions and inert-material comparison |

The receiver owns one protected installed-key store. The distributor and full
session borrow its `installedEpochKeys`; they do not reopen duplicate owners.
Native phases use Effect directly. `LabCallbackRunner` exists only for actual
Node/SDK Promise callbacks; unused attack hooks and Promise-phase APIs are removed.
Parent identities use JSON tuples; replay compares exact parent and occurrence.

## Authority, persistence and shutdown

Existing sessions require an already published full signed control prefix,
including original genesis, and independent local/network checkpoint pins.
Discovery, SQL rows, offsets and IPC observations cannot select authority.
Private IPC points are checked against independently witnessed signed originals.
Failed ledger reads or SQLite writes retain verified history and cursor together;
P09 retries the original signed bytes, and ACK follows durable feed verification.

Stored credentials bind the actual device and Org; JSON cannot choose a sender.
Recovery devices can receive/repair and authorize their own new personal device,
but cannot send epoch envelopes or write content. Current sender eligibility is
checked separately from lawful historical content authentication. Join receipt is
inert. Snapshot cache reads reverify caller-pinned qualification; eligibility alone
never admits a snapshot or establishes current authority.

Each document commits native state and its exact SDK cursor atomically. Failed
import/save/recovery stops only that document and retains its prior durable pair.
Full-history recovery requires readable retained history; it never resets host
offsets or deletes snapshots. Flock uses an explicit monotonic logical clock.

Shutdown stops admission, aborts requests and waits for actual raw work/body
settlement before earlier storage/native owners close. Concurrent close callers
share completion, including cleanup failures. `StreamsClient.close()` publishes
protocol EOF and is never used as disposal. CRDT SDK close does not await every
one-shot operation: join raw work, close subscriptions/SDK, then free Loro.
Flock has no public deterministic free/dispose; drop references after settlement.
Abort alone does not prove stopped work or guarantee bounded native shutdown.

## Remaining boundaries

- Resumable workspace creation and independently acquired durable host checkpoints.
- Protected content-snapshot position/format, qualification and retained-history API.
- Durable new-epoch/removal producers, candidate backup policy and recovery vault.
- Exact entropy/ciphertext regeneration, remaining original actors/attacks and confidentiality measurements.
- Comparison-note authority, strict freshness B, native key custody and product wiring.

Restricted A covers trusted initialization-time protection of installed keys only.
The known-key AES protector and exportable devices are synthetic fixtures, not OS
custody, candidate backup or historical-sender-envelope restoration B. Tests,
remote CI, independent review and product acceptance remain separate evidence.
See the [manifest](../../.agents/docs/e2ee-migration-manifest.json),
[composition note](../../.agents/notes/proposed/architecture/2026-10-12-e2ee-lab-integration.md)
and [provenance](migration-provenance.json). Full earlier checkpoints remain in
[Git at 5ab9394](https://github.com/LodyAI/Lody/blob/5ab9394392a3577a76b14ab0552c33f755b3ce48/packages/e2ee-lab/README.md).
