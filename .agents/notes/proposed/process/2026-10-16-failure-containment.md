# Failure containment guidance and review skill

Status: proposed
Translation: current
PR: https://github.com/LodyAI/Lody/pull/1607

[中文](2026-10-16-failure-containment.zh.md)

## Abstract

Lifecycle guidance told agents to retain failed owners, preserve complete failures
and refuse replacement until release was confirmed, but said nothing about how far
that strictness may spread. A review of draft PR #1607 found that one ordinary
release failure could abort workspace teardown or block a document until reload,
and that a new confirmation wait sat in front of every local capability probe.
This change adds a counterweight: a failure fails only its own operation, teardown
runs every step, retained owners retry on the next use, and new gates stay scoped
and bounded. It also adds a review skill that traces such regressions from a
realistic trigger to the user-visible effect. The guidance is unproven until
reviewers use it on later lifecycle PRs.

## Problem

The [Effect guide](../../../docs/cli-effect-ts.md#behavior-contract) asks who
retains an unresolved resource and who can retry cleanup, and its acceptance
matrix requires retaining the owner and full Cause on release failure. Root
`AGENTS.md` prefers explicit contracts over hidden fallbacks. Neither asks what
else stops working when the strict path fails. Read alone, they reward
converting best-effort cleanup into propagated failure and adding fences, because
each such change looks locally more correct.

The review bar compounds this. `.github/codex-review.md` excludes "hypothetical
edge cases", and storage or network failure during cleanup is easy to dismiss as
one, so a reviewer following the bar would not report these regressions.

## Evidence

A review of draft PR #1607 at `9b5122ca`, comparing it with merge base
`d73db66f4`, found:

- `createManagedStoreCache.disposeAll` changed from swallowing store disposal
  errors to throwing `AggregateError`. The workspace `dispose` in
  `create-workspace-runtime.ts` awaits the three caches without a guard before
  `teardownTransport()` and `repo.destroy()`, and memoizes `disposePromise`. One
  failed lease release would therefore leave transports and the Repo open with no
  retry.
- After a failed disposal, `retainedDisposals` makes every later `get` for that
  key reject. The tracker's release callback needs a successful acquire first, so
  nothing retries automatically. `PromptShortcutSync` adds the same fence with
  `retiring` and `failure`. The PR's own README states that the native Repo
  already shares one replica between borrowers.
- Every local `acp-capabilities-refresh` began awaiting a Machine Flock peer
  receipt with a 20-second deadline. Only a probe immediately after a
  configuration save can race the write; when offline, other probes now fail.
- `WorkspaceRepoLegacy.failures` collects every non-interrupt background failure
  for the life of the workspace, without a bound, and `destroy()` fails with all
  of them.
- In the same PR, `WorkspaceRepo`, `workspaceRepoLayer` and the
  `openWorkspaceDoc`/`acquireWorkspaceRoom` helpers had no consumers.
  `LocalLoroTransportAdapter` stayed in place although only a type was still
  imported from its module.

These were found by reading the code; nothing was executed. Whether native lease
release actually fails under quota or offline conditions depends on `loro-repo`
and `streams-crdt` internals, which were not checked.

## Decision

- Add [failure containment](../../../docs/failure-containment.md) as the
  cross-module explanation. It gives the rules, the realistic triggers, five
  blast-radius questions, proportion checks and the worked example above.
- Add a required-read trigger to root `AGENTS.md` for changes to teardown,
  fencing, retry or readiness gates, and count a failure-containment regression
  as P1 in the Code Review Rules.
  `.github/codex-review.md` defines that term and states that ordinary storage,
  network and peer failures are not hypothetical edge cases.
- Add a Containment question to the Effect behavior contract and a Containment
  row to its acceptance matrix. Clarify there that the replacement fence binds
  only the same owner.
- Add the `failure-containment-review` skill, linked into `.claude/skills`. It
  holds the review procedure and a delegation prompt; the rules stay in the doc.
- Keep root `AGENTS.md` under the size gate by routing restated sentences to
  their owners. The documentation-consolidation bullet becomes a link to
  [documentation at submission](../../../AGENTS.md#documentation-at-submission);
  its "update owning docs and Notes" and Spec clauses are already in root
  "Context and documentation". The module-split sentence in "Effect reference"
  is already stated in the Effect guide's section on choosing a native unit.

## Alternatives considered

- **Only a review prompt.** It would catch some regressions after the fact, but
  the authoring guidance that produced them would stay unchanged.
- **Weaken the Effect retention rules.** Retaining a failed owner and its Cause is
  still correct for recovery. The problem is unbounded spread, not retention.
- **Full rules or a rule summary in root `AGENTS.md`.** The root file was 3 bytes
  below the 8 KiB gate. A required-read trigger follows the existing
  "before changing X, read Y" pattern.

## Limits

The guidance has not been tested on a later PR. The skill's search patterns are a
starting point and will miss failure changes written in other forms. Root
`AGENTS.md` remains above the 7000-byte warning threshold, now 30 bytes below the
gate instead of 3.
