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

## User approval A (2026-10-12)

The user approved restricted A: verified installed EpochKeys may persist through a trusted initialization-time host protector, with native custody preferred. Reuse this port/store; no ordinary callback/export or new wrapping/ledger/mailbox domain is authorized. All context is inside protected bytes, not independently mutable SQLite metadata. Core borrows bounded scratch until actual native settlement, then clears its own copies; the adapter may retain copies and JavaScript cannot promise total erasure. Successful open transfers the opaque key to its caller; failed opens retain ownership for disposal. New deliveries still require the current sender. A separately installed historical key can cold-reopen after that sender is revoked; this is not historical-envelope restore B.

The existing platform host-keys port supplies public identity create/read, not authenticated symmetric protection. The existing Electron safeStorage string path has no reviewed whole-payload integrity/backend-failure adapter, and its development path can be plaintext. It is not wired here. An eligible adapter must authenticate the complete fixed payload, refuse insecure/unavailable storage, preserve uncertain originals and await actual operations. No native/keychain/platform acceptance is claimed and no new algorithm is selected. [Electron API](https://www.electronjs.org/docs/latest/api/safe-storage) documents platform-dependent security and Linux basic_text fallback; this is a concrete composition gap, not a claim that every native backend fails.

The extended real-SQLite owning case now cold-reopens in another OS process after the original sender is revoked. Synthetic protection only; current recipient and independently genuine history remain required. Installation journal/readback/fixed-report queue is owned by the later receiver slice. Unchanged receive/HPKE/P09 are reused, never substituted by a prior Installed label. D12 wire, SDK snapshot headers, vault/backup strategy, strict B and production activation remain unapproved; L2c remains independent.

Fixed-fixture CI correction (2026-10-13): serialized#1480 CI38349549813 still took32087ms for500 dedup calls beyond30s; the next principal check also hit5s. Preserve red logs. Source comparison identifies the early fixture re-verifying identical unchanged signed history via f.ledger on every put; reviewed#1487 already captures a genuine verified view once. Backport that existing fixture optimization: verify the same fixed history once while retaining all500 public put calls, real envelope verification on each, data/assertions; dynamic revocation fixtures remain unchanged. Withdraw the unpublished45s budget proposal; retain30s/other5s/protocol60s and unapproved strictB. Vitest3.2.4 afterEach precedes onTestFinished, so cancel and await this test-owned Effect before removing files and after SQLite cleanup, preventing timed-out work leaking into the next case. No production verifier cache or authority change; new exact CI is required.
