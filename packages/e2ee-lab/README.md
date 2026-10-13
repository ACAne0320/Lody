# Public E2EE Lab (migration in progress)

This private runnable workspace consumes public `@lody/e2ee-core` modules and
released SDKs: streams-client 0.9.0, streams-crdt 0.16.2, Loro 1.16.3, Flock 0.4.3,
SQLite Riverrun 0.3.0 and the root locked Effect 4.0.2. It has no copied core.

From a standalone repository checkout with the supported Node and pinned pnpm,
initialize the public submodules, run `pnpm install --frozen-lockfile`, and run:

```sh
pnpm --filter @lody/e2ee-lab typecheck
pnpm --filter @lody/e2ee-lab test
```

The tests start actual loopback Riverrun servers on assigned ports and use
synthetic accounts and temporary SQLite files. No global tools, hosted product,
production database, real keys or production E2EE activation are involved.

The ledger client uses an independently selected signed checkpoint, genuine
public verification and serialized durable original frames/cursor. The actor
uses public admission/signing and unchanged P09 submission recovery; failed feed
persistence forbids consumption of a terminal result. Separate OS processes
reopen real state and resume original signed records without a usable signer.

The content provider consumes the public header3 update binding. Actual Loro
and Flock SDK clients encrypt/decrypt and import native state. Each document owns
one SQLite file; staged actual native state and exact SDK cursor commit together
with transactional readback. Failed save retains the prior durable pair. Loro and Flock
reopen that pair and the protected epoch store in another OS process, without a
usable signer. Flock retains an old field, decrypts a new independent update and
refuses actual Loro protected wire for the same Org/resource without changing its
durable pair. This is finite process-reopen evidence, not a full Flock session.
The AES fixture wrapping capability is synthetic, not native platform custody or
a chosen production wrapping algorithm.

`makeLabLoroSession` owns serial operations, fresh SDK transports and the actual
Loro document. SDK subscription precedes local edits; local state persists before
upload. A failure stops only that document. Explicit full-history recovery keeps
durable local edits and commits only after the full SDK pull succeeds. It does
not delete or change hosted snapshots. Riverrun 0.3.0 snapshot PUT at a nonzero
offset advances `earliest_offset`; that prefix becomes unavailable through the
public history endpoint. Recovery succeeds only while history remains readable.
Otherwise it stays failed without advancing the durable pair. Retained-history
API/host ownership is an unresolved coordinated contract, not completed recovery.

Scope closes admission, aborts requests, waits actual native SDK settlement and
then closes SDKs/storage and frees the actual Loro owner. CRDT SyncClient.close() alone does not await every one-shot operation.
StreamsClient.close() publishes protocol EOF; the HTTP facade has no native
disposal method. Its scoped owner aborts and awaits requests without publishing EOF. Flock 0.4.3 exposes no
public deterministic free/dispose: close SDK subscriptions and drop references;
do not touch private internals or claim deterministic Wasm allocation release.
The permit runtime requires explicit mode/time/fetch. Its deprecated Promise
bridge is confined to SDK callbacks. Logical scheduler commands use typed Results.

`authorizeLabStream` uses a genuine public ledger before inspecting current
membership, binds credential/request Org, and refuses R sending or content writes.
It is a policy gate, not credential authentication, pinned CAS or payload admission.
`makeLabMailboxRemote` consumes the public receiver/distributor interface over HTTP,
bounds JSON/hex/pages, aborts and awaits the entire response body on close. An
optional transferred native transport lease closes only after that settlement;
global fetch requires no native close. Real
HPKE delivery and SQLite save/readback/report rounds run through this adapter;
tampered frames install nothing and do not report, and Recovery cannot send after
stores reopen. Transport unit fixtures use explicit pre-authenticated synthetic sessions; AES
wrapping is an explicit mock boundary. Full host route authentication and
rotation/actor composition remain pending. The finite key-round now retains an
actual failed Install task, closes parent receiver owners and reopens in an OS child.
The child imports its synthetic X25519 device, opens the original HPKE frame,
saves/readbacks the protected epoch and sends the report through fresh real
challenge/bearer HTTP; parent verifies actual Reported/frame bytes and R no-send.
This is not full cross-process epoch rotation or platform custody.

