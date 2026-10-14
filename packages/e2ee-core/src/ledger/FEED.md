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

Accept also checks each actual insertion changes one row, reads back its exact original bytes and checks the retained record count/byte total in the same transaction. Ignored or trigger-altered record writes cannot stand in for durable history or advance the position.

After all INSERT and metadata UPDATE statements, accept finally compares every
retained position/record byte with the operation-owned originals from its verified
initial history plus this suffix. This bounded full comparison runs inside the same
transaction with no later DML. Later triggers cannot turn an earlier per-row
readback or equal byte totals into false durable confirmation. The private original
list and published view change only after transaction success.

Page copies read bounded array indices and construct fresh typed arrays without calling caller-provided array methods or iterators. The same owned copies are validated, written and retained; later caller mutation cannot alter expected history. An overridden input `.map` neither lends bytes to the journal nor suppresses validation.

The SDK/CAS consuming layer also restores original transport-cycle screening: every partial-frame request tracks seen opaque offsets, and empty responses cannot change position. Complete assembled signed bytes do not validate a repeated intermediate position.
