# Adopt released Streams and Repo dependencies

Status: implemented
Translation: current

[中文](2026-10-16-streams-repo-release-adoption.zh.md)

## Abstract

Lody needs the published native Repo and durable upload contracts before migrating
WorkspaceData ownership. The shared catalog now consumes Client 0.12.0, CRDT 0.19.0
and Repo 0.23.0, retaining Effect 4.0.2 and existing product ownership. Exact
release-age exceptions were explicitly approved for these controlled packages;
the default seven-day quarantine remains. Existing real-SDK consumer suites pass
on the installed graph, while product durable consumers still use Promise APIs.

## Dependency boundary

The reviewed SDK integration is [loro-streams #425](https://github.com/loro-dev/loro-streams/pull/425).
Official [Client 0.12.0](https://github.com/loro-dev/loro-streams/releases/tag/streams-client-v0.12.0)
was released before [CRDT 0.19.0](https://github.com/loro-dev/loro-streams/releases/tag/streams-crdt-v0.19.0),
which depends exactly on Client 0.12.0. [Repo 0.23.0](https://github.com/loro-dev/loro-repo/releases/tag/loro-repo-v0.23.0)
contains #150–#153 and admits that SDK through its optional peer range. Registry
integrity and peer metadata were checked for all three versions.

The lock delta replaces only these package families and their peer references.
Effect 4.0.2, Loro 1.16.3, Flock WASM 0.4.4, both existing SQLite variants,
authentication, managed runtimes and independent consumers' older SDK versions
remain locked. No local source/tarball overrides are introduced. The
[earlier Repo adoption](../bug-fix/2026-10-10-loro-repo-0.22-upgrade.md) records the
previous graph; the [presence owner](2026-10-12-effect-workspace-presence.md)
retains its existing native/Legacy boundary.

## Release-age and resolution decision

Keep `minimumReleaseAge: 10080`. Add only Client 0.12.0, CRDT 0.19.0 and Repo 0.23.0
to their existing exact-version exclusions, retaining grandfathered versions.
Waiting seven days was the alternative; the owner explicitly approved adopting
these controlled releases on 2026-10-16. Later versions remain quarantined.

A full workspace re-resolution also tries to resolve the already-locked ACP SDK
1.8.0 and fails its independent age check. Instead, pnpm 10.20.0 resolved the new
package families in a small workspace using the same age policy and existing peer
versions. Their generated package/snapshot records and corresponding consumer
references were applied to the main lockfile. A semantic comparison confirmed
unrelated package records and importer dependencies were unchanged; frozen
installation then verified the complete workspace graph.

## Declaration compatibility

Repo 0.23.0 derives its Streams context from an internal SDK type. Inferred shared
error-tool return types therefore triggered TS4023. The scalar projection now
uses an explicit named result based on public `RepoTransportError` property
types. The field allowlist, error recognition, retry and logging behavior remain
unchanged; the shared package declaration check passes.

## Verification and limits

On the installed upgraded graph, existing consumer suites pass: RPC 134 with three
configured integration skips, renderer Streams/presence 49, shared auth/Streams/
snapshot codec 75, and CLI checkpoints/SQLite/recovery/presence 55 (313 passed).
The installed consumers resolve Repo 0.23.0, CRDT 0.19.0, Client 0.12.0 and the
same Effect 4.0.2 package identity.

Frozen workspace installation, all-package typecheck, lint, Effect lint, i18n and
all repository boundary guards pass. Formatting, the CLI production bundle under
a 2048 MiB heap budget, published-import check, CLI `--version` smoke and Electron
OSS main/preload/renderer build pass. Documentation reports zero errors and 68
existing warnings. The first `pnpm check` test phase inherited `NODE_ENV=production`
and failed on React `act`; the full CI test command is being rerun with
`NODE_ENV=test` (the affected helper already passes all 33 tests).

Native WorkspaceData ownership,
renderer migration, storage relocation and real browser/production acceptance
remain separate work. The upstream intermittent SQLite teardown assertion is
unresolved; this dependency change does not claim to fix it or replace Lody's
existing SQLite versions.
