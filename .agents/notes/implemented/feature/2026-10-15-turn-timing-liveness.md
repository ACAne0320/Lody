# Turn timing and liveness in the conversation

Status: implemented
Translation: current
Date: 2026-10-15
Language: English
Other language: [中文](2026-10-15-turn-timing-liveness.zh.md)

## Abstract

A running assistant turn showed how long it had worked, but not whether anything
was still arriving. Users could not tell a long command run from a stuck turn.
The turn-configuration popover now shows when the turn started, how long it has
run or took, and, for the live turn, how long ago the conversation last received
a history update. That age turns into a weak warning after 60 seconds. The live
status line adds "no output for N m" after two minutes of silence. The update
time is an in-memory stamp on the renderer's `ConversationView`. History, its
schema, the sync protocol and the `endedAt` rule are unchanged. As a result, the
age covers only updates received since the conversation was opened.

## Request

PR: [#1589](https://github.com/LodyAI/Lody/pull/1589).


A community user (Discord thread "More Detailed Turn Information") wanted to
check a turn that seemed to be running a `local_bash` lint gate. They needed its
start time and the time of its last history update to judge whether it was busy
or stuck.

## Decision

- **Start, end and duration come from existing fields.** The start is
  `startedAt` when it is recorded, otherwise `timestamp`; older entries carry
  only `timestamp`. The running time and the finished duration reuse
  `resolveLiveSessionHistoryDurationMs` and `resolveSessionHistoryDurationMs`.
  Both are the "Worked for" measure, so the popover and the status line cannot
  disagree. Instants use the user's local time zone. Today's instants show the
  time with seconds; other days add the date, and other years add the year. The
  hover text is the full date and time, including the time zone.
- **"Last update" is a renderer stamp, not stored data.** `endedAt` is written
  once at finalization and must stay that way (#260): moving it while a turn
  streams would change finished-turn semantics. Persisting a separate timestamp
  would add one document write for every streamed delta. Instead,
  `ConversationView.lastUpdateAt` records the time of each backend history
  notification. Loro and Roost share this one reader path, so both backends are
  covered without another subscription. Opening, hydration and paging do not
  move the stamp. It does not bump `version` either, because consumers read it
  on their own clock tick.
- **Session granularity, shown only for the live turn.** The newest unfinished
  assistant turn is the only one with a meaningful "last update". Finished turns
  show Started, Ended and Duration instead. Before any update arrives after
  opening, the value is `—`, never `0s` or a guessed time.
- **Thresholds are constants.** `TURN_LAST_UPDATE_STALE_MS` (60 seconds) colors
  the popover value with the warning tone. Its tooltip says the agent may be
  running a long command or may be stuck. `TURN_SILENCE_NOTICE_MS` (2 minutes)
  adds "no output for N m" to the live status line, in whole minutes so it does
  not change every second. The status line only reports the silence and adds no
  warning tone, because a long command can legitimately stay silent.

## Alternatives considered

- **Refresh `endedAt` while streaming.** Rejected: it breaks the finalize-once
  rule and the meaning that `canAppendAssistantDeltas` and "Worked for" rely on.
- **Write a `lastUpdateAt` field into history.** Rejected: it means a CRDT write
  for every delta, plus a schema change. It would also measure the writer's
  activity, not what this client received.
- **Track updates per turn.** Rejected as unnecessary. Only the live turn shows
  the value, and per-turn state would grow with history.

## Limits

- Catch-up sync that lands just after opening counts as an update. A turn that
  stalled before the conversation was opened can therefore look fresh for up to
  a minute before the warning appears.
- Local writes, such as answering a permission or sending a steer message, also
  move the stamp. The backend change notification does not carry its origin.
- A turn that waited on permission still shows a high live duration until
  finalization. This gap belongs to the live-duration label: see
  [desktop live turn duration](2026-09-17-desktop-live-turn-duration.md).

## Verification

`packages/components/tests/assistant-turn-timing.test.ts` covers the row facts
for live, finished and missing-field turns. It also covers the `startedAt`
fallback, the silence threshold, and clock formatting across local midnight and
years with a fixed time zone. `tests/conversation-view-from-reader.test.ts`
checks the stamp against real Loro storage: it stays `null` through opening and
range hydration, and only a history write moves it.
`tests/agent-activity-row.test.tsx` renders the real stream. It covers the
"no output for 4m" status, the live popover before and after the warning
threshold, `—` before any update, and the finished popover.
`AssistantTurnAlignment.stories.tsx` provides `DesktopTurnTimingLive` and
`DesktopTurnTimingFinished` for visual review. Neither a real stalled daemon nor
a real network loss was reproduced.