The existing key-round also covers a genuine signed synthetic epoch1 record, real owner distribution, fresh HTTP credentials and an OS child installing only key1. Public history recovery derives key0 from that installed key and the authenticated packet; the parent checks native SQLite rows change from [1] to [0,1], commitment matching, the original ciphertext frame and the installation receipt. A valid identical epoch2 proposal succeeds for Owner and fails for R. R still cannot send. Signed history is independently pinned by the fixture; this is not control-stream publication, a durable production rotation producer, backup completion or a recovery-vault format. No old key is supplied to the child.

The mailbox host now exposes the seven original operations through the actual
challenge/bearer HTTP composition, binds only the stored device and bound Org, and
consumes the public SQLite mailbox. JSON cannot select a sender. Envelope/report
frames retain the public 512-byte bound; local-publication records retain 8192
bytes and repair IDs retain the existing 1–256-character contract. No new ID format
is introduced. The real HPKE round uses this route, including Recovery no-send and
idempotent own-slot repair. Account identity and AES wrapping remain synthetic;
some transport unit fixtures are still explicitly pre-authenticated. This is not
full host/rotation composition or cross-process epoch-rotation acceptance.

The original synthetic device module now preserves its seven exports as typed Effect/public-byte APIs and consumes the public native signer/verifier. Its existing four-field JSON roundtrips native Ed25519/X25519 fixtures, with private/public binding checked before import returns. Real public HPKE and SQLite credentials verify the imported device, single-use proof and refusal to bind an unregistered device to an Org. Creation awaits both native generators on rejection/cancellation; explicit signal tests instrument only post-native returns/failure, leaving actual crypto/entropy unchanged. Caller owns native handles; WebCrypto offers no key close/zeroization. Exportable strings are synthetic fixture material, not a recovery-vault, OS custody or captured replay contract. Full session/actors still need wiring.

Pure fingerprint and bounded minimizer retain the original five/two exports with separate policies: exact replay compares every original field and reports missing/JSON-dropped/null/unavailable measurements as gaps; another dimension's harness error never erases a measured violation. Shrink preserves the original rules and exact known trigger facts, permits diagnostic ledger length to shrink, and exposes partial observation. Unmeasured original triggers refuse execution. Effect runners remain sequential, bounded, caller-owned and fail transparently. The original fingerprint is independently copied before callbacks; generic action items must already be immutable and independently owned. Legacy model labels are inert compatibility diagnostics, not authorization policy. These are pure synthetic algorithm probes, not full attack/repro execution, serialization approval, captured entropy or resealing.

The scoped credential owner retains the frozen Lab v2 possession domain, 60-second
single-use nonce and at most 15-minute synthetic token TTL. Real Ed25519 proofs,
genuine current Org membership and transactional SQLite mint/invalidate readback
are required. Account is only a test label; no JWT claim, ordinary tolerance or
strict production deadline B is changed. The loopback HTTP host currently serves
health, challenge, credential, control append-CAS, authenticated mailbox and joins routes. Exact canonical paths,
bounded JSON/single-record bodies and stored bearer tokens are checked. Public
submission audits the independently selected complete prefix and pins SDK CAS;
caller lifecycle/offset/auth headers have no upstream forwarding path. Workspace
create-space/checkpoint persistence, remaining metadata, content writes/live
subscriptions and CLI are still pending; indexed key delivery uses the public mailbox. Shared operation scopes abort, interrupt and await all children,
even if one cleanup defects, before earlier SQLite/SDK owners close.

The join mailbox consumes public request signing/verification. A real unbound
outsider proof can submit an inert request; only genuine current members can read
the queue. Receipt never grants membership or chooses a new expiry policy. Same
request ID remains replaceable only by its original signing key; first synthetic
user/account association remains fixed. Both SQLite rows must read back in one
transaction, and stored requests/bindings are revalidated before reuse. R cannot
submit join requests. Borrowed ledger lookup receives an abort signal and is
retained until actual completion; actual SQLite close/open and Riverrun order are
observed in an explicit abort-ignoring lease test. Full host composition is pending.

