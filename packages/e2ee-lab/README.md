# Public E2EE Lab (migration in progress)

This private runnable workspace consumes public `@lody/e2ee-core` modules and
released SDKs: streams-client 0.9.0, streams-crdt 0.16.2, Loro 1.16.3, Flock 0.4.3,
SQLite Riverrun 0.3.0 and the root locked Effect 4.0.2. It has no copied core.

From a standalone repository checkout with the supported Node and pinned pnpm,
initialize the public submodules, run `pnpm install --frozen-lockfile`, and run:

```sh
pnpm --filter @lody/e2ee-lab typecheck
pnpm --filter @lody/e2ee-lab test
```

The tests start actual loopback Riverrun servers on assigned ports and use
synthetic accounts and temporary SQLite files. No global tools, hosted product,
production database, real keys or production E2EE activation are involved.

The ledger client uses an independently selected signed checkpoint, genuine
public verification and serialized durable original frames/cursor. The actor
uses public admission/signing and unchanged P09 submission recovery; failed feed
persistence forbids consumption of a terminal result. Separate OS processes
reopen real state and resume original signed records without a usable signer.

The content provider consumes the public header3 update binding. Actual Loro
and Flock SDK clients encrypt/decrypt and import native state. Each document owns
one SQLite file; staged actual native state and exact SDK cursor commit together
with transactional readback. Failed save retains the prior durable pair. Loro
reopens that pair and the protected epoch store in another OS process.
The AES fixture wrapping capability is synthetic, not native platform custody or
a chosen production wrapping algorithm.

`makeLabLoroSession` owns serial operations, fresh SDK transports and the actual
Loro document. SDK subscription precedes local edits; local state persists before
upload. A failure stops only that document. Explicit full-history recovery keeps
durable local edits and commits only after the full SDK pull succeeds. It does
not delete or change hosted snapshots. Riverrun 0.3.0 snapshot PUT at a nonzero
offset advances `earliest_offset`; that prefix becomes unavailable through the
public history endpoint. Recovery succeeds only while history remains readable.
Otherwise it stays failed without advancing the durable pair. Retained-history
API/host ownership is an unresolved coordinated contract, not completed recovery.

Scope closes admission, aborts requests, waits actual native SDK settlement and
then closes SDKs/storage and frees the actual Loro owner. The published SDK's
`close()` alone does not await every one-shot operation. Flock 0.4.3 exposes no
public deterministic free/dispose: close SDK subscriptions and drop references;
do not touch private internals or claim deterministic Wasm allocation release.
The permit runtime requires explicit mode/time/fetch. Its deprecated Promise
bridge is confined to SDK callbacks. Logical scheduler commands use typed Results.

The original full host/gateway, honest actors, key delivery/rotation composition,
Flock process/recovery/live sessions, schedule driver, attacker capabilities,
captured replay, original fixtures and CLI/startup remain pending. The current
24 tests do not close the original Lab2 failures or the complete original fault
matrix. Snapshot wire/offset, replay entropy, strict deadline B, recovery vault,
D12 and permanent publisher loss remain explicit decisions. Native custody,
production E2EE, independent whole-stack review, CI and product acceptance are
separate boundaries. See the [complete manifest](../../.agents/docs/e2ee-migration-manifest.json)
and the [owning Note](../../.agents/notes/proposed/architecture/2026-10-12-e2ee-lab-integration.md).
