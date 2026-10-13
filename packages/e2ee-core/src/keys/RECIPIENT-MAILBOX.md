# Recipient mailbox integration

The explicit host-only `./keys/host/mailbox/sqlite` entry composes the actual public epoch receiver and stable-ID repair queue. Trusted initialization supplies one signer, recipient native pair, complete protector, ledger lookup and borrowed mailbox capabilities. No arbitrary successful-install callback or copied core exists.

`fetchAndInstall(cursor, limit)` is a finite page of 1–100. It obtains genuine current Org/recipient/epoch authority, captures page fields and a fixed row count, rejects length changes, copies every bounded indexed sender/frame before asynchronous recheck and rejects malformed pages before task/key writes. A changed epoch or revoked recipient fails. Opaque next is only a caller pagination hint, never a saved document/transport cursor or authority fact.

Every copied row follows actual envelope/signature/HPKE/commitment checks and protected save/reload before the original signed report. A later installation failure returns failure without successful page-next; earlier legitimate installations and queued originals remain. Repeating fetch does not replace uncertain pending data or accept an old report as present custody.

Receive/resume/results/report flush and repair enqueue/flush/results/ack retain their owning contracts. Repair never installs a key; a later actual fetched envelope must pass the receiver. Each journal is separately durable; there is no invented cross-database atomicity or recovery-vault format.

Application Scope owns its receiver/protected store/repair journal and closes admission before storage. Callers cancel and await borrowed fetch/ledger/mailbox Effects before destroying those owners; the closed guard refuses late fetch results. This facade creates no Runtime/background worker, retries or production composition. Synthetic protector tests are not real native custody.

Owning tests use real public mailbox, actual HPKE/signatures and SQLite: fetch/install/report, synthetic local key loss and durable repair with retained ciphertext; bad ciphertext retaining Verify and no next including earlier successful install; malformed/oversized/hidden-iterator pages before writes; revocation during fetch; copied bytes across explicit asynchronous ledger signals; captured fetch capability; Scope closure before late fetch. Published SDK/HTTP Lab consumers remain separate unfinished scopes.

Fetch and repair share the actual receiver’s `observeLedger` boundary: genuine prefix validation and transactional original-context/head/count readback occur before recipient eligibility. A rejected revocation remains known, including after journal reopen. Observation failure retains the genuine in-memory prefix while SQL rolls back; it never grants permission or advances a document cursor.

The facade exposes that same `observeLedger` for the [actual sender composition](DISTRIBUTION.md), without a new observer, installer or trust constructor.
