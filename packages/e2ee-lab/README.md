# Public E2EE Lab (migration in progress)

The first consumer composes the public scoped ledger reader and SQLite feed
with released streams-client 0.9.0. It has no copied core implementation.
The separately selected signed checkpoint is an input, never inferred from the
server cursor. Reads serialize; frames, history and cursor commit together.

Run `pnpm --filter @lody/e2ee-lab typecheck` and
`pnpm --filter @lody/e2ee-lab test` from the repository root.

The original local host, content sessions, Loro/Flock persistence, scheduler,
attacker capability, captured replay, fixtures, CLI and complete fault matrix
are still being migrated. This initial consumer does not close the original
Lab2 failures until the equivalent real host/client scenarios are migrated and
reproduced. Native key custody and production E2EE remain outside this Lab.

The scoped permit runtime requires explicit mode/time/fetch inputs. Closing it
stops new work, aborts, waits retained native work, and then releases its owner;
late values are rejected. Its Promise callback bridge is deprecated. Logical
scheduler commands return typed Result errors. Full host/driver integration is
still pending. Tests state which injected raw native-work boundaries are mocks.
