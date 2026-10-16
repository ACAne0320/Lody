# Workspace data

`CLAUDE.md` is a symlink to this file. Edit `AGENTS.md` only.

- Compose one `loro-repo/effect` Repo per workspace owner. Borrow native Doc,
  Flock and room leases in caller Scopes; never construct a parallel Promise Repo.
- Native modules do not import Legacy workflows or execute `Effect.run*`.
  `repo-legacy.ts` is the sole deprecated execution door for current CLI managers,
  renderer stores, shortcut grants and snapshot migration readers. Delete it as
  those consumers accept native Repo and caller Scopes directly.
- Open absence is distinct from explicit business identity creation. A peer
  baseline never proves server absence, upload ACK or local durability. Keep
  server, peer and local authority separate and require fresh confirmation.
- Legacy room status includes actual attachment/routing: an absent route is
  detached even if its native detail ref starts joining. First-sync waiters
  survive deliberate absence and settle only on a routed baseline or failure.
- Record newly authored Provider rows at the writer boundary. Only probes with
  a pending config write wait for the selected local peer; ordinary refreshes
  need no data-plane receipt. Clear only the write covered by that receipt.
  Saves stay local-first; peer handoff never proves server authority.
- Close borrower Scopes before Repo close. A failed finalizer retains its full
  Cause and native retry owner; closing an already closed Scope cannot retry it.
  The next acquire retries a failed owner. Independent workspace cleanup must
  continue after failure, then report errors; a failed dispose remains retryable
  without reopening admission. Do not dispose storage while accepted I/O is pending.
  Background stream diagnostics never veto close or retain unbounded Causes.
- Document cursor reuse is explicit and limited to the same persisted replica.
  Meta/Flock checkpoints remain replica-bound. Never share worker cursors with UI.
- Product code uses the native local v7 client; the previous client lives only
  in test-support as a host wire-compatibility fixture. The native client owns bounded protocol queues and workers in Scope; physical
  Electron callbacks only enqueue events. Queue overflow requires a new snapshot.
- Never log private Causes, grants, cursor URLs or request bodies. Project only
  upstream validated diagnostic scalars.

Decision and verification: [native ownership](../../../../.agents/notes/proposed/architecture/2026-10-16-native-workspace-repo.md).
