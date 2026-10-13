# Recovering from screens that only a reinstall could fix

Status: implemented
Translation: current
PR: https://github.com/LodyAI/Lody/pull/1531

[中文](2026-10-13-workspace-open-recovery.zh.md)

## Abstract

Some users, mostly on iOS after not opening the app for a long time, stay on
"Switching workspace" on every launch until they reinstall; clearing the cache in the
app does not help. The root cause is not pinned down, and about twenty route screens
could wait forever or fail with no way forward. So the fix is structural: every
blocking route wait becomes a recovery page after 30 seconds, and every route failure
offers a retry and the same page. A terminal local-storage failure gets one
automatic cache clear per day, only online. Clears now restart into a fresh process
on the desktop, verify what they deleted, and stay armed when they leave databases
behind. The full reset uses the host's file-level wipe where one exists, which is what
reinstalling did. The iOS shell implements that wipe, `window.__LODY_NATIVE_RESET__`,
outside this repository. None of this is verified against a real stuck user yet.

## Problem

Reinstalling an app on iOS deletes the WebView's whole data directory, signs the user
out, and works whichever screen they were stuck on. The in-app options could match
none of those three:

- **Not reachable.** The ways out lived in Settings and on the crash screen. A route
  wait (signing in, loading the workspace list, waiting for the active organization,
  opening workspace data) could spin forever without either. Several route failures
  told mobile users to "refresh the page".
- **Not verified.** The boot clear treated a delete error like a success and consumed
  its flag either way. On a storage backend that cannot open a database (which also
  cannot delete it), a clear did nothing and looked as if it ran. On the desktop the
  clear ran after a renderer reload, in the same process whose storage backend had
  failed.
- **Not strong enough.** Every in-app wipe went through web storage APIs. Only the host
  can delete the files.

Two specific dead ends were also found:

- **The workspace data scope.** A rejected first doc-metadata scan
  (`doc_meta_scan_failed`) or a rejected runtime creation stayed stuck for the page
  lifetime. The runtime case even read as an ordinary `runtime_missing` wait.
- **The workspace list.** After five failed attempts (about 10 seconds),
  `useOrganization` stopped retrying for the rest of the page lifetime. A cache clear
  deletes the slug→id map that let the app open a workspace without that list. So
  after a clear, a launch whose first requests failed stayed stuck, which matches
  "clearing the cache does not help".

## Decisions

- **Every route wait has a timeout to recovery.** The three route files render
  `BlockingWaitPlaceholder` with a `gate` naming the wait, instead of a bare
  `LoadingPlaceholder` or `BootShell`. After 30 seconds it shows the recovery page:
  1. reload;
  2. clear the local cache (the same confirmation as Settings);
  3. copy diagnostics: gate, scope blocker, error names, connection, idle gap before
     launch, last automatic and boot clears, build, render trace;
  4. clear all local data and sign out.

  The timeout is a property of waiting, not a diagnosis, so gates added later and
  causes not found yet still get a way out.

- **Every route failure has a way forward.** `RouteMessage` requires `gate`. A failure
  always shows a retry (a reload when the caller has none) and "More ways to recover",
  which opens the same page. `gate: null` marks a message that is not a failure, such
  as the mobile workspace limit, and keeps the old behavior. Making the prop required
  surfaced four more failure screens outside the workspace routes.
- **Make runtime creation failure visible.** `RuntimeProvider` records
  `workspaceRuntimeInitFailureAtom` (`{ workspaceSlug, errorType }`), so the scope
  reports `runtime_init_failed`. `describeErrorType` keeps only the error name,
  reading `name` off any object because a `DOMException` is not an `Error` in every
  engine.
- **One automatic cache clear for a terminal blocker.** On `runtime_init_failed` or
  `doc_meta_scan_failed`, `armAutomaticCacheClear` claims the clear, and the
  placeholder restarts into it. It refuses:
  - in the desktop's hidden warm spare;
  - within 24 hours of the last automatic clear, including after a clock change;
  - offline, because a clear deletes every workspace's offline copy;
  - when the `lody:automaticCacheClearAt` marker cannot be written and read back.

  The marker stays out of the DELETE list so it survives the clear it records.
  Without it, a clear that did not help would restart forever. Nothing else is
  automatic: a wait that never settles gets the page, never a clear, because slow is
  not broken.

- **Restart into clears.** `restartIntoCacheClear` relaunches the desktop through the
  one-shot request file that `lody app reset-cache` already uses
  (`app.relaunchIntoLocalReset`), so the clear runs in a fresh process before any
  window loads. Web and mobile set the boot flag and reload. Settings and the
  recovery page both use it.
- **Verify clears.** The boot clear records each delete's outcome, re-enumerates the
  databases, and also counts failures in the extra databases `RuntimeProvider` passes.
  It writes `lody:lastLocalClear`, which is kept outside the DELETE list and rewritten
  after a hard wipe. A clear that left databases behind stays armed for up to three
  boots, and the recovery page says it was incomplete.
