# Bound created-session cards in the conversation

Status: implemented
Translation: current

[中文](2026-10-11-created-session-list.zh.md)

## Abstract

Many MCP session creations filled the conversation with navigation cards. Consecutive
pure creation records now share a Subagent Task-style panel with ruled compact rows,
leading status marks, and a header containing the count and expand/collapse control.
Its scrollable viewport shows at most five rows by default. Both batch and separate
creation calls use the same presentation; live titles, statuses and navigation remain
available. Grouping stops at other messages or unhydrated turns, preserving their order.

## Decision and boundaries

The user requested the existing Subagent Task UI. Reuse its panel, separators and
status-mark styles while keeping navigation controls in `@lody/ui`. State belongs
to the creating Operation; clicking a row still opens the child Session. The header
disclosure controls the five-row cap, rather than adopting the task panel's automatic
fold-on-completion behavior. Repeated creation labels and individual card outlines
are removed.

The render layer groups records; stored history and Operation protocols are unchanged.
The first record supplies the stable row key, and the full turn range remains leased
through visible-range reporting. Existing activity folding still uses sibling rows;
only the requested creation-card list has an internal scroller. Five or fewer cards
have no disclosure. The scroll region is keyboard focusable and opts out of drawer drag.

Limiting each Operation alone would leave repeated single-create calls unbounded.
Pure successful legacy completions join groups too; failures, cancellations and
continuation notices keep their summary outside the list. A progress-linked completion
still cannot duplicate cards. This supplements the existing
[creation progress implementation](../../../../packages/components/src/components/ai-gui/README.md#creation-progress)
and preserves the [scroll engine's ownership](../architecture/2026-09-27-conversation-scroll-engine.md).

## Verification

The relation-card suite covers grouping, turn range, threshold, disclosure and navigation,
alongside existing live status and duplicate-completion coverage. Storybook's
`ManyCreatedSessions` uses twelve synthetic independent creation records for browser
checks and screenshots. Chromium at 375px and 1280px widths verified a 144px viewport with five
visible cards, internal wheel scrolling, and both disclosure states.
[Collapsed](../../assets/created-session-list/collapsed.png) / [expanded](../../assets/created-session-list/expanded.png).
Message-selection mode preserves original rows so selected ids still match exported records.
Native iOS WebView behavior requires device verification.

Targeted tests (24), component typecheck, lint, i18n, boundary checks, formatting
and docs check passed. Root `pnpm check` passed typecheck/lint but stopped on two
unmodified CLI tests: macOS `/var` versus `/private/var` in worktree inspection,
and the native Git fixture's `context_unreadable`; both reproduced separately.
