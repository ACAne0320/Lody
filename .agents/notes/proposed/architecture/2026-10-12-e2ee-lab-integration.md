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

Recorded-material event comparison covers every existing LabEvent field, including
eventId and step. It compares optional parent values before formatting diagnostics,
so missing parent cannot equal the literal string "none". This compares typed inert
materials; it validates no repro schema and executes no captured actions/crypto.
eventSignature remains a coarse actor/operation/phase/status diagnostic projection,
not exact replay equality.

The original independent reference-model exports now live under ./reference-model.
Independent synthetic observations predict policy without calling core decision
functions. New-seal prediction denies rotationRequired, and missing rotation/kind or
pending-byte/cursor observations remain unmeasured. Legacy boolean projections fail
closed and cannot prove two unknown runs agree. captureRefState owns factual rows
and collections before measured actors run; the LedgerState adapter is metadata
only and establishes no authority. Snapshot helper predicts local context/personal
manager eligibility only, never signature/history/trust admission. These eight pure
owning cases do not complete real actor/reference correspondence or old Lab2.

./key-round implements one finite centralKeyRound application pass over an already
scoped public distributor: repair flush, receive resume/fetch, report flush, current
epoch reconciliation, pending delivery resume and final reports/results. Every phase
borrows captured public methods; the caller keeps that owner scope alive until the
Effect settles. Errors propagate without fabricated next/results; blocked tasks and
individual page cursors remain explicit. Existing real HTTP/native SQLite/HPKE and
OS-child tests now consume it for Owner epoch0/1 and reopened Recovery; bad envelopes
and failed installs abort the pass with native keys/task/report state retained.
No automatic full pagination, startup/reauth/ledger bootstrap facade, production
publisher/backup strategy or native cancellation guarantee is added here.

The source session inventory also tracks all 29 declared fields and the private
constructor options property. Raw ordinary epoch-key maps and duplicate point
verification cache are retired through public owners; synthetic adversary key
fixtures keep an explicit separate destination. Field inventory does not close
full honest actor state or four original crash-injection phase scenarios.

./http-identity moves actual synthetic possession/bearer acquisition out of test
helpers. It owns bounded credential response bodies, captures the signer before
await, verifies its proof with the public fixed verifier, validates response
account/device/Org and token/time shape, and refuses cross-origin bearer requests,
redirects and requests after close. Native SDK Promise fetch ports borrow the
identity signal; their caller owns full request/body settlement. No Effect runner
is nested here, no new JWT claim/leeway/strict B policy is introduced. Real HTTP
and OS-child key tests consume it; response alteration/over-limit streams are
explicit transport instrumentation, not an implementation of product custody or
a forever-native bounded shutdown guarantee. Full honest startup/re-auth/adoption
facade and trusted durable checkpoint acquisition remain incomplete.

Authenticated ./http-identity discoverGenesis consumes the existing metadata route
with a bounded 20KiB body (records remain limited to 8KiB). It checks the requested
hash, genesis record type and real public ledger signature, and returns an owned
original record only. Unbound joiners still work. Host storage corruption and
hostile metadata refuse discovery; no current authority, durable checkpoint,
control publication or Genesis layout selection follows from this response.

Authenticated submitJoin/listJoins consume the existing signed candidate mailbox: copied Org-bound signatures, sender binding, receipt true and unique IDs. List body256KiB is a whole-response budget, not pagination or silent truncation. Host current permissions remain. Receipt is inert and may be lost after persistence; retry the original signed request, with no new ID/expiry/automatic approval or full session facade.

[Unsettled contract proposals](2026-10-12-e2ee-unsettled-contracts.md).

./workspace-session openLabExistingWorkspace composes an already admitted synthetic
identity, authenticated original-genesis discovery, the released StreamsClient and
public ledger actor. It requires existing signed full-prefix control plus separate
trusted local reopen/network checkpoint pins; metadata does not supply them. Failed
startup closes the child Scope before returning, with parent resources still alive.
Explicit close and parent/failure cleanup share completion, cancel native fetch before
joining raw CAS, and close SQLite without SDK EOF. A real HTTP/CAS owning test verifies
retry after failed acquisition, persisted acknowledgement and OS-child same-file
reopen. Fixture checkpoint authority is an independently owned history; the host's
durable checkpoint/lost-ACK crash gap remains unfinished. No forever-unsettled native
shutdown guarantee, create-space selection, key/content startup or full DemoSession.

Two native fault streams now exercise that same composed session: a committed record
replayed at the requested current offset, and an older prefix served from -1 despite
that request. Exact native response bytes are checked. Both refuse progress and
retain every SQLite history/meta row, the in-memory view and cursor. Another live
client with a separate file remains usable; a fresh OS child reopens the damaged
client's retained pair before same-handle retry. This maps the two original Lab2
failure semantics onto the existing-workspace consumer, not the full original Lab2
host/actor suite or a closed migration gap.

The independent client now has a separately native-generated personal device, admitted by genuine PoP and the unchanged signed CAS path. Actual credential rows identify both devices. Its own synthetic four-field fixture is handed to a private mode0600 child file and imported through the public device module; the child reports the actual imported signing key along with the retained head/cursor. These test-only exportable fixtures do not select custody, recovery-vault or publisher-backup semantics.

