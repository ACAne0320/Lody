# Failure containment in lifecycle code

A local guarantee is worth having only if its failure stays local. This page
explains how release, teardown, retry, fencing and readiness waits keep a bounded
blast radius across the CLI, renderer and shared packages. The root
[`AGENTS.md`](../../AGENTS.md#contributions-and-checks) requires reading it before
changing teardown, fencing, retry or readiness gates; Effect-specific lifecycle
rules are in the [Effect guide](cli-effect-ts.md#behavior-contract).
Reviewers use the [failure-containment review skill](../skills/failure-containment-review/SKILL.md).

## The trade this page guards against

Lifecycle rules ask an owner to retain an unresolved resource and its complete
failure, and to refuse replacement until release is confirmed. Those rules protect
one owner. Applied without a boundary, the same strictness spreads: a failed
release throws out of a teardown loop, a fence rejects every later caller, and a
new confirmation wait sits in front of work that never needed it. Each step is
locally more correct. Together they turn one ordinary I/O failure into a workspace
that cannot close, or a document that cannot reopen until the window reloads.

Strictness belongs to the owner and to the report, not to the paths around them.

## Rules

**A failure fails its operation, not its neighbours.** A failed release, flush or
close rejects the call that requested it, and is retained for recovery and
diagnosis. It does not prevent sibling owners from closing.

**Teardown always runs to the end.** A dispose, destroy or shutdown sequence runs
every step, collects failures (for example with `Promise.allSettled` or by
accumulating Exits), and reports them after the last step. A memoized dispose
receipt must not freeze a half-finished teardown: either every step has run, or a
later call can resume the steps that did not complete. Best-effort teardown with
a recorded failure is an explicit contract, not a hidden fallback.

**Retaining an owner is not blocking its key.** Keep a failed owner so that its
release can be retried, but give that retry a driver: the next acquire for the
same key retries the retained release before creating a successor. That acquire
fails only if the retry fails, and the one after it retries again. A permanent
fence needs both a demonstrated hazard and a documented recovery path, and the
hazard must be one the underlying owner does not already prevent. A reference-
counted shared replica, for example, already prevents a second copy, so fencing
its key adds unavailability without adding safety.

**A new gate is scoped to the hazard that justifies it.** A readiness, handoff or
confirmation wait placed before an existing action applies only to the operation
that creates the race, such as the first probe after a configuration save, not to
every startup, periodic or forced call. It has a deadline. On timeout or an absent
peer it produces the action's existing typed result or degrades to the previous
behavior; it never escapes as an unhandled rejection. When possible, carry the
precondition (a version or write receipt) to the owner that can wait for it
locally, instead of making the caller wait on a second channel.

**Diagnostic collections are bounded.** Background failure buffers have a size
limit or a lifetime. A stream failure observed and recovered an hour ago must not
make an unrelated later close fail.

**A compatibility facade keeps its callers' failure semantics.** A Legacy facade
over a native owner preserves what its callers observed before: a release they
could ignore stays ignorable at that boundary unless the PR deliberately changes
it, names every affected caller and covers the resulting state. The facade projects
state from the native owner; it does not keep a parallel copy of attachments,
statuses or rooms that can disagree with the owner.

## Realistic triggers

Treat these as expected events, not hypothetical edge cases: IndexedDB quota or a
closed database, SQLite busy or locked, a network drop during a flush or close, an
absent or slow local peer, a timeout, a worker restart, and interruption during
shutdown. A change that turns one of them into lost availability is a shipped
regression, even when the happy path is fully tested.

## Blast-radius questions

Answer these in the owning Note for every new throw, fence, retained-failure map or
wait added to a lifecycle path. They complement the
[behavior contract](cli-effect-ts.md#behavior-contract).

| Question      | What a good answer shows                                                      |
| ------------- | ----------------------------------------------------------------------------- |
| Trigger       | Which realistic failure reaches this path, and how often?                     |
| Spread        | Which callers above it stop, skip steps or reject as a result?                |
| Recovery      | What retries it automatically, without a reload or restart?                   |
| Base behavior | What did the previous code do, and why is the change worth its cost?          |
| Hazard        | What concrete harm does the strictness prevent that the owner below does not? |

Behavioral tests for these paths inject the failure at the real boundary and assert
the resulting state: the remaining teardown steps ran, the next acquire succeeds
after recovery, and the ungated operations still complete.

## Proportion

The same changes that over-apply strictness tend to over-build structure. Keep
both in check:

- A new Service, Layer or exported helper ships with a consumer in the same PR.
  Abstractions for later migrations wait for those migrations.
- When a new implementation supersedes an old one, delete the old one or record
  its remaining runtime consumers. Move shared types instead of keeping a dead
  implementation alive for a type import.
- Split independent units, such as a dependency upgrade, a transport rewrite and a
  consumer migration, using the [migration sizing guide](cli-effect-ts.md#small-migrations-during-feature-and-fix-work).

## Worked example

Draft PR #1607 at `9b5122ca` moved workspace consumers to the native Repo. Review
found that the containment rules above were violated in these ways:

- `createManagedStoreCache.disposeAll` began throwing on one store's release
  failure. The workspace `dispose` awaited it unguarded, so transport teardown and
  `repo.destroy()` were skipped, and the memoized `disposePromise` prevented a retry.
- A retained release failure made every later `get` for that key reject. The
  `PromptShortcutSync` room fence had the same shape. Nothing retried
  automatically, while the native Repo already shared one replica per document.
- Every local ACP capability refresh began waiting for a Machine Flock peer
  receipt, although only a probe immediately after a save could race the
  configuration write.
- The Legacy facade accumulated every background failure without a bound and failed
  `destroy()` with them.

It also added Services with no consumers and kept the superseded local transport
for a type import.

Commit `0d0737560` shows the repairs. Workspace `dispose` runs independent owners
together and reports all failures after `repo.destroy()`, and a failed dispose can
be called again. A store `get` and a shortcut `acquire` retry a retained release
before creating a successor. The ACP handoff waits only for configuration rows
written since the last confirmed handoff. Background failures are logged instead of
being replayed at close. The [decision note](../notes/proposed/process/2026-10-16-failure-containment.md)
records why this guidance was added.
