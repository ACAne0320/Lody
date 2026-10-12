# Public Lab integration in progress

Status: proposed
Translation: current

[中文](2026-10-12-e2ee-lab-integration.zh.md)

## Abstract

Migrate the actual original `packages/e2ee-lab` onto public core exports and
released SDKs, with runnable durable-state behavior. Original host/actors,
driver/replay/attacks/CLI and complete fault acceptance remain unfinished; keep
one integration branch before one consolidated Draft. Direct parent is #1496
`0418fd69e22d1eeba47553714473ec54762837ec`.
[Manifest](../../../docs/e2ee-migration-manifest.json) and
[provenance](../../../../packages/e2ee-lab/migration-provenance.json) retain
per-source SHA, target and partial status. No copied core, signature-acceptance
injection, private product sources, real credentials or production activation.

Preserve root Effect4.0.2, streams-client0.9.0, streams-crdt0.16.2, Loro1.16.3,
Flock0.4.3 and source-specific Riverrun0.3.0. Only the Lab importer, Riverrun
package/snapshot and approved package-specific SQLite13.0.3 override are added;
prior lock entries/root Riverrun catalog stay unchanged. Frozen ignore-scripts
install passes. Source worktrees and the staged compatibility candidate are read-only.

## Ledger and authority

Public reader/feed verification owns genuine views; independently selected
checkpoints never come from hostile offsets/headers. Serialized SQLite commits
original verified records and cursor together. Duplicate committed records at a
later offset, older pages and SQL IGNORE retain the prior durable pair. The actor
captures ordinary intent, consumes public admission/signing and unchanged P09,
prohibits new signing while pending, and requires durable inclusion before terminal
acknowledgement. Another OS process resumes original pending bytes without a
usable signer. The earlier Result-as-boolean acknowledgement bug is repaired;
its old failure stays separate from restored behavior.

Genuine policy checks precede inspecting current device/member/Org. Structural
counterfeit views and hostile wrappers cannot choose authority. R receives and
repairs keys but cannot send, write or manage. Inert join receipt is not admission.
Current trusted-checkpoint/lost-ACK crash-gap host composition is unfinished.
Original createSpace stores genesis only in host metadata and creates empty control;
original loadControl prepends that metadata genesis. The public submission adapter
requires a complete signed history. Human options are A initialize control with
verified original genesis (recommended), or B a Lab-only metadata-prefix transport
with explicit cursor/lost-ACK acceptance. Coordinator recommends A, not approval.
Do not change merged P09 or implement dependent createSpace before human selection.

Pure verdicts require measurements: unmeasured baseline and partially unavailable
coverage never pass; counts do not authenticate history. Unauthorized new writes
violate the public contract; legitimate admitted history survives author revocation.
Insider freshness assumptions stay explicit. Run-owned bounded synthetic traces
capture fields before checking budget, refuse closed operations and return immutable
observations; no process-global plaintext log. Actual actor/attack observations and
permanently unsettled native-owner recovery remain unfinished.

## Resource ownership

Scoped operations reject new work, propagate abort and await raw request/body,
finite ledger lookup and native phase settlement before earlier SQLite/SDK owners
close. Every child is awaited even if another cleanup defects; failures remain
visible. Controlled abort-ignoring gates wrap real work, not successful mock SDKs.
SDK/harness callbacks alone use the deprecated Promise bridge. Pure scheduler
uses typed Results and explicit logical permit parent chains/time/mode/fetch.
Finite permit driver matches the next identity/parent/occurrence and checks budget
before granting. Caller stop and interruption close gates before interrupting,
then await actual native settlement. Missing/extra records remain explicit errors.
Counter JSON tuples do not change parent wire; delimiter labels are refused as a
compatibility limit. Full actions, ancestry/entropy replay and executor are pending.

