# Mobile conversation bottom ownership

Status: implemented
Translation: current

[中文](2026-10-11-mobile-conversation-bottom-ownership.zh.md)

## Abstract

Fast downward scrolling could compete with repeated engine writes to the bottom,
and composer layout changes could restore following without a conversation gesture.
The controller now samples elastic offsets within the real scroll range and only
re-arms following from conversation input; near-edge corrections wait for native
scroll completion. Composer content is measured outside its live flex layout, avoiding
a transient viewport expansion that loses the reading offset. Model, adapter and
Chromium and WebKit layout checks verify these paths; native iOS momentum remains
unverified.

## Diagnosis and decision

This implements the controller and composer repair from the
[original analysis](../../proposed/bug-fix/2026-10-11-mobile-conversation-bottom-ownership.md),
retaining its native-device acceptance boundary.

This partially replaces the immediate 4px re-arm and input-reset behavior described
in the [scroll-engine decision](../architecture/2026-09-27-conversation-scroll-engine.md#touch-input-and-delayed-scroll-delivery-2026-10-07),
while preserving its anchor ownership, bounded transactions and relative layout
compensation. It implements the existing [conversation intent](../../../../specs/conversation-scroll.md):
layout changes alone do not request following.

- `onScrollEvent` previously re-armed from offset/direction alone. Entering follow
  also cleared momentum, so native movement arriving afterward became unknown and
  was corrected to the bottom. Elastic offsets above the maximum caused additional
  resets, including after parent commits.
- The controller now uses bounded logical offsets for classification, anchors,
  coverage, read-back and settled checks. A rebound outside the valid range cannot
  release following or trigger a corrective write just because it is out of range.
  Layout changes still use the existing compensation protocol.
- Wheel and navigation-key listeners supply input evidence in both directions,
  excluding editable targets, nested scrolling and wheel zoom. Touch momentum and
  held pointers retain their existing classification. Exact-edge arrival restores
  following without clearing native evidence or adding a correction. The 4px
  near-edge case and remembered stale bottoms re-arm on `scrollend`.
- Unknown movement and clamps discard remembered gesture bottoms. Scroll events
  sample the current viewport height before classifying a browser clamp, since
  scroll steps precede ResizeObserver delivery. Outside focus, pointer input and
  `beforeinput` cancel old evidence; typing works even when the composer already has
  focus. Explicit navigation and hiding also discard previous input evidence.
- `ChatComposer` measures a temporary hidden fixed textarea with resolved text/box
  metrics, removes it immediately, and applies the final live height once. Empty
  drafts retain the measurement-free minimum-height path.

## Evidence and limits

The owning model suite covers elastic samples, repeated commits during rebound,
input surviving exact-edge arrival, no near-edge writes before scroll completion,
unknown movement, an active gesture ending in a viewport clamp, and stale-bottom
recovery. The adapter suite dispatches wheel/key/touch events and composer focus,
pointer and editing events. Both include their prior behavioral coverage and the
model's 40 seeded sequences: 103 tests pass.

Before/after verification uses the actual pre-fix production code at `4922c038c`
and the PR code at `4601077e2`, with the same current behavioral test fixtures in
an isolated clone. Of 12 targeted model, adapter and composer cases, 11 fail before
the fix and all 12 pass afterward. The remaining viewport-clamp case already
passed before the fix. Tests requiring the new `onReaderInput` API are excluded
from this comparison; missing-method failures are not evidence of the original bug.
The complete three-suite run on the fixed version passes all 104 tests.
After merging `main` at `a8e1cf548`, those suites and the updated conversation
backend suite pass together (109 tests); the composer browser regression also
passes again in Chromium and WebKit. The merge does not change the scroll
controller, its adapter, the composer or its measurement helper.

| Identical scenario | Before | After |
| --- | --- | --- |
| Elastic samples of +24, +18, +12 and +6px, including parent commits | Four corrective writes | Zero corrective writes |
| Native movement stops 3px short, before `scrollend` | Immediately follows and writes the bottom | Remains reading, no write; follows at `scrollend` |
| No conversation input, browser moves near the bottom, viewport shrinks 40px | Restores follow and moves another 40px | Remains reading, no additional movement |
| Active gesture, transient viewport clamp, original height restored | Reading offset loses 40px | Original reading offset preserved |
| Composer focus, editing with existing focus, or outside pointer input | Restores follow from stale evidence | Remains reading; appended output does not move it |
| React composer measurement | Live height becomes `auto` while measuring | Live height remains at its previous value |

To reproduce the targeted comparison, in a disposable clone with locked dependencies,
check out `4922c038c` and overlay only the three test files under `packages/components/`
from `4601077e2` using `git show 4601077e2:<path> > <path>`.
Do not replace production sources. Run:

```sh
NODE_ENV=test pnpm --filter @lody/components exec vitest run \
  tests/conversation-scroll-engine.test.ts \
  tests/engine-conversation-scroller.test.tsx \
  tests/chat-composer-autoresize.test.tsx \
  -t 'keeps the reading anchor when a viewport clamp|waits for the native fling|ignores elastic|never follows after|downward .* input re-arms|composer .* clears|grows through 11 rows'
```

Restore those test overlays, check out `4601077e2`, and run the same command for
the fixed comparison; omit `-t` to run all 104 related tests.

The browser regression in `tests/e2e/conversation-scroll-engine.spec.ts` executes the
production measurement helper with actual flex layout, wrapping and mixed Chinese/
English text. The owning regression passes in both Chromium and WebKit (two browser
tests). Additional layout experiments in Chromium 145 and WebKit 26.0 confirm the
restored live height still cannot recover the old offset. With a 240px composer,
the old live `auto` reset expanded the conversation viewport from 480px to 696px and lost 136px of a reading
offset 80px above the bottom; restoring the textarea height did not restore that
offset. Mirror measurement returns the same content height while leaving both the
viewport height and reading offset unchanged.

Strict TypeScript compilation of the controller, simulator and measurement helper
passes. With locked dependencies in an isolated public clone, the composer React
suite and both scroll suites pass together: 104 tests. The exact failing CI command,
`NODE_ENV=test pnpm --filter @lody/components run test --maxWorkers=4 --shard=3/3`,
also passes all 185 files and 1,755 tests in that clone. The measurement invariant
snapshots the actual initial live height, including padding: assuming 48px falsely
failed against the real 52px box in CI. It still checks that growth and shrink
measurements leave the live height unchanged. Repository formatting, typechecking
and linting pass. Full `pnpm check` then stops on unrelated CLI process, simulator,
Git and history test failures on this host; that CLI job passed in the inspected
GitHub run. After merging main, the six previously failing CLI files pass 55 of
56 tests with a neutral isolated temporary directory, system Git and no inherited
`GIT_EXEC_PATH`. The remaining signed-prefix restore/fencing test still times out
at 30 seconds, including when run alone. Earlier process fixtures inherited
`/tmp/package.json`'s ESM mode, while the Git fixture inherited the host transport
wrapper. Neither assertions nor timeouts were changed. Merged CLI sources and
dependency manifests match main, so these observations do not establish a scroll
regression or a fully passing local check.
The full merged check passes typechecking and linting, then stops after 4,002 CLI
tests pass and those two Roost/host-Git cases fail. Formatting, i18n, Code Collab
imports, platform, process and public-boundary guards pass separately.
The scroll repair makes no manifest or lockfile changes; main's SDK update is
retained by the merge. Documentation checks in the original
worktree retain the 82 baseline errors from unavailable submodules and existing
documents; no protected topics are registered.

WebKit verification uses the repository-locked Playwright build on Linux, with a
390×844 touch-capable mobile viewport for the layout experiment. Elastic controller
samples are injected by the model, not produced by a real iOS fling. These checks
do not establish native iOS animation, keyboard or gesture behavior.
Device acceptance still requires a fast downward fling, bottom
rebound, upward interruption, and typing with both a newly focused and already
focused composer. Streaming while reading and keyboard show/hide must preserve the
reading anchor; following must still track new output and final viewport changes.

## Trade-offs

There is no timer or frame retry. Hosts without native `scrollend` can re-arm at the
exact bottom or through explicit navigation, but near-edge/stale-bottom recovery
needs the native signal. Removing elastic samples by disabling overscroll was not
chosen: bounded sampling addresses engine ownership without changing native gesture
presentation. Layout compensation during real row growth retains its documented
potential to interrupt WebKit momentum; this fix does not remove that separate cost.

PR: [#1445](https://github.com/LodyAI/Lody/pull/1445).
