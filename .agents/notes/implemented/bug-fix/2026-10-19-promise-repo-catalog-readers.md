# Keep daemon catalog readers on the published Promise Repo API

Status: implemented
Translation: current
PR: [#1715](https://github.com/LodyAI/Lody/pull/1715)

[中文](2026-10-19-promise-repo-catalog-readers.zh.md)

## Abstract

After #1713 restored product consumers to the published Promise Repo API, the later daemon catalog reader still called the withdrawn native workspace facade. Those stale calls broke CLI typecheck and its new integration tests. The reader now holds public Repo room subscriptions, bounds each request's first-baseline wait without cancelling daemon ownership, and leaves reconnect and final release to the existing Repo manager lifecycle.

## Cause

The catalog reader added by #1692 used `repo.native.acquireRoom`, `runLegacy` and a test-only `WorkspaceRepoLegacy` path. #1713 had already withdrawn those consumer APIs and removed the native facade while retaining Repo 0.23.2. The result was an incompatible product consumer and tests that imported an unpublished Shared subpath.

## Ownership

`workspace-catalog-sync.ts` now holds `LoroRepo.joinFlockDocRoom()` subscriptions for the daemon workspace catalog and queried Machine catalogs. The Repo subscription remains valid through transport detach and reattachment; each discovery request only races the existing first-sync promise against its own timeout. Retryable room-acquisition failures use capped backoff. Closing the catalog reader aborts pending acquisition, unsubscribes held rooms, and runs before Repo shutdown. Role proposal validation continues to use the separate strict `syncFlockDocOrThrow` path.

This follows the rollback decision in [#1713](../simplification/2026-10-19-repo-upgrade-without-consumer-migration.md). It supersedes the native catalog-reader lifecycle and native-only tests described in the earlier [daemon workspace commands note](../architecture/2026-10-16-daemon-hosted-mcp-workspace-commands.md); that note preserves the original implementation history.

## Verification

- The focused `workspace-catalog-sync.test.ts` suite passes locally against the installed Promise Repo API.
- The CLI worktree's linked dependencies point to a sibling checkout and are stale relative to this lockfile. The daemon integration suite and complete CLI typecheck therefore require fresh CI validation; the previous CI run exposed the exact missing API and export errors described above.