StreamsClient.close() publishes protocol EOF, not disposal. Its HTTP facade has
no native dispose: Scope aborts and awaits requests without publishing EOF.
CRDT SyncClient.close() is lifecycle cleanup, but does not join all one-shot
operations itself. Wait raw operations, close subscriptions/SDK, then Loro.free.
Flock0.4.3 has no public free/dispose; drop references after closing SDK, without
private internals or deterministic Wasm allocation-release claims.

Initial no-wait/body probes let mutants escape. Retain those immutable logs;
revised actual owner-close assertions fail without timeout and restored tests pass.
Failure-path gates are released and raw work joined even during a negative control.
No sleeps, scheduler luck, source-string assertions or mock-call counts.

## Credentials, metadata and HTTP

Synthetic account labels, frozen Lab v2 possession domain, single-use60s nonce
and token lease at most15min are Lab contracts, not production identity/JWT,
ordinary leeway changes or approved strict deadline B. Real Ed proofs and current
membership precede scoped SQLite mint/invalidate/consume. Actual transactional
readback rejects ignored inserts and nonce-restoring triggers.

Bind-once preserves original token/TTL, grants no membership and refuses foreign
Org. Recheck stored identity, expiry/invalidation after finite genuine ledger
lookup, then read back the actual UPDATE. Same-Org retry is idempotent. Signed
inert joins preserve original signer per request ID and first synthetic account
per user; two rows read back atomically and are reverified after reopen. R cannot
submit. Genesis registry replays original canonical signed genesis and signer,
owns bytes, rejects corrupt rows and reopens in another OS process. Authenticated
genesis-only discovery preserves unbound joiner access. Registry is still private
harness registration, not complete HTTP create-space publication/current authority.

Actual loopback routes provide health/challenge/credential/control-CAS,
authenticated mailbox7, joins, genesis discovery and finite SDK reads. Stored
bearer/device/boundOrg are sole principals; JSON cannot choose a sender. Public
complete-prefix/control admission pins SDK CAS and supplies required ACK offset;
caller lifecycle/offset/auth headers cannot reach upstream. Initial SDK generic
Authorization-header401 and missing ACK-header failures are retained; the correct
published auth API/header passes. No second P09.

Fixed loopback finite GET/HEAD control/loro/flock/bootstrap/latest/specific
snapshot reads bound queries/headers/body. Native307 resolves only canonical
same-origin/Org/stream offset, without forwarding Location. Retain the body lease
and recheck genuine authority afterward. Real signed machine revocation during
response delivery rejects without advancing client durable cursor. Actual other
origin/Org/stream redirect endpoints leave SQLite audit storage untouched.
SDK0.9 putSnapshot echoes its input; use native HEAD opaque tokens in unprotected
transport fixtures. The earlier literal0 versus native20digit token failure and
protocol-close typing rejection are fixture evidence, not protocol changes.

Original HostMeta SQL-only probes reproduce phantom credential/nonce, joins/first
account binding, ignored genesis and ignored credential-binding writes. They use
unchecked synthetic DTOs/issuer bytes, not full HTTP/product-identity vulnerability
proofs. Source8f409412… remains unchanged. Notes eligibility needs human alignment:
old Lab machine/R notes conflict with public personal-only comparisonNote. Option
A preserves personal-only plus unconfirmed host observations; option B separately
defines machine inert observations, never R sending. Coordinator recommends A;
this is not human approval or automatic independent confirmation.

## Keys, native content and recovery

The original synthetic device module now preserves its seven exports as typed Effect/public-byte APIs and consumes the public native signer/verifier. Its existing four-field JSON roundtrips native Ed25519/X25519 fixtures, with private/public binding checked before import returns. Real public HPKE and SQLite credentials verify the imported device, single-use proof and refusal to bind an unregistered device to an Org. Creation awaits both native generators on rejection/cancellation; explicit signal tests instrument only post-native returns/failure, leaving actual crypto/entropy unchanged. Caller owns native handles; WebCrypto offers no key close/zeroization. Exportable strings are synthetic fixture material, not a recovery-vault, OS custody or captured replay contract. Full session/actors still need wiring. Source Ed/X mismatch two old direct FAIL/new same-probe PASS; owning8/type and root core302/Lab71, format/docs/public boundary7018files/27manifests pass with unchanged60 Lab SHA. Fixed-head controls pending.

