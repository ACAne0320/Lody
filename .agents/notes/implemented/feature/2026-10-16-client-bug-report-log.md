# Keep a client log and send it with machine bug reports

Status: implemented
Translation: current

[中文](2026-10-16-client-bug-report-log.zh.md)

## Abstract

Bug reports carried the machine daemon's logs but nothing from the app the user
was looking at, and the renderer's own diagnostics lived in memory, so they
were gone by the time an iOS user, whose WebView had just been killed and
reloaded, opened the report dialog. The renderer now keeps a log of important
events in IndexedDB, bounded to the newest 2 MiB within 48 hours. It covers
crashes caught by error boundaries, boot failures, failures nothing retries,
stuck boot waits, reloads, and a previous page that ended without unloading.
A machine-backed bug report sends it gzipped to the daemon, which uploads it as
a `client.log` section of the same `logContent`, so one report holds both
logs. A description-only report still sends no logs, because the hosted
endpoint's contract for that path is not visible in this repository.

## Problem

`machine/bug-report` asked the selected machine to upload its own logs.
The renderer contributed only build constants. What it did know lived in
memory (the session render trace, boot request failures), so it disappeared
with the event that mattered most: a WebView the OS killed and reloaded, or a
renderer crash that the user then reloaded away.

## Decision

**Recording (`lib/client-log.ts`).** An explicit API, `recordClientLog` and
`recordClientError`, rather than intercepting `console`, so only events a
caller chose are kept. Every string passes through `redactClientLogText`, which
strips bearer tokens, JWTs and token-like query parameters. One entry, stack
included, is capped at 16 KiB.

| Event                                         | Source                                                                        |
| --------------------------------------------- | ----------------------------------------------------------------------------- |
| `react.error_boundary`                        | every `ErrorBoundary` catch, with boundary name and component stack           |
| `boot.failed`, `boot.failure_reload_clicked`  | the pre-React boot failure page                                               |
| `runtime.operation_failed`                    | `RuntimeProvider` failures outside shutdown                                   |
| `boot.wait_stuck`                             | a `BlockingWaitPlaceholder` reaching its recovery page, with gate and blocker |
| `cache.clear_on_boot`, `app.reload_requested` | clears run at boot, and reloads the app asks for                              |
| `window.error`, `window.unhandled_rejection`  | uncaught errors                                                               |
| `page.boot`, `page.visibility`, `page.hide`   | the lifecycle around them, with navigation type and build                     |
| `page.previous_ended_without_unload`          | a previous page that never reached `pagehide`                                 |

The last row is how an automatic restart shows up. Nothing runs when a WebContent
process is killed, so each page keeps a boot marker in `localStorage`. The
marker is updated synchronously on visibility changes and `pagehide`. The next
boot reports a marker that never ended, with its last visibility and the time of
that change.

**Storage.** Entries are written in batches (an error is written at once, and
the page flushes when hidden), to the `lody-client-log` database. A cache clear
keeps the log, because it explains why the clear was needed; a full reset
deletes it. Without IndexedDB the log is kept in memory under the same limits.

**Sending.** The bug report dialog builds the upload: the newest lines that fit
2 MiB raw and 1 MiB gzipped, base64 encoded. The 1 MiB compressed bound matches
the Code Collab and file-preview payloads that already cross the Loro Streams
request path. The `machine/bug-report` request schema is strict, so an older
daemon would reject the whole report if the field were present. The client log
is therefore gated on the new `bugReportClientLog` machine protocol capability.
The workspace RPC facade drops the field for a machine that does not advertise
it, and the report is still filed. The daemon decodes the log and appends it
after its own logs. If the log does not decode, the section says why instead of
failing the report.

## Alternatives

- **Capture all `console` output.** It would keep agent text, paths and URLs that
  callers never chose to keep.
- **Upload the client log directly from the renderer under the same report id.**
  It would need a new hosted endpoint and would split one report into two uploads.
- **Put the log in the description.** Descriptions are user-authored text and
  are shown as written, and their size limits are not known here.

## Limits

- **Description-only reports:** a report filed without an online machine still
  carries no client log. Sending `logContent` on that path needs the hosted
  endpoint to accept it.
- **Plaintext in the request stream:** the client log rides in the request
  parameters in plaintext, as the description already does, so it is retained in
  the workspace request stream until expiry. Encrypting it to the target machine,
  as authentication input is, would remove that.
- **Last seconds before a kill:** entries written in the last second before a
  process is killed can be lost. The boot marker survives because it is
  synchronous.

## Verification

- `tests/client-log.test.tsx` covers:
  - persistence across a simulated reload;
  - detection of a page that ended without `pagehide`;
  - uncaught errors and rejections;
  - the age and byte limits;
  - redaction;
  - an upload that decodes back to the log;
  - an `ErrorBoundary` catch recorded with its component stack.
- `tests/workspace-machine-rpc-facade.test.ts` checks that the log reaches a
  daemon that advertises it, and that a report to an older daemon is still filed
  without it. The check fails when the gate is removed.
- `packages/loro-streams-rpc` server test: the field reaches the daemon handler.
- `apps/cli` `bug-report.test.ts`: the uploaded `logContent` contains the
  `client.log` section, and an undecodable log is reported in place.