- **Hard reset prefers the host.** After revoking the server session, `startHardReset`
  first tries a file-level wipe from the host:
  - **Desktop:** relaunches into the native `hard` wipe the CLI already applies.
  - **Mobile shell:** calls `window.__LODY_NATIVE_RESET__.resetAllData()`.

  Only when no host wipe exists, or the host refuses, does it fall back to the web
  wipe. This is a stronger version of the same step at the same cost (signed out,
  everything local gone). It is not shown as a separate fourth button.

- **The workspace list keeps trying.** After the retry burst, one more attempt runs on
  `online`, on return to the foreground, and every 30 seconds.
- **Reports name the gate.** `workspace/boot_wait_stuck` is sent when a recovery page
  appears, with the gate, blocker, idle gap and app version. The idle gap tests the
  "long unused" pattern. `workspace/recovery_outcome` is sent after a boot clear:
  `ready` when the workspace opened, `stuck_again` when another recovery page
  appeared. That tells whether a clear is enough or the host wipe is needed.

## Alternatives not taken

- **Fixing each gate separately.** The cause is still unknown, so a per-gate fix would
  leave the next unknown gate stuck. Each gate still reports its name for later fixes.
- **A separate fourth "reset natively" button shown only after the third fails.** The
  host wipe has the same cost as the web wipe and is strictly stronger, so the web
  wipe is kept only as its fallback.
- **Removing the slug→id map from the DELETE list.** That would keep offline-first
  starts after a clear. But the DELETE list is a written rule against stale
  connection state, and a workspace list that keeps retrying removes the need.
- **A scan timeout that clears automatically.** It would wipe healthy caches on slow
  devices, and a blocked open cannot be cleared anyway.
- **Waiting for the storage-crisis breaker (#438).** It explains quota and
  dead-connection failures and asks for a restart. It is still open, and it covers
  neither corrupt data nor non-storage gates.

## Investigated cause: repo storage upgrades

Affected users report the hang after a long absence. Users who last opened the app
before 0.20.3 (2026-09-27) still hold a schema-v3 repo database, so their next launch
runs the v3→v4 IndexedDB upgrade.

An experiment ruled this out under fake-indexeddb:

- **Write:** each shipped loro-repo version (0.19.1, 0.20.0, 0.20.3, 0.21.0–0.21.2,
  0.22.0), with the `loro-crdt` and Flock versions it shipped with, wrote session and
  machine metadata with patches and deletions, plus a document and a Flock document.
  Some databases were closed cleanly and some without a repo shutdown.
- **Read:** 0.22.0 opened each database with the runtime's options and ran the real
  `docMetaSubscriptionAtom` scan.
- **Result:** every database upgraded to v4 and reached a ready scope with the expected
  values, also on a second launch. 3,000 sessions from 0.19.1 opened and scanned in
  about 0.6 s.
- **Negative control:** corrupting the metadata snapshot made `LoroRepo.create` throw
  `Failed to hydrate metadata snapshot`, so the harness does detect an incompatibility.

Limits: WebKit's IndexedDB is not fake-indexeddb, and metadata imported from Streams
was not exercised. A local incompatibility would also be removed by a working cache
clear, which is part of why clear verification and the host wipe matter.

## Verification

- `tests/blocking-wait-placeholder.test.tsx`:
  - automatic clear on both terminal blockers, refused inside the cooldown and
    offline;
  - a workspace wait and a non-workspace wait each time out to recovery exactly at
    the delay;
  - the incomplete-clear notice and the `stuck_again` outcome after a real boot clear;
  - diagnostics content;
  - `RouteMessage` with and without a gate.
- `tests/clear-local-cache.test.ts`:
  - a complete clear;
  - a failing delete stays armed for exactly three boots;
  - a database that survives a reported success counts as a failure;
  - a failed hard wipe keeps its record;
  - the native bridge and the desktop relaunch replace the web wipe, and the web wipe
    is the fallback when the bridge refuses.
- `tests/useOrganization.test.tsx`: after the burst, the list loads when the network
  returns, and on the 30-second retry. Both tests fail with the new effect disabled.
- `tests/runtime-provider.test.tsx` and `tests/workspace-data-scope.test.ts`:
  `runtime_init_failed` is recorded, cleared on the next attempt, and applies only to
  the target slug.
- Recovery pages and `RouteMessage` were checked in Storybook in light, dark and
  zh_CN. Electron's main-process tests and both typechecks pass.
- **Not verified:**
  - a real stuck device;
  - the desktop relaunch path end to end;
  - the iOS host wipe on a real device. The mobile shell implements
    `window.__LODY_NATIVE_RESET__` outside this repository. Older shells without it
    fall back to the web wipe, which cannot delete files the storage backend refuses
    to open.
- **Follow-up:** once the reports name the gates, fix their causes, for example a
  WebKit-specific failure of the v3→v4 upgrade.