Pure fingerprint and bounded minimizer retain the original five/two exports with separate policies: exact replay compares every original field and reports missing/JSON-dropped/null/unavailable measurements as gaps; another dimension's harness error never erases a measured violation. Shrink preserves the original rules and exact known trigger facts, permits diagnostic ledger length to shrink, and exposes partial observation. Unmeasured original triggers refuse execution. Effect runners remain sequential, bounded, caller-owned and fail transparently. The original fingerprint is independently copied before callbacks; generic action items must already be immutable and independently owned. Legacy model labels are inert compatibility diagnostics, not authorization policy. These are pure synthetic algorithm probes, not full attack/repro execution, serialization approval, captured entropy or resealing. Four original direct old FAIL/new same-probe PASS; owning10/type and current root core302/Lab80, format/docs/public boundary7020files/27manifests pass; all62 Lab SHA unchanged. Six first loop-static failures retained, equivalent guards fixed. Fixed-head controls pending.

Real public HPKE/distributor/receiver, SQLite installation readback/report and
actual challenge/bearer mailbox routes compose. Tampered frames install nothing
and do not report; original frames install and report. Recovery cannot send after
reopen and own-slot repair revision advances once, same-ID retry is idempotent.
Preserve512-byte envelope/report,8192-byte publication and existing1–256-char
repair-ID bounds. Fixture AES wrapping and test accounts are synthetic; some
transport-only units explicitly use pre-authenticated fixtures. The finite key-round now keeps a real ignored-install task in phase Install, with
empty protected-key storage and no terminal result, then closes parent receiver
owners. An actual OS child reopens the original task/device, decrypts HPKE,
saves/readbacks and flushes a signed report through fresh challenge/bearer HTTP.
Parent compares actual SQLite original frame bytes and Reported state, then retains
the prior R no-send/own-slot repair coverage. This is not full epoch rotation or
native custody. Device export is synthetic file0600, not a recovery-vault format.
Initial child open failed because its public CryptoKey was non-extractable; locked
HPKE serializes it for recipient binding. Import the public handle extractable,
keep the private handle non-extractable; no algorithm/core change. Failed log stays.
Owning/affected13/type and fresh e574+3 SHA-overlay Lab52 pass. Skipping real
HPKE install or report causes a direct missing Reported assertion, no timeout;
restoration passes. Current full root core302/Lab52, format/docs and public boundary7011files/27manifests
pass, with all53 Lab inputs unchanged. Fixed-head/CI/independent evidence remain pending.
The earlier duplicate X25519 key fixture was rejected, then corrected without
changing public admission.

The existing key-round also covers a genuine signed synthetic epoch1 record, real owner distribution, fresh HTTP credentials and an OS child installing only key1. Public history recovery derives key0 from that installed key and the authenticated packet; the parent checks native SQLite rows change from [1] to [0,1], commitment matching, the original ciphertext frame and the installation receipt. A valid identical epoch2 proposal succeeds for Owner and fails for R. R still cannot send. Signed history is independently pinned by the fixture; this is not control-stream publication, a durable production rotation producer, backup completion or a recovery-vault format. No old key is supplied to the child. Current root core302/Lab67, format/docs/public boundary7017files/27manifests pass; all59 Lab input SHA unchanged. Fixed-head negatives and full actor/rotation acceptance remain pending.

Public header3 update binding feeds real released Loro/Flock SDKs. Per-document
SQLite atomically pairs native snapshot/file and exact SDK cursor with readback;
failed save/import retains the prior pair. Loro and now Flock reopen native state,
cursor and protected epoch file in a real OS child with no usable signer, preserve
old data and decrypt a new independent update. Reopened Flock refuses actual Loro SDK protected wire for the same Org/resource
and different model without changing either durable field. Removing Flock file restoration
loses the old field; withholding reopened key fails actual SDK missing_read_key.
Both fail without timeout and restoration passes. Reuse the existing content
suite/child script; no duplicate core or new production wrapping choice.

