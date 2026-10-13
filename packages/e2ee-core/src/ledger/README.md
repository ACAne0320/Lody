# Ledger records and replay

`@lody/e2ee-core/ledger` provides synchronous Effect 4 Result functions. The root
foundation entry remains unchanged. No runtime, network, CAS, journal, snapshot
endorsement, private key or content cipher is introduced.

```text
caller-pinned genesis + expected (head, length) + raw records
  bounded canonical parsing
  predecessor check + P07-a strict signature verification
  Org/member/kind-bound join or possession proof
  permission from preceding state
  private state transition
  expected endpoint check
  opaque verified view
```

`decodeRecord` returns **unverified** inspection data. `hashRecordBytes` and the
three signing-byte helpers compute bytes, never authority. `verifyLedger` audits
from the caller's independently pinned genesis. `extendLedger` accepts only an
actual view returned by this module, clones its private state, and publishes a new
view only after the entire suffix and checkpoint pass. Failure reports the record
position where available and leaves the earlier view unchanged. Inspections are
detached maps of frozen rows with copy-owning P07-a byte wrappers. Reflected
constructors, structural clones and caller-injected verifiers cannot mint views.

The checkpoint is an independently expected **total** record count and head.
It detects missing suffixes as well as chain breaks and unexpected endpoints. A
server's self-reported endpoint is not an independent freshness proof. This module
does not discover the latest global state, bind product workspace IDs, or resolve
forks; callers own those trust and freshness checks. There is no arbitrary-state
starting point in the record/replay entry. The explicit snapshot entry below has
separate qualification and provenance.

Preserved candidate v1 arrays/domains: genesis, admit Member, set role, admit own
device, revoke own device, transfer Owner, publish epoch. Owner/Admin personal
devices may invite and rotate; only Owner personal devices change roles or transfer
Owner. Recovery devices only admit their own personal devices. Revocation affects
only its target, records never create an approval ancestry tree, and Owner retains
a personal/recovery path. Retired signing/encryption keys, member IDs, closed join
requests and epoch commitments remain replay facts. Legacy tag 2 removal is rejected:
it violates the already adopted atomic removal/rotation rule; P12 owns replacement.
No new tag or protocol policy is defined here.

Join `expiresAt` remains a signed nullable field; pure historical replay does not
consult a current wall clock. Online request expiry/admission belongs to a future
host boundary. A valid 72-byte epoch history packet remains opaque; this module
verifies its signed publication and order, not its decryption or key commitment
preimage. `epochHistoryPacket(view, epoch)` returns that signed fact with an owned
packet copy; epoch zero uses an empty previous-key packet. Unknown/future epochs
fail rather than fabricate a key. Decryption belongs to the key workflow.

`historicalContentAuthor(view, device)` resolves the admission-bound user and
member instance, retaining attribution after revocation and role changes. Missing author context fails rather than guessing. Full replay retains original
admission attribution; endorsed snapshots provide their active-device mappings.
`contentPermissions(view, device)` separates current host write admission from
honest new-content sealing: active non-Guest personal/machine devices may write,
Recovery never writes, and a pending rotation additionally blocks new seals.
Permission is relative to the caller-selected verified endpoint; freshness and
scope binding remain caller obligations. Every query requires the module-created
view, not an inspection object. Snapshot endorsement/import uses the separate entry below; delivery uses its
explicit keys/delivery entry. Product integration remains separate.

[Extraction and reproduced defects](../../../../.agents/notes/implemented/architecture/2026-10-11-e2ee-ledger-records.md)
and [source fingerprints](provenance.json). Run package `typecheck` and `test`;
`test/ledger/replay.test.ts` signs fixed synthetic seeds with native Node Ed25519,
independent of the production verifier, and exercises the public ledger subentry.

[Historical facts extraction](../../../../.agents/notes/implemented/architecture/2026-10-11-e2ee-historical-facts.md).

`requireLedgerContinuation(previous, next)` verifies that two real full views share
this exact authenticated prefix using private hashes. It rejects rollback, alternate
forks and fabricated views; it does not discover globally latest state. The scoped
[key cache](../keys/README.md) uses this local relation after observing revocation.

