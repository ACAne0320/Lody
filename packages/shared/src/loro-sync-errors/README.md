# Loro sync errors

`index.ts` owns the safe scalar projection, bounded report/cause traversal and
technical error formatting shared by CLI and renderer. Bind
`createLoroSyncErrorTools({ RepoTransportError, RepoSyncError })` using the caller's
imports from `loro-repo`: pnpm peer contexts can resolve distinct runtime classes.

The resulting tools format transport failure evidence and build
warn/error diagnostic records. Non-Streams errors return no formatted detail;
normal diagnostic activity returns no record. Callers own their existing logger
or console sink and localized action label. No tool mutates failures or enables
telemetry.

Display and diagnostics use the same scalar projection; error detail serializes
that projection as JSON rather than maintaining another list of display fields.
Binding rules: [AGENTS.md](AGENTS.md).

`getLoroSnapshotDiagnostic` separately projects the SDK's explicit snapshot
workflow records. CLI logs permission, auth, HEAD, export, encoding and PUT
phases at debug, with failures at warn. The file logger captures debug by
default; tracing does not need to be enabled. `snapshotId` connects the workflow
phases; each HTTP `requestId` connects auth/request phases with the opaque
`X-Request-ID` sent by that SDK request. These identifiers contain no document
body, token, or stream URL. The projection also retains the snapshot offset,
byte length, stage and whole-workflow monotonic elapsed times, configured request
budget, HTTP status, and typed error/abort evidence when available. The byte
length after export describes the exported snapshot; PUT records describe the
encoded request body sent on the wire.

Auth is recorded before a request is sent, so an auth deadline must not be
counted as an aborted HEAD or PUT. A completed body followed by a lost response
remains an uncertain remote outcome. The diagnostic projection does not change
retry, cursor persistence, or snapshot offset behavior.