Scoped Loro session subscribes before native edits, saves local state before
upload and stops only the failed document. Editing before SDK creation originally
returned append success without remote content; real remote-state failure is
retained and fixed by construction order. Full-history recovery preserves local
edits and commits only after whole pull succeeds. Riverrun0.3.0 nonzero snapshot
PUT advances earliest_offset: public history is then gone and SDK sees the same
bad snapshot. Readable-history recovery passes; unavailable-prefix recovery stays
failed with unchanged pair. No host SQL reset or snapshot deletion. Authenticated
retained-history API versus trusted-host history remains a coordinated decision.
Protected snapshot wire/offset/publication and full Flock recovery/live are pending.

Pure replay comparison only consumes recorded inert synthetic fixtures, including
actor/operation/phase/resource and protected request/response bytes. No entropy,
resealing or full execution driver. Original multipart normalization short-boundary
allocation/incomplete-frame failures are repaired conservatively; old4pass/2fail
and new6pass remain. Full original fixture/replay/attack/CLI closure is pending.

## Validation and remaining work

Fixed285289 authenticated reads root core302/Lab52, format/docs and public boundary
7010files/27manifests pass with all52 Lab inputs unchanged. Fixed-head no-overlay
Lab52 and body retention/origin/post-read-authority negatives fail direct behavior
assertions without timeout; restored passes. Earlier first-root control-character
regex errors were repaired with equivalent character-code bounds; failed log remains.
Flock process expansion is current WIP: owning4/type and fresh285289 plus two
SHA-declared overlays Lab52 pass; current full root core302/Lab52, format and public boundary7010files/27manifests
pass with unchanged52 Lab SHA. Consolidation initially missed the required Abstract
heading; preserve docs failure, restore bilingual Abstract and rerun docs.
Fixed-head/CI/independent evidence remain separate. Prior checkpoint reports/logs stay immutable, not inherited Ready.

An unchanged CLI inherited Git-helper context failure is retained. Focused original
CLI6 and whole root pass with only test-child GIT_EXEC_PATH removed and /usr/bin
preferred; no source/global Git change or proved root-cause claim. Actual fetch
main987962e… has no owned overlap; merged1432/1433/1434 are ancestors, not duplicated.
Original combined CI cancellation is not successor CI success. SDK prep is not a
production protector. Main coordinator owns independent review; no self-review model.

Finish real create-space publication/binding/current-checkpoint crash gaps,
content writes/live, full honest actors/rotation/cross-process key round, Flock
recovery/session, scheduler driver, attacker capabilities, original fixtures/replay/
CLI and original Lab2/full fault matrix before one consolidated Lab Draft. Strict B,
vault format/wrapping/concurrency/retention, permanent publisher-loss backup,
D12 atomic-removal wire, snapshot/history, entropy and notes remain human gates.
None blocks independent settled work. Production activation, native custody,
whole-stack CI/review and all-platform product acceptance remain separate.

The control gateway permits only the settled Recovery exception: authorizing its own
new personal device. Candidate screening binds the stored credential signer and
operation kind; public submission still verifies the whole history, current member
instance, new-device PoP and pinned SDK CAS. Actual fresh possession/bearer HTTP and
released StreamsClient/native SQLite tests retain remote bytes/tail on foreign-member
PoP, forbidden R operations and invalid signatures; revoked R is refused. This is
device registration, not recovery vault, backup, restored content or production custody.

The manifest now inventories all original DemoSession AST methods with source member
fingerprints: 31 public entries including constructor and 12 private helpers. Every
entry states owning target modules and remaining facade work or human decision.
Primitive/module coverage does not close the corresponding honest session method;
plaintext epoch JSON helpers are retired as ordinary custody, and old removal stays
blocked on D12. Source fields and complete actor/replay composition remain separate
uncompleted work.
