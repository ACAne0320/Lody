# Archive commits before its cleanup

Status: implemented
Translation: current

[中文](2026-10-22-archive-commits-before-cleanup.zh.md)

## Abstract

Archiving a conversation in the desktop renderer used to wait for slow work before
the row disappeared or the view navigated. That work was two pending-input
cancellations, which include joining in-flight owner writes, and then a flush of
every dirty Repo document. Archive now commits its local `isArchived` writes first
and returns. Cancellation runs as an observed tail whose failure cannot undo the
archive. When that tail has joined in-flight creations, it archives any Tab they
created late. Restore takes over the cancellation duty: it finishes the cancellation
before un-archiving, and refuses only while that cannot complete. The local commit
is the optimistic update, so no separate UI overlay or rollback state exists.

## Findings

Each finding was traced through the real call chain. The trigger column names a
realistic event, not a hypothetical one.

| Finding                                      | Evidence                                                                                                                                                                                                                                | Trigger and impact                                                                                                                                   | Scope and recovery                                                                                                                                                                           |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Normal slow path blocked archive             | `cancelWhere` in `session-accepted-inputs.ts` joins `running` drains and waits for the per-session Web Lock. A remote `requestSessionHistoryWrite` has a 30 s deadline and ignores the abort signal (`workspace-machine-rpc-facade.ts`) | An input is in flight to a slow or offline owner, in this window or another. The row stayed visible and navigation waited for up to the RPC deadline | Only the archived conversation was blocked. Before: it recovered when the RPC settled. Now: archive does not wait                                                                            |
| Auxiliary cleanup blocked the business write | `isArchived` was written only after both cancellations resolved. `cancelWhere` does IndexedDB `list`, `patch` and `remove`                                                                                                              | The input-storage IndexedDB is closed or over quota. Archive rejected and nothing was archived, even though archive state lives in the Loro Repo     | Every archive failed while storage failed; the next call recovered once storage did. Now the archive stands, the failure is recorded in `client-log`, and restore completes the cancellation |
| Whole-Repo flush on the archive path         | `repo.flush()` drains every dirty session doc, Flock doc and meta, and loops while new work arrives. It was added with `sendJournal.refresh()` (#1104), which has since been removed                                                    | Another conversation is streaming. Navigation waited for unrelated persistence                                                                       | Removed. Meta persistence already schedules itself on change (`metaDebounceCommitMs: 0`, journal-scheduled flush) and sync subscribes to the meta Flock directly                             |
| Rejections dropped at two entry points       | `void onArchive()` (header and mobile menu) and `void archiveSession()` (mobile swipe)                                                                                                                                                  | Any archive failure, such as metadata still loading                                                                                                  | The user saw nothing and the rejection went unhandled. These entry points now show the toast the sidebar already shows                                                                       |

## Why reordering is safe

- **Held sends.** `cancelSessions` aborts this window's held work and marks it
  canceled synchronously, before the archive writes. The held layer re-checks
  the abort before writing (`session-pending-sends.ts`).
- **Durable Roost inputs.** `validateTarget` refuses an archived target before
  every owner write, lookup and delivery. This covers inputs from other windows too.
- **Activation.** `activateUserTurn` skips archived sessions. The CLI dispatch
  watcher no-ops on archived meta (`session-dispatch-logic.ts`).
- **Remaining case.** A write already past its last abort check can still commit,
  exactly as with the old join-first order. Only its timing relative to the archive
  flag changes, and an archived session never starts work.
- **Late Tabs.** The old order scanned targets after the join, so a Tab whose
  creation committed during the join was included. The tail now restores that
  outcome. After the join it re-reads targets and archives Tabs absent from the
  original scan, but only while the root is still archived, so a restore in
  between is respected.

A new conversation joins its cancellation only while its metadata is still
unwritten, because then the in-flight write decides whether there is anything to
archive. Once the metadata exists, its first owner write (up to the 30 s RPC
deadline) is the ordinary tail. Archive no longer waits for it.

## Cleanup responsibility

A failed tail leaves stored input without its `canceled` mark. This window still
skips it, because the in-memory `canceled` set covers it. But after a reload, or
in another window, `resume` delivers it once the session is no longer archived.
Un-archiving is therefore the only step that can make leftover input deliverable.
`restoreSession` runs `cancelSessions` for its targets before clearing
`isArchived`. If storage is still failing, restore rejects with the original error
and nothing changes; the next restore after recovery succeeds. This gate covers
restore only. Archive, sending and unrelated sessions do not wait on it. Its cost
on the ordinary path is one input-storage read, because a completed archive leaves
nothing to cancel. A tail aborted by workspace teardown is logged at `info`, so
bug reports do not show it as a failure.

## Verification

`tests/use-session-actions.test.ts` covers the real held-send queue:

- archive resolves while an upload that ignores abort is still being joined;
- a Tab whose creation commits after the scan is archived by the tail;
- a new conversation whose metadata exists archives while its first write is
  blocked, and the landed turn is never activated;
- a stalled `flush` plus a rejecting cancellation still leave the archive in
  place; restore refuses while the cancellation fails, keeps the session
  archived, and after the fault clears drops the surviving input before
  un-archiving.

Each new assertion fails without its change. Not verified: an Electron run measuring the latency
on a real streaming workspace.
