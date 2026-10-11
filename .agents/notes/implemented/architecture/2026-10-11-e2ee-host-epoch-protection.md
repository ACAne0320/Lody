# Host epoch protection and durable recipient key retention

Status: implemented
Translation: current

[中文](2026-10-11-e2ee-host-epoch-protection.zh.md)

## Abstract

The original recipient keyring used plaintext Lab JSON while the old opt-in protected epoch journal mixed obsolete wire and publisher candidates. The settled host-only protection direction requires a narrow capability boundary and durable cold reopen independent of a sender remaining active. This layer adapts recipient key retention through one trusted native capability and a separate indexed store; it does not copy those old schemas or choose native cryptography.

## Decision and responsibility

Ordinary consumers retain opaque EpochKey values; only the host entry accepts protect/unprotect once at initialization. Those callbacks can copy secrets, so this is trusted composition rather than an OS isolation guarantee. Authenticate the complete local purpose/Org/recipient/epoch/commitment/key payload, recheck real current authority and recompute commitment after native work. Native algorithm and actual platform custody stay external. The existing [foundation Spec](../../../../specs/e2ee-foundations.md) owns this consequential boundary and remains draft; settled direction does not approve its entire revised text.

The [contract](../../../../packages/e2ee-core/src/keys/HOST-PROTECTION.md) and [provenance](../../../../packages/e2ee-core/src/keys/host-provenance.json) distinguish source portions. Installed-key storage is separated from publisher candidate preparation, permanent publisher loss, recovery vault/file format and queued installation reports. Existing candidate state is not imported. This layer retains uncertainty after a write/readback failure, never declares reported installation and never silently replaces/deletes a protected original.

## Evidence and limits

Synthetic authenticated protection tests use real signed views, real SQLite and independent-process reopen. Different genuine Orgs with identical commitment zero cannot transplant a blob; purpose, recipient, epoch, commitment and key mutation fail. Signalled cancellation and Scope close await native settlement before clearing plaintext. Foreign-file preservation, insert failure, readback failure/original retention, revocation and reopened authority rollback fail closed. The protector is explicitly a mock native boundary. No actual keychain, real keys, IPC, product assembly, production E2EE, report queue, SDK/Lab completion or all-platform acceptance is claimed.

Direct parent is #1479 at f7dc8e53b1f5a10f11d3eeebab3a292c3fc3023b. Author validation: protection8/core219, package typecheck, root format, docs check and complete root check using native Git/local IPC passed. Actual new public host subentries are exercised. A fresh process reopens the protected store; a later revoked original sender does not prevent current-recipient cold restore. Recipient revocation and durable rollback pin still reject access. These are author results, not independent review/native-platform acceptance.
