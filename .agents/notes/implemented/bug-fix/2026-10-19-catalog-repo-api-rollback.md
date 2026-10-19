# Restore catalog compatibility with the installed Repo

Status: implemented
Type: bug-fix
Translation: current
PR: [#1728](https://github.com/LodyAI/Lody/pull/1728)

[中文](2026-10-19-catalog-repo-api-rollback.zh.md)

## Abstract

The daemon catalog change in #1692 called native-runtime bridge methods that the
installed Promise `LoroRepo` in `loro-repo@0.23.2` does not expose. This prevents CLI
and desktop compilation. Revert #1692 on the current main branch, retaining #1679's
session GC fix and the confirmed release notes. Catalog discovery returns to its
previous explicit synchronization behavior, including its network-dependent reads.

## Decision and limits

The rollback removes the incompatible background reader owner and restores the
pre-#1692 discovery implementation and tests. It does not undo daemon-hosted MCP
routing introduced before #1692, change schemas, upgrade dependencies, or remove
the session activity guards from #1679. No second Repo is created.

Rewriting the reader owner against the public Promise room APIs is a separate
lifecycle change. A caller's wait must not own or cancel the daemon reader;
metadata, workspace and authorized Machine catalog baseline handling must all be
verified before restoring cache-only discovery. A direct native Repo replacement
would not share the Promise Repo's replicas. This rollback deliberately defers
those changes so the release can compile against its locked dependency.

The bilingual public changelog only changes its version from 0.107.0 to 0.107.1;
its confirmed feature, fix and contributor text stays unchanged. Version 0.107.1
remains subject to the workflow-generated Release Please output.

## Evidence

The published `loro-repo@0.23.2` declaration exports Promise methods such as
`joinMetaRoom`, `joinFlockDocRoom` and `destroy`, but no `runLegacy`,
`acquireScopeLegacy` or `native`. #1692 also referenced an unimported `Scope`.
The owning source boundary is `apps/cli/src/lib/loro/doc.ts`.

Executed validation and its limits are recorded in the PR. This note establishes
neither deployment nor recovery on any user's running daemon.