./snapshot-cache stores v1 signed snapshot bytes in real SQLite, indexed only by
independently selected Org/head/count/endorser. Every read copies and reverifies
through the public snapshot entry with a separately supplied full qualification;
SQL cannot provide role/member/head attestation or choose a new peer. Returned
views remain endorsed-snapshot, not full audit/currentness. Saves are append-only,
transactional and read back; SQL IGNORE/corrupting triggers roll back, same-handle
retry is explicit, and one corrupt Org leaves another usable. OS-child reopen uses
independent synthetic pins without a live administrator. Production pin acquisition,
durable qualification custody, suffix/offset bootstrap and full recovery remain
unfinished. This is not vault-v1/v2, protected content snapshot wire or a new trust
policy; v1 endorsement can still trust a lying qualified signer as documented.

restoreLabLedgerFromCacheOrHistory accepts only a genuine view at the independently
selected exact endpoint. Missing/corrupt/stale optional cache falls back to a real
full-history owner; invalid pins/closed cache/defects are not silently converted.
An actual same-Org/head self-claimed Owner has real signature evidence but cannot
replace the separately qualified peer. Client fallback audits real SDK history;
a native SQLite metadata trigger failure retains old records/view/cursor, then
same-handle retry commits the new exact pair. Structural full-view clones fail
public provenance before any field inspection. This is permission-history recovery,
not full R/vault/key recovery or protected-content snapshot restoration.

Restricted A was user-approved (2026-10-12): trusted host initializes protection once, with native custody preferred; reuse public keyring/receiver and full payload binding. ./synthetic-protection now owns the previous fixed AES-GCM Lab fixture and never supplies real OS custody. An OS child exits at the actual report signer, after protected save/reload; Install/source/original blob survive, no report or remote installed claim exists, and normal child reopen completes with the same retained blob. A separate installed-only child reads keys0/1 after the original sender is revoked without HPKE private-handle import or any network; historical-envelope restore B is not added. D12/header/vault/backup/strict B/production gates remain pending. Platform identity port lacks symmetric protection, and current Electron string storage has no reviewed full-payload-integrity/backend-failure adapter; fail that composition explicitly, not by selecting a new algorithm.

## Close race correction

Independent review at c33 found that a second Scope.close returns before an already-running child cleanup, releasing real SQLite/Riverrun too early. Each operation now has one uninterruptible close completion carrying its full Exit/Cause; parent and operation release await the same result. Admission/registration stays synchronous. Real SQLite/SDK oldfail/newpass and success/defect interleavings supplement the owning runtime suite. The copied original probe needed its gate released after parent-close entry, rather than after parent-close return, to test a correctly waiting implementation without a harness deadlock. Original failure assertions remain.

Exact c33 CI failed four 5000ms tests, while independent92 passed. Local affected12 pass: four target durations about0.7/0.7/1.7/2.9s under two workers. This does not establish Linux cost or connect those timeouts to the race. Lab test files now run serially to reduce competing native/Wasm/process setup, preserving the same5s timeout and all real assertions. Accurate new CI must confirm or keep this blocker open. Desktop c33 smoke actually passed6scenarios/40steps; it is not Lab or production acceptance.

CI3006 kept the race correction but remained red: serial execution passed Flock3096ms and gateway3320ms; the two four-process cases still exceeded5s. Local key/workspace were2852/1712ms; completed Linux/native comparisons imply roughly4–5x cost, estimating13/8s aggregate. Apply finite15/10s budgets only to those two existing OS-process integration cases, retaining all assertions and5s for race/other tests. Native-child logs record actual settlement duration (diagnostic, no timing assertion); new CI must confirm estimates and identify any remaining stalls. This is a measured budget estimate, not proof all timeout roots are CPU. Old red runs remain.

Dependency combination correction (2026-10-13): both streams-crdt importers were introduced by this Lab integration, so only #1526 changes; synchronized parent heads stay fixed. Explicitly pin core SDK tests and Lab to main release0.17.0 with its existing client0.10.0 dependency graph. Direct streams-client stays0.9.0 and Effect4.0.2 stays fixed. Explicit package versions avoid stale catalog importers conflicting with main0.17 in GitHub merged trees, without changing other packages catalog. Keep prior0.16.2 resolution records for other packages on the frozen parent chain; both new importers align when combined with main. Runtime/wire source is unchanged; author core302/Lab94 evidence using the same actual0.17 dependencies is reusable. New exact CI and independent integration remain separate.

CI budget correction: the key-distribution fixture repeatedly verified its unchanged signed history during HTTP/receive/repair lookups. It now reuses a genuine verified view until this private append-only fixture adds a record, then fully verifies the new history. Epoch1 and sender-revocation assertions and independent OS-child verification remain; every HPKE/HTTP/SQLite/report/repair step and the original 15s bound remain. Local current-core comparison was 2757ms before and 1718ms after. This is author fixture evidence, not native custody or permanent timing assurance. The parent carries typed failed-envelope diagnostics for explicit durable targeted repair, not automatic skipping.

