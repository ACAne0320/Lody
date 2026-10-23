# Fork provenance mark instead of a "(fork)" title prefix

Status: implemented
Translation: current

[中文](2026-10-23-fork-provenance-mark.zh.md)

## Abstract

Forked conversations were titled `(fork) <source title>`, so forking a fork
stacked prefixes (`(fork) (fork) …`) and the title said nothing about which
conversation it came from. A fork now keeps the source's plain title and records
`SessionMeta.forkedFromSessionId`; sidebar rows and conversation tabs render a
small fork icon before the title. On desktop, hovering the icon names the source
conversation and clicking it opens the source. Existing titles are not rewritten.
Only a fork of a fork drops the legacy prefixes.

## Decisions

- **New field, not `parentSessionId`.** `parentSessionId` exists only for
  in-place/child-tab forks and drives tab grouping and roll-up. New-session and
  worktree forks need provenance without either effect, so
  `forkedFromSessionId` is presentation-only. It follows the same rule as
  `openedBySessionId`: never rolled up, never used to filter the list.
- **Daemon owns the title.** `SessionForkService` uses
  `stripLegacyForkTitlePrefix(sourceTitle)`, which removes any number of leading
  case-insensitive `(fork)` prefixes. If nothing would be left, the original title
  is kept. The fork operation marker stores `sourceSessionId`, so crash-recovery
  meta republication also restores the field.
- **Live source title.** `SessionForkMark` reads the source's `SessionMeta`
  through `sessionMetaAtomFamily`, so renames show up and the generic "Forked
  conversation" label is used when the source is missing or deleted. A child-tab
  source navigates through its root session plus the exact tab id.
- **Surfaces.** The desktop sidebar (`SessionList` and the updated-sessions list)
  uses an interactive mark. Touch layouts get a decorative icon, because hover
  tooltips do not exist there and the row is the tap target. In the session tab
  bar, the mark selects the source tab when the source is in the same tab group.
  Otherwise it only shows the tooltip.

## Alternatives

- Keeping a single `(fork)` prefix while de-duplicating repeats: rejected because
  it still bakes UI into durable data and hides the source.
- Deriving provenance from the cloned `session_fork_origin` history notice:
  rejected because sidebar rows only have `SessionMeta` and should not load
  histories.

## Verification and limits

CLI unit tests cover prefix stripping, the new meta field on fork commit and the
marker repair path. A jsdom component test covers the tooltip label, root+tab
navigation, the click not selecting the row, the deleted-source fallback and the
decorative mode. A `SessionList` story (`ForkedSessions`) shows the states.
Native mobile and Electron rendering were not checked by hand. Forks created by
older daemons keep their `(fork)` titles and have no mark.
