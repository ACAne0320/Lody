# Durable stable-ID repair episodes

The explicit `./keys/mailbox/repair/sqlite` entry adapts repair scheduling from the
original distribution workflow without owning key installation or sender discovery.
Trusted host initialization captures one Org/genesis, recipient, ledger lookup and
borrowed repair capability. Application Scope owns the dedicated SQLite journal.

`enqueue(id, rejectedDigest?)` copies the primitive fields, obtains a genuine
current ledger and derives the exact current epoch/self slot. An active registered Recovery recipient can repair its received epoch-key
envelopes; a revoked recipient cannot enqueue. It saves this stable caller-selected ID and original
fields before any network dispatch. Reusing it with different fields fails replay;
a later loss needs a new explicit ID. This function does not send a request or
claim that a key was installed. The host port preserves source IDs of 1–256 code
units and an optional exact 64-hex rejected digest; no new wire/domain is introduced.

`flush(limit, cursor)` uses finite indexed keyset pages of 1–100 tasks. A blocked
row remains pending; its next hint permits later tasks. Remote repair uses the
saved exact ID and fields outside SQLite transactions. Lost ACK, transport/typed
failure, interrupted work or uncertain local writes retain pending originals.
Actual public mailbox repair acceptance deduplicates that ID, so a retry after
reopen does not create a second revision. A rejected digest asks the host to
exclude that explicit envelope; lost-key repair without a digest retains usable
ciphertext. Repaired only records a local successful repair-ACK attempt, not remote
custody, current possession or installation. No remote status/revision grants ledger
authority. No signature or new cryptographic ACK format is invented.

Only genuine current epoch/recipient disposition terminates Obsolete/Revoked work.
The journal retains a real public checkpoint and rejects observed/persisted rollback
or forks. A local journal pin is not a globally latest claim or trusted role source.
The local APP0x4c455232/v1 file binds one Org/device, uses exclusive 0600 creation,
WAL/FULL and bounded individual row reads. It does not import the retired whole
JSON distribution store or carry secrets/recovery-vault data. Task transitions
check actual writes and read back the terminal original fields in a transaction.

`results(limit,cursor)` returns retained local history; explicit `acknowledge(id)`
marks consumption without deleting the ID binding. Acknowledged IDs cannot be
silently reused for another episode. This is an offline history view, not authority
or proof that a compromised local file has an authentic server ACK.

Scope closure rejects late local ACK mutation and closes its journal. Callers own
cancellation and await of borrowed ledger/transport effects before destroying those
owners. Closing this local store cannot prove escaped transport work stopped. No
Runtime, background loop, automatic retries, native store or production composition
is created. The real receiver/report entry and sender/outbox workflows remain
separate owners.

Owning tests use real signature/replay, real SQLite and the actual public mailbox.
They observe a pending original before dispatch, lost ACK, a real OS child reopen
retrying the same ID, server revision idempotency, rejected envelope exclusion,
original-field replay refusal, registered Recovery repair, fake-view/revocation gates, ignored terminal
writes, 102 tasks/blocked progress and late ACK after explicit Scope close. They
are synthetic local host evidence, not HTTP/native/deployed backend acceptance.