## Concentrated existing-workspace delivery (2026-10-14)

The additional branch completes the unblocked consumer workflow rather than creating another core. `openLabWorkspaceSession` owns existing admitted control/P09, installed protected keys, receiver/distributor and per-document Loro/Flock lifecycles. Both native models use one document engine; failed persistence/import stops that document only. The host consumes public current-write admission for released header3 batches; historical authentication does not grant new writing permission. Snapshot/legacy headers are refused, with no new wire/domain. Native gate/phase/dispose descriptions use Effect; deprecated Promise methods are SDK callback boundaries.

A finite JSON action executor starts real OS workers, persists real document state, kills actual actors, injects real ciphertext/SQLite/ACK faults and records measured observations. CLI `run`/`inspect` writes a bounded synthetic evidence bundle with actual loaded source/release hashes, original signed ledger and protected wire bytes. It does not regenerate first seals or claim full original replay. Actual control CAS followed by response loss leaves original P09 bytes; hard restart resumes those bytes and explicit ACK follows durable feed verification. Local known pins and current network endpoints are separate. Private IPC points are rechecked against independently witnessed signed originals. Reopen tries at most the known local point and current external point, never a point chosen from SQL. Production acquisition/durability of independent authority remains a platform responsibility.

Author evidence: the 39-action flow measures HPKE installation/reporting, two real SDK models, real SIGKILL/reopen, corrupted ciphertext, document isolation, retained native-state/cursor digests, full-history recovery, SQLite ABORT and original-record ACK resumption. A deliberately deleted SQL document is detected after actual process restart as a durability violation. This is a behavioral negative control, not a timeout. The first IGNORE fixture retried an identical already-durable state; that is legitimate idempotence, so the fixture was corrected to ABORT rather than weakening the persistence contract. An initial native-phase test used the wrong Effect yield API and timed out while its latch remained closed; it is retained as a harness error and is not a security negative control. Standalone package tests use exact existing installed dependencies for iteration; final combined frozen/root/build/smoke and remote CI have separate commit attribution in the handoff. No old P1 matrix is reopened.

The original core7/Lab2 disposition lives only in the migration manifest: six core behaviors have existing replacements; original rotation/permanent-loss remains blocked; both Lab offset behaviors now have a full-session consumer regression with real SQL retention and independent OS reopen. Source fingerprints/registration are unchanged. Removing old JSON/Team/MLS/classes does not remove a required behavior. Optional old worker-pool verification is an unported performance optimization, not a new authority seam; document/cursor pairs use SQLite transactions instead of recreating file cursors.

### Pending human choices (all proposed)

| Decision | Recommendation | Alternative / compatibility / blocked scope |
|---|---|---|
| G genesis/control | Original signed genesis at control record0; registry discovery only; resumable creation | Metadata-only requires explicit compatibility policy; product creation blocked, existing full-prefix sessions proceed |
| S content snapshot and qualification | Bind actual continuation position in authenticated new header; independently pin current Owner/Admin personal qualification; old format historical-only | New admission refuses old publisher; exact encoding and full qualification approval provenance require review; snapshot producer/bootstrap blocked |
| D D12 | Existing tag8 + snapshot-v2 required tags/capability-pin proposal | Old clients explicitly refuse; never tag2 downgrade/two CAS; atomic principle already settled, new producer blocked |
| V vault | Direct file-secret derivation of independent workspace wrapping keys; per-entry CAS, verify replacement before revocation, retain retired backups | Existing draft proposes master/index instead; choosing direct derivation requires revising that draft; Passkey separate; vault setup/recovery blocked |
| K candidate backup / emergency | Normal publication requires independently readable backup before CAS | Explicit emergency risk acceptance can revoke faster but risks permanent content loss; candidate/rotation/resume producer blocked |
| R replay entropy | Retain original signed/encrypted bytes; first seals stay securely random | Test-only labeled entropy is a separate explicit capability, no global crypto override; exact regeneration replay blocked |
| N notes | Host notes inert; external full tuple/actual peer still required | All-Member signed note would require new wire/domain; new producer blocked |
| B strict freshness | Keep ordinary60s tolerance; separately approve strict time source/failure semantics | Strict-by-default harms offline/high-latency paths; strictB blocked, ordinary contracts proceed |

Restricted A is already approved and is not asked again. It covers installed EpochKey protection only, not candidates, vault, B historical-sender envelope restore or production custody. Native protector, trusted retained-history API and private product wiring are associated platform/upstream work. No protocol option in this section is approved by implementation or green tests.


Additional settled consumers: signed unbound join intent has a dedicated Lab SQL original journal; lost receipt/reopen preserves the original, real admission/P09 precedes ordinary receiver/content startup, and pre-admission mailbox access is refused. Public installed-history composition validates the whole chain before any save, persists/reloads each recovered commitment and disposes owned opaque temporary keys. Real signed malformed packets leave no older durable keys; native SQL ABORT remains failure, explicit retry restores originals. Genuine observations survive missing-epoch rejection and reject later rollback. This uses restricted A only for installed keys and does not create candidate protection, vault or historical-envelope B.
