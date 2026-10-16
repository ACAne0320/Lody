# Verified full-history feed and durable position

`./ledger/feed` contains pure page preparation and a Scope-owned reader for the
released streams-client 0.9 structural read shape. `./ledger/feed/sqlite` owns a
separate full-history local SQLite journal. Neither exports a private key, creates
an account claim, chooses the newest global endpoint or replaces submission/CAS.

The caller pins genesis and independently selects the exact expected head/count.
The remote page's last hash, offset, URL and up-to-date flag do not supply that
trust. Each noninitial record must extend the genuine prior view. Only a new
`-1`, genesis-only full-audit feed may bind its exact genesis occurrence once.
Known records at another position are rejected; no hash-based skipping, unknown
snapshot-prefix skipping or implicit snapshot bootstrap exists. Offsets are opaque;
no numeric ordering is inferred. Empty pages cannot move the committed position.

The reader preserves u32 big-endian length framing, 1–8192 bytes per record. It
joins partial frames across reads and returns only complete boundaries; a final
partial frame fails. One call accepts at most 4096 records/pages and 16 MiB of raw
returned framing. It captures the borrowed read capability at initialization, passes
AbortSignal, retains each request and awaits settlement on cancellation/Scope close.
No Runtime, background fiber or automatic loop is created. Close this Scope before
destroying the borrowed SDK owner. A request that ignores abort and never settles
cannot be forcibly proved stopped; caller SDK composition must configure bounded
transport timeouts. SDK0.9 itself buffers a response before returning it: these
limits do not claim to cap allocation inside that upstream SDK.

The journal uses exclusive 0600 creation, APP 0x4c454632/v1, WAL/FULL and original
record rows. It rejects foreign files and binds one genesis. Open requires an
independently expected endpoint and replays the entire retained signed history;
SQL metadata or old roles are not authority. It is a full-audit journal, not a
permission-snapshot cache or backup/recovery-vault format. It cannot detect a
complete physical file rollback without an external checkpoint pin.

Accept validates the complete page and atomically appends original suffix records
with its position/head/count. Metadata is read back in that same transaction;
ABORT/IGNORE failures roll back additions and position together. A competing handle
with a changed durable tuple fails conflict instead of overwriting it. No network
or signing runs inside SQLite transactions. Returned genuine views are usable only
at the caller-selected endpoint; transport position adds no permissions.

The host explicitly supplies local retention budgets (maxRecords and maxBytes),
within implementation ceilings of one million records and 64 MiB. Exceeding them
fails without deleting committed history or moving the position. They are local
resource budgets, not new wire or account rules. Snapshot-based bounded retention
requires a separate qualified snapshot/cursor design, still unfinished. No legacy
whole-JSON import is hidden here.

`test/ledger/feed.test.ts` covers actual signatures/full replay, initial binding,
duplicate and rollback rejection, partial framing, real SQLite write failures,
stale competing handles, retention failure/close and signal-controlled interruption
that waits for an abort-ignoring borrowed request. Author evidence also exercises
the actual registry SDK over a synthetic local HTTP server and another OS process
reopening the same database. This is not a deployed Streams/backend or original
Lab2 acceptance result. The source Lab2 old failures remain open until its real
session/SDK/SQLite path consumes these entries and is rerun.

Accept checks each actual insertion and reads back only the newly written original
rows, together with the final metadata. This preserves transaction failure and
first-original semantics without rereading retained history on every mutation.

Page copies read bounded array indices and construct fresh typed arrays without calling caller-provided array methods or iterators. The same owned copies are validated, written and retained; later caller mutation cannot alter expected history. An overridden input `.map` neither lends bytes to the journal nor suppresses validation.

The SDK/CAS consuming layer also restores original transport-cycle screening: every partial-frame request tracks seen opaque offsets, and empty responses cannot change position. Complete assembled signed bytes do not validate a repeated intermediate position.

Opening still verifies every retained signed original against the independently
provided endpoint. Native verification may yield outside the SQL transaction, so
metadata must still match the captured position before the view is published.
Normal append validates its owned suffix before acquiring the writer lock, then
checks the known local/SQL head, count and cursor to reject competing updates.

The client and operating system are trusted, as in the whitepaper threat model.
These adapters do not repeatedly inspect SQLite schemas, triggers or external-write
counters, or scan old rows to detect another local process altering the database.
The shared SQLite helper owns exclusive creation, application/version checks,
WAL/FULL setup and fixed meta bindings. SQL remains storage, never authority.
Rollback pins are compared against genuine verified history and advance only when
the verified head/count advances; reads at the same point do not rewrite them.

## Independently qualified snapshot origin

`./ledger/feed/snapshot/sqlite` adds `makeSqliteSnapshotLedgerFeed`. Create/open
requires an explicit genesis, signed snapshot bytes, existing full `SnapshotTrust`
or a genuine same-point token, an opaque origin offset, and an independently
expected endpoint. The offset locates bytes only. No database row selects an
endorser, role, membership or current checkpoint.

Create verifies the snapshot at its exact point. Accept uses the same genuine
suffix/page verifier with bootstrap disabled: it cannot skip unknown prefixes or
deduplicate old records. Original suffixes and position commit atomically, with
final metadata and the newly written row readback in that transaction. Open requalifies the
caller-supplied snapshot and verifies all retained suffixes against the separately
expected endpoint. Unsupported stores are refused without conversion.

The Lab ledger client and authenticated existing-workspace session can explicitly
select this origin. Startup and read-only refresh need no genesis-prefix replay;
P09 writes still independently verify full history through their unchanged remote.
This does not acquire production trust, authenticate an offset inside a new wire
format, enable protected content snapshots, or implement snapshot-only CAS.