The original full host/gateway, honest actors, key delivery/rotation composition,
Flock recovery/live sessions, full schedule executor, attacker capabilities,
captured replay, original fixtures and CLI/startup remain pending. The current
80 tests do not close the original Lab2 failures or the complete original fault
matrix. Snapshot wire/offset, replay entropy, strict deadline B, recovery vault,
D12 and permanent publisher loss remain explicit decisions. Native custody,
production E2EE, independent whole-stack review, CI and product acceptance are
separate boundaries. See the [complete manifest](../../.agents/docs/e2ee-migration-manifest.json)
and the [owning Note](../../.agents/notes/proposed/architecture/2026-10-12-e2ee-lab-integration.md).

The workspace registry stores original public-signature-verified genesis and its
original signer with same-transaction readback. Ignored writes and corrupted
stored rows fail closed; another OS process reopens and verifies the actual file.
Authenticated genesis discovery preserves unbound-joiner access to genesis only.
This metadata API is private-harness registration, not completed HTTP create-space
publication, a current trusted endpoint, key custody or crash-gap recovery.

Credential binding preserves the original bind-once token and its exact original
lease; it never renews or grants membership. It rechecks stored identity, expiry
and invalidation after finite current-ledger lookup, then verifies the actual
SQLite UPDATE. The lookup receives abort and remains retained until settlement.
Host create-space/stream publication integration remains unfinished.

`makeLabStreamReader` serves bounded finite GET/HEAD control/loro/flock reads and
SDK bootstrap/latest/specific snapshots through stored bearer authentication.
Upstream is a fixed loopback origin, with no caller URL/headers forwarded. Latest
snapshot redirects are resolved only inside the same origin/Org/stream; response
bytes and allowed SDK headers are buffered within the native lease. Genuine
current authorization is checked before and after transport settlement. Actual
signed revocation during read retains the public feed's durable cursor. Snapshot
fixtures here are opaque unprotected bytes, not a protected snapshot contract.
SDK0.9 putSnapshot echoes its supplied offset; tests use the server-returned
opaque HEAD token. Full protected snapshot publication/recovery remains pending.

`driveLabPermits` consumes the scoped manual runtime and owns cancellation and
actual native settlement for one finite permit-only run. Record mode grants the
oldest runnable request; replay grants only the next recorded identity, parent
and occurrence. Budget is checked before each permit. Missing/extra entries fail
on completion or explicit caller stop; waiting never pulls a later choice forward.
Caller cancellation closes gates before interrupting an uninterruptible borrower.
No implicit watchdog or protocol deadline is introduced. Counter keys use an
internal JSON tuple without changing recorded parent strings. Labels containing
`|` are refused here to avoid ambiguous parent triples: this is an explicit
compatibility limit. Start/attack/persist/crash actions, full ancestry/entropy
format and captured executor remain unfinished; this is not full replay acceptance.

The pure judge keeps missing observations and partial coverage distinct from pass.
Default baseline is unmeasured; record counts alone never authenticate history.
Measured unauthorized new content is a violation; valid admitted historical content
is retained after revocation. Explicit insider freshness assumptions remain separate.
`makeLabContentTrace` provides run-scoped, bounded private synthetic write facts,
owned before budget checks and returned as immutable snapshots. Clear/close cannot
change another run, and closed traces refuse both writes and observations. These
are typed harness observations, not an attacker-visible log, authorization service
or native custody. Full real measured actors/attack composition is still pending.

The control gateway permits only the settled Recovery exception: authorizing its own
new personal device. Candidate screening binds the stored credential signer and
operation kind; public submission still verifies the whole history, current member
instance, new-device PoP and pinned SDK CAS. Actual fresh possession/bearer HTTP and
released StreamsClient/native SQLite tests retain remote bytes/tail on foreign-member
PoP, forbidden R operations and invalid signatures; revoked R is refused. This is
device registration, not recovery vault, backup, restored content or production custody.

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

Operation release and parent shutdown share the actual child cleanup completion, including failure causes. Tests run one Lab file at a time while preserving the default5s case budget; native/OS-child checks remain real. Exact-head CI and fixed-head independent findings are reported separately.