## Ordinary-record signing

`@lody/e2ee-core/ledger/signing` prepares canonical ordinary body CBOR against a
real verified view before any signing. Permission and nested possession proofs use
the same replay checks. `signLedgerRecord` borrows a DeviceSigner and verifies
its output through fixed signature verification and complete ledger extension.
Only registered proposals are accepted; signing bytes and caller inputs are copies.

Execute signing once, then persist and submit the returned original bytes through
the existing submission entry. Re-running signing requests a new signature; the
proposal is not a durable command. The parent is fixed, and a competing suffix
requires CAS conflict handling, never automatic re-signing or rebasing. This entry
does not create genesis, discover freshness, generate/store private keys, or own
transport. Legacy removal remains rejected.

[Signing migration note](../../../../.agents/notes/implemented/architecture/2026-10-11-e2ee-ledger-signing.md)
and [source/destination fingerprints](signing-provenance.json).

## Authenticated permission snapshots

The explicit `@lody/e2ee-core/ledger/snapshot` entry preserves v1 complete-state
CBOR and snapshot/v1/head-attest/v1/snapshot-digest/v1 domains. Caller-pinned
external qualification must include genesis, exact head/count, endorser key,
membership, Owner/Admin role and personal kind. Missing role facts never default
from signed self-claims or journal data. These are externally confirmed facts; the
library checks consistency, not their acquisition or global freshness. An optional
complete-state digest pin supplements, never replaces, that role qualification.

`snapshotTrustFromView` instead derives same-position qualification from a genuine
view into a private token. The snapshot must exactly match its actual complete
state; cloned tokens fail. This path returns that prior view and preserves its audit
provenance. `authenticateLedgerSnapshotEvidence` is the fallback when only identity/
position pins exist: its result is signature evidence with role claims, not a view.

External bootstrap views expose verification=`endorsed-snapshot` and historyStart.
They carry a genuine starting head and verified later hashes using an explicit
offset, without invented pre-snapshot history. `extendLedger` checks every suffix
record and its previous hash/count. Continuation cannot skip an unknown prefix.
Full audit remains `verifyLedger`; signatures/endorsement are not that audit.

`historicalContentIdentity` distinguishes retained original member attribution from
a snapshot-only device with missing history context. The strict author query stays
strict. Current document workflow fallback consumption is still a separate owner.

`signLedgerSnapshot` borrows DeviceSigner, signs/verifies the canonical body and
head attestation, then checks a real continuation and current management eligibility.
Its producer metadata must not be copied into receiver trust automatically.

`compareNotes` returns raw same/conflict/lag results without independent confirmation.
`confirmIndependentComparison` requires a caller-obtained exact tuple from manual
or authenticated-channel confirmation, including actual peer identity. Key lists
and relabeled server notes are insufficient. This confirmation grants no permissions
and upgrades no audit provenance. No new comparison wire/signature domain is added.

[Snapshot decision/evidence](../../../../.agents/notes/implemented/architecture/2026-10-11-e2ee-authenticated-snapshots.md)
 · [Snapshot fingerprints](snapshot-provenance.json).

## Admission consent and ordinary intent

The explicit [`./ledger/admission`](ADMISSION.md) entry adds fixed-verified borrowed signing of joining consent/device possession proofs, genuine-view ordinary command preparation and v1 genesis production from an already retained initial epoch key. Account identity, expiry enforcement, durable key custody, publication and atomic-removal/rotation orchestration remain separate owners.

## Full-history feed and durable position

The explicit [`./ledger/feed`](FEED.md) and `./ledger/feed/sqlite` entries retain
original v1 frames and atomically persist authenticated suffixes with opaque
transport position. They reject repeated records and rollback pages, require a
separately trusted exact endpoint, and retain/await borrowed SDK reads on close.
No snapshot-prefix skipping, submission/CAS replacement or endpoint discovery is
introduced. Local budgets retain history on failure.
