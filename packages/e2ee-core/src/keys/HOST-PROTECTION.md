# Host-only durable epoch protection

`./keys/host` initializes a protection capability once in the application's Effect Scope. Trusted composition binds an independently verified Org, recipient and ledger supplier. Ordinary key/content workflows keep opaque `EpochKey` values; they cannot supply a new protect/unprotect callback for each installation. This is an application composition boundary, not isolation against a compromised host. The callback receives secret material and can retain copies; clearing the supplied buffer cannot undo that.

The native capability must provide confidentiality and integrity for the whole payload. The library fixes a local payload consisting of purpose `lody-e2ee/local-epoch-key/v1\0`, genesis32, recipient32, epoch-u32be, commitment32 and key32. All fields are inside authenticated protection; the plaintext is exactly 161 bytes. Open compares the complete context before constructing an opaque key and independently recomputes its commitment. In particular, epoch-zero's established genesis-free commitment cannot let a blob move between Orgs. This encoding is a local protected-store payload, not a mailbox/ledger wire revision or recovery-vault/file format. No encryption/wrapping algorithm or OS backend is selected by this interface.

`./keys/host/sqlite` creates/opens a dedicated 0600 WAL/FULL SQLite store, APP 0x4c45504b/version1. Genesis and recipient are fixed at creation. Foreign files, old JSON schemas and different anchors are rejected before WAL changes; no migration or fallback is provided. The table stores bounded opaque protected blobs indexed by epoch, with insert-only original retention and no lifetime row cap. Each access uses a genuine currently eligible view and checks the last persisted public ledger observation, including after reopening. Disk metadata never grants authority. Corruption fails the affected access.

`saveAndReload` protects a commitment-checked key, persists its blob, loads the actual original row, unprotects it and checks binding/commitment again before returning. A failed or cancelled readback can follow a committed write: retain that original and reconcile instead of deleting or silently replacing it. A conflicting native backend or corrupt retained original requires explicit host recovery; this layer does not define a replacement procedure. This method establishes local round-trip persistence only; it creates no installation report or remote acknowledgement.

Scope closes admission, waits registered native operations and plaintext cleanup, then closes SQLite. Native callbacks cannot be forcibly stopped: cancellation waits their settlement. A stuck native callback remains a stuck shutdown; no timeout is claimed to destroy it safely. Borrowed ledger/transport work is owned and cancelled/awaited by the caller. No Runtime, background fiber, IPC registration, identity generation, platform assembly or production switch is created.

Validation uses synthetic authenticated encryption, real SQLite, independent-process reopen, real signed ledger views and explicit signal-controlled cancellation/close. The synthetic key protector is a mock native boundary, never an OS keychain acceptance result. Windows/Linux/macOS native adapters, secure platform persistence, report queue/retry, publisher candidate backup, recovery vault, Lab integration and all-platform acceptance remain separate owners. No real keychain or real key is accessed.

Restricted A was user-approved on 2026-10-12; [scope and platform gaps](../../../../.agents/notes/implemented/architecture/2026-10-15-e2ee-current-decisions.md#installed-key-protection) remain explicit. Successful open transfers the opaque key; scratch/native-return copies are cleared, not adapter-retained copies. Cold restore of an installed key never requires its sender to remain active. Historical-envelope restore B and production composition are not authorized.

Observe genuine fixed-Org/known-prefix authority before epoch/recipient rejection. Verified observations survive failed pin writes in the same owner. Durable success requires exactly one updated metadata row and exact bounded Org/recipient/head/count readback; rollback never claims cross-process memory. Installed old-key reads after sender revocation remain distinct from fresh envelope acceptance.

## Local publisher candidates

`./keys/host/rotation/sqlite` initializes `makeSqliteEpochRotation` once with fixed
Org, publisher/signer, genuine ledger lookup, borrowed installed store and a
separate trusted native protector. The local candidate payload authenticates its
own purpose, Org, publisher, parent/count, epoch, commitment, record hash, exact
signed record, complete staged-envelope digest and key. It is not the installed-key payload, a mailbox wire change,
a vault or an independent backup. No real platform backend is selected.

`publish` first resumes an existing candidate. Otherwise a current Owner/Admin
personal device observing rotationRequired=true reads its actual previous installed key, generates secure host
randomness, seals the established history packet and signs the existing E7 record.
The protected candidate and complete original envelope group are inserted and
actually read back from SQLite. The staging port atomically saves the whole group
and exact count/byte readback must match before P09 may submit. Concurrent first attempts can generate separate transient candidates;
only the one stored active original may be submitted. No cross-process promise
of a single random generation is made. A retained candidate never regenerates or
re-signs on retry.

`resume` needs no signing operation: it reconciles the exact original through P09.
Committed bytes must be present at the genuine exact position and match the epoch
packet before actual installed save/reload/read verification. Conflict clears the protected candidate and never
installs it. `binding` records the first confirmed local attempt;
later genuine epoch advancement is revalidated without falsifying that history.
`result` is local attempt history, not fresh authorization or current possession.

Explicit `acknowledge` reconciles that same terminal result, acknowledges P09 and
marks the candidate consumed with transactional readback. If the second write
fails, retry the same result; acknowledged public originals remain; a conflicted candidate key is discarded.
The Lab actor persists its real feed before exposing that result for ACK. Close
rejects new operations, waits native settlement and owned-key cleanup, then closes
SQLite. No database transaction spans crypto or network I/O.

After successful staging, a crash resumes the exact same group/record. After CAS,
other recipients do not need the publisher's disk. `receiveStagedGroup` verifies
the genuine committed publication and historical signer before actual HPKE and
current-recipient checks; ordinary mailbox sender policy is unchanged. A direct
CAS that bypasses staging is an explicit key-withholding limitation. `cleanupStaged`
requires a genuine different commitment at that same epoch. No vault/native
protector or emergency exception is selected by these storage operations.

`publishRemoving(membershipId)` uses the same candidate journal and exact-byte
recovery to sign current tag8. Only a current Owner personal device can remove a
non-Owner member. Removal of every target device and activation of the next epoch
are one private transition and one P09 CAS, never two records. It cannot resume an
active candidate for another operation/target under a new intent; use explicit
`resume` for the saved original. Complete envelopes are staged before CAS; they become usable only after verified
inclusion and exclude all removed personal/machine/Recovery devices. History, retired identities
and replay-prevention facts remain authenticated. This encoding is under review;
it does not select an independent backup or emergency-loss exception.
