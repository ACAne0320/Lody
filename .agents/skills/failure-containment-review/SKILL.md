---
name: failure-containment-review
description: Review a Lody diff or PR for fail-closed regressions and overengineering, where a local guarantee is bought with whole-system stability. Covers release/teardown failures that now abort shutdown, retained-failure fences that permanently block a key, new readiness gates in front of unrelated work, unbounded failure buffers, facades that duplicate owner state, Services with no consumer, and superseded code kept alive. Use for lifecycle, resource ownership, sync/transport, store cache and Effect migration changes.
---

# Failure-containment review

Find changes that make one owner stricter at the cost of everything around it.
The rules are in [failure containment](../../docs/failure-containment.md); this
skill is the procedure. Repository review rules still decide what gets reported:
read the root [`AGENTS.md`](../../../AGENTS.md#code-review-rules) and
[`.github/codex-review.md`](../../../.github/codex-review.md) first.

## 1. Fix the comparison

Resolve the PR head and its merge base. Review the head commit, and read the base
version of every file you cite. Every finding compares the old behavior with the
new behavior, so a path that was already strict on the base is not a regression.

```sh
gh pr view <PR> --json headRefOid,baseRefName,files
git fetch origin pull/<PR>/head:pr-<PR>
BASE=$(git merge-base pr-<PR> origin/main)
```

## 2. Collect candidates

Search the diff, not the whole tree, for changed failure semantics:

```sh
git diff $BASE pr-<PR> -U0 -- 'apps/*/src' 'packages/*/src' | rg -n \
  -e '^-.*\.catch\(\(\) =>' -e '^-.*catch \{' -e 'allSettled' -e 'AggregateError' \
  -e 'retain|fence|retir|failure[s]?\b' -e 'Promise\.reject\(' \
  -e 'dispose|destroy|release|close|unload|teardown' \
  -e 'timeoutMs|syncRoom|waitFor|handoff|confirm|receipt'
```

Then classify each hit:

- **Removed tolerance.** A `.catch(() => {})`, `try/catch` or `allSettled` around
  cleanup was removed or narrowed, or a cleanup now throws.
- **New fence.** A map or flag records a failure and later calls reject because of
  it (`retained`, `retiring`, `failure`, `fenced`).
- **New gate.** A new `await` on sync, confirmation, readiness or a peer receipt
  sits before an action that previously ran directly.
- **New accumulation.** An array or map gains failures or owners and has no bound.
- **Strict facade.** A compatibility method now propagates failures that its old
  implementation swallowed or logged.

## 3. Trace each candidate to the top

Follow the callers upward until you reach a top-level owner: workspace dispose,
application quit, a request handler, a UI acquire, or a CLI command. At each frame
record what the frame does when the call rejects. Look in particular for:

- a later step in the same sequence that no longer runs;
- a memoized promise (`disposePromise`, `closeReceipt`) that caches the rejection
  and turns a partial teardown into a permanent one;
- a key whose only retry path needs the operation that the fence blocks, which
  is a deadlock in practice;
- a gate that runs on startup, periodic or forced paths as well as on the racy one.

## 4. Test realism and the claimed hazard

Name the concrete trigger: IndexedDB quota or a closed database, SQLite busy, a
network drop during flush or close, an absent local peer, or a timeout. If an
ordinary environmental failure triggers the path, it is not a hypothetical edge
case under the review rules.

Then ask what the strictness actually prevents. Check whether the owner below
already provides that guarantee, for example a reference-counted lease that already
shares one replica. Read the installed library source when the answer depends on
it. If you cannot verify it, report the finding as conditional and say what would
confirm it.

## 5. Proportion pass

- For each new exported Service, Layer or helper, search for consumers outside its
  own module and tests. An export with none is speculative.
- For each new implementation, check whether the one it replaces still exists.
  An old implementation kept only for a type import is dead code.
- In a facade, look for maps or flags that mirror state the native owner already
  holds. Look for two places that decide the same status.
- Compare the size of the change with the
  [migration sizing guide](../../docs/cli-effect-ts.md#small-migrations-during-feature-and-fix-work),
  and name the independent units that could ship separately.

## 6. Report

Rank findings by impact. For each one, give:

1. `file:line` at the head commit;
2. the chain: realistic trigger → propagation through callers → user-visible effect;
3. the base behavior it replaces;
4. the smallest fix that keeps the intended local guarantee, such as continuing
   teardown and reporting afterwards, retrying the retained release on the next
   acquire, or scoping the gate to the racy call with a bounded fallback;
5. whether the finding is verified in the code or conditional on unverified
   library behavior.

Under the GitHub Code Review bar, report only P0/P1. A realistic trigger that now
aborts teardown, permanently blocks a resource or gates unrelated work is P1.
Proportion findings are not P0/P1 on their own; include them only in design
reviews that ask for them.

Do not flag strictness that the base already had, a fence with an automatic
recovery path, a gate scoped to its hazard with a bounded fallback, or complexity
without a concrete failure or maintenance cost.

## Delegation prompt

When dispatching another agent, send this prompt with the placeholders filled in:

```text
Review <PR or branch> in the Lody repository against base <base>. Use the
failure-containment-review skill (.agents/skills/failure-containment-review/SKILL.md)
and the rules in .agents/docs/failure-containment.md.

Look for changes that buy local correctness or predictability with system
stability: cleanup failures that now abort teardown, retained failures that
permanently block a key, new waits or confirmations in front of work that did not
need them, unbounded failure buffers, and compatibility facades that became
stricter than their old callers expected. Then do the proportion pass: exports
with no consumer, superseded code kept alive, and facade state duplicating the
owner.

For every finding, trace from a realistic trigger through every caller to the
user-visible effect, compare it with the base behavior, and propose the smallest
fix that keeps the local guarantee. Cite file:line at the head commit. Mark each
finding as verified or conditional. Do not edit files.
```
