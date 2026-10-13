# Recovering a workspace that never opens

Status: implemented
Translation: current

[中文](2026-10-13-workspace-open-recovery.zh.md)

## Abstract

Some users open Lody and stay on "Switching workspace" on every launch until they
reinstall, because a damaged local copy of the workspace makes the runtime or its first
metadata scan reject, and nothing retried either one. The only working fix, Settings →
Clear local cache, cannot be reached from that screen. The placeholder now names those
two failures as terminal. On either one it clears the local cache once and reloads,
which the existing boot-time clear can do safely. If that does not help, or the wait
just runs long, it offers clear-cache, reload, copyable diagnostics and the full reset
on the screen itself. The automatic clear is limited to once per 24 hours and only
runs online. A scan that hangs instead of failing gets the manual page, not an
automatic clear. That case is not verified against real stuck users yet.

## Problem

`resolveWorkspaceDataScope` holds the content pane on the "Switching workspace"
placeholder until runtime, route and doc-metadata ownership agree. The
[stuck-sync telemetry](../feature/2026-09-26-workspace-sync-stuck-telemetry.md)
already named the blocker but deliberately changed no behavior. Two paths were dead
ends that survive restart, because the state that causes them persists in Chromium
storage:

- **The first doc-metadata scan rejects** (`doc_meta_scan_failed`). This happens when
  the repo IndexedDB is corrupt, over quota, or its connection is dying. The scope keeps
  `scanFailure`, and nothing rescans until the runtime is replaced.
- **Creating the runtime rejects.** `LoroRepo.create` opens and reads the repo IndexedDB
  before anything renders. `RuntimeProvider` only logged the error, set the runtime to
  null and the control connection to `error`. The scope then read `runtime_missing`,
  which looks the same as an ordinary wait.

The cache clear removes exactly the poisoned state: every `lody*` database, the
slug→id map, the Streams tokens and the cursor-bypass markers. But the user could
only find it in Settings or with the CLI, so reinstalling became the obvious fix.

## Decisions

- **Make runtime creation failure visible.** `RuntimeProvider` records
  `workspaceRuntimeInitFailureAtom` (`{ workspaceSlug, errorType }`) when creation
  rejects, and clears it at the start of every attempt. The scope reports
  `runtime_init_failed` when the failure belongs to the target slug, so the stuck-sync
  report counts it apart from an ordinary wait. Like the scan failure, it keeps only
  the error name. `describeErrorType` reads `name` off any object because a
  `DOMException` is not an `Error` in every engine.
- **One automatic cache clear for a terminal blocker.** On `runtime_init_failed` or
  `doc_meta_scan_failed`, the placeholder calls `armAutomaticCacheClear` and reloads.
  That function arms the existing boot flag, so the delete still runs at boot, before
  the runtime reopens the databases. It refuses:
  - in the hidden warm spare, whose boot does not consume the flag;
  - within 24 hours of the last automatic clear, including when the clock moved
    backwards;
  - whenever the `lody:automaticCacheClearAt` marker cannot be written and read back.

  The marker is deliberately not in the cache-clear DELETE list, so it survives the
  clear it records. Without it, a clear that does not fix the problem would reload
  forever.

- **Never automatically while offline.** A clear deletes every workspace's offline
  copy, and offline none of them can download again. The manual actions still show.
- **The ways out are on the placeholder.** After a terminal blocker the automatic clear
  is declined. After any wait of 20 seconds the placeholder becomes a status page with:
  - "Clear local cache and retry", the same confirmation dialog as Settings;
  - "Reload Lody";
  - "Copy diagnostics" and a technical details block: blocker, error names, workspace,
    wait time, connection states, the last automatic clear, build context, and the
    session render trace;
  - the existing hard-reset dialog as a quiet footnote link.

  Both the authenticated content placeholder and the no-token boot placeholder in
  `$workspaceName/_auth.tsx` use it.

- **A hang is shown, not cleared.** A scan or runtime that never settles only gets the
  manual page. Clearing cannot unblock a database another window holds open, and a slow
  machine with a large workspace is not broken.

## Alternatives not taken

- **Retrying the scan or runtime in place.** It does not help: the failures that reach
  here are persisted damage or a dying connection that a reload does not repair. It
  would also add the retry storm the telemetry note warned about.
- **A scan timeout that clears automatically.** The issue suggested it. It would wipe
  healthy caches on slow devices, and a blocked open cannot be cleared anyway. The
  20-second manual offer covers this case.
- **Waiting for the storage-crisis breaker (#438).** That PR classifies quota and
  dead-connection failures and asks for an app restart. It is still open, and it does
  not cover corrupt data or scan failures. This change does not depend on it. Once it
  lands, its crisis screen covers its own failures, which are raised above this
  placeholder.

## Verification

- `tests/workspace-open-placeholder.test.tsx`:
  - a failed scan or runtime arms the clear, reloads, and reports
    `workspace/auto_cache_clear`;
  - a second failure inside the cooldown shows the manual page and arms nothing;
  - nothing is armed while offline;
  - a pending scan turns into the slow page exactly at the delay, without clearing;
  - the diagnostics carry the blocker, the error and the last automatic clear.
- `tests/clear-local-cache.test.ts`: the cooldown, survival of the marker through the
  boot clear, a backwards clock, and an unwritable marker.
- `tests/runtime-provider.test.tsx`: a rejected creation is recorded and cleared by the
  next attempt. `tests/workspace-data-scope.test.ts`: `runtime_init_failed` applies only
  to the target slug.
- Not verified: a real poisoned or quota-filled profile in Electron. In production, the
  `workspace/sync_stuck` blocker counts and `workspace/auto_cache_clear` events will
  show whether one automatic clear is enough.
- Known limit: a dying IndexedDB connection is bound to the renderer process, so a
  reload may not repair it, and nothing here restarts the app. Such a user still lands
  on the manual page and needs a restart, which #438 is meant to explain.
- Follow-ups: per-blocker escapes for `workspace_not_in_organizations`, and Phase 2 of
  #417.
