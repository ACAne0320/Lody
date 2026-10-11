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
Chromium layout checks verify these paths; native iOS momentum remains unverified.

## Diagnosis and decision

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

The browser regression in `tests/e2e/conversation-scroll-engine.spec.ts` executes the
production measurement helper with actual flex layout, wrapping and mixed Chinese/
English text. It passes in Chromium. With a 240px composer, the old live `auto` reset
expanded the conversation viewport from 480px to 696px and lost 136px of a reading
offset 80px above the bottom; restoring the textarea height did not restore that
offset. Mirror measurement returns the same content height while leaving both the
viewport height and reading offset unchanged.

Strict TypeScript compilation of the controller, simulator and measurement helper
passes. The full composer React suite could not collect because the ACP core
submodule/dependency is unavailable, and package typechecking cannot run without
`tsgo`. Existing local dependencies were linked temporarily for focused validation;
manifests and the lockfile are unchanged. Documentation checks retain the 82 baseline
errors from unavailable submodules and existing documents; no protected topics are
registered.

WebKit's local browser executable is absent, so these checks do not establish native
iOS fling behavior. Device acceptance still requires a fast downward fling, bottom
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

PR: not opened.
