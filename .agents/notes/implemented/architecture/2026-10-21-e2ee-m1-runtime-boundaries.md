# E2EE M1: retained state and host runtimes

Status: implemented
Translation: current

[中文](2026-10-21-e2ee-m1-runtime-boundaries.zh.md)

## Abstract

Based on public `698df2f281a40f9d63b086a8e48f5404a885f5da`. M1 connects the desktop
ledger runtime. Content, pairing and ordinary-user entry points remain gated.
Ordinary workspaces neither open custody nor acquire a new network prerequisite.

## Implemented boundaries

- Core and Lab use the catalog Streams version. Validate standalone and embedded compositions.
- Shared WorkspaceStreamsContent is mandatory. Existing ordinary callers select plaintext;
  unsupported CLI/helper/prefetch/Shortcut/import paths reject before transport side effects.
  Workers carry only a cloneable mode marker; personal Shortcuts retain their own resource domain.
- A retained LedgerFeed origin includes the complete local v2 export and its offset.
  Verification provenance is preserved. VerifiedLedger alone advances pins; rebase pins first,
  then SQLite CAS-replaces the origin and deletes covered rows. A newer pin needs a proven suffix;
  a cache newer than its pin is rebuildable. Genuine conflicts never reset pins.
- Lazy desktop account owners reuse creation custody. Each workspace owns feed, pin and installed-key
  stores. recordCreated checks the original local creation and binds workspace to genesis immutably.
  Existing workspaces only openDevice. Epoch0 is inserted once and commitment-checked; originals stay.
- The ledger page displays local state first, then fetches a suffix for main-process verification.
  Web/mobile keep their existing reader. IPC admits product windows and explicit leased-workspace
  operations only; it returns public projections, never secrets or arbitrary signing.
- Core-authenticated originals enter history.sqlite before feed commit and pin advancement.
  Failed ingestion closes that owner; reopen reconciles originals. Cache recovery preserves old
  files and proves the pin. A crash between rebase and saving its envelope can also rebuild safely.
- Window leases keep other readers alive. Account handoff, logout and quit stop admission,
  await actual native operations, then release workspace stores and custody.
- Node custody preserves existing blob formats, AAD, original publication and rewrap semantics.
  Electron retains its backend qualification. CLI probes a real keyring write/read on first creation,
  automatically choosing file protection if unavailable, then never changes the selection.
  File protection admits machines only, with POSIX owner/0600/0700 and Windows DACL checks.
  Missing selectors or KEKs with existing originals refuse replacement identities/keys.

## Owner decision and limits

On 2026-10-21 the owner approved automatic first-creation file protection for machines.
Personal devices still require OS protection. Future pairing approval must disclose protection;
M1 does not connect pairing or touch keyrings during ordinary CLI startup. This explicit approval
supersedes the older D10 summary; the owner handles protocol wording in PR-06a.

Retained state is only the caller's own export. Originals plus an independent pin justify recovery;
conflicting evidence never triggers automatic resets. InstalledEpochKeys.check disposes temporary
key material inside core instead of handing it to a status reader. Synthetic tests do not prove
real OS keyrings, Windows ACLs or packaged Electron native ABI behavior.

First takeover also retains the renderer's previously verified checkpoint. Until original
history proves it, continuity remains pending and no key readiness or authority is exposed.
The restriction is pinned durably and survives restart.

The real-bundler startup tests locate the application by module ownership rather than a single facade shape. They still require dynamic-only import after startup ownership; shared dynamic entries may expose an application namespace. Production startup configuration is unchanged.
