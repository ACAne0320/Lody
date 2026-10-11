# Exact-byte delivery with a scoped row outbox

Status: implemented
Translation: current

[中文](2026-10-11-e2ee-key-delivery.zh.md)

## Abstract

The old outbox serializes every historical envelope in one JSON document, so its 4096-row limit permanently blocks the next honest delivery. This layer retains exact original ciphertext in individually indexed SQLite rows and adds finite authenticated delivery/resume over the new public envelope workflow. Every send rechecks real ledger authority and saved bytes; uncertain transport preserves pending bytes. It removes the lifetime cap without deleting history, while durable recipient installation and mailbox coordination remain separate owners.

## Responsibilities and choice

Direct parent is envelope Draft #1448, 0a73d464b5c93fab4b4e0f7ce704778ba437ac94. The platform-neutral keys/delivery entry owns routing IDs, fixed envelope reauthorization and one finite put/readback round. It cannot accept an application-provided successful authorization callback as proof. A local prefix observation prevents later lookups within the round from substituting a known older/forked view, including between preparation and sending. The caller still owns independent current endpoint trust and cross-round persistent rollback pins; outbox bytes never supply authority.

The local delivery ID retains the existing SHA-256 truncated-to-16B domain/CBOR formula; it is routing/idempotency, not authorization. A saved frame wins. Preparation occurs only without saved ciphertext; atomic saveOriginal keeps the first committed row when processes race, and every selected frame is independently verified before transport. Unrelated saved rows are not expanded or copied. Each row is at most 512 bytes, stored ciphertext is retained, and no automatic deletion/retention rule is invented. Disk history grows by retained rows rather than one globally decoded document. The old global JSON codec is retired without automatic file conversion.

The explicit Node keys/delivery/sqlite Layer requires an absolute path and create/open mode. Create is exclusive; open never creates a missing/foreign database. Scope owns closure; escaped service use fails closed. SQLite WAL/FULL and immediate first-write transactions persist bytes before network work, without holding a transaction during crypto/network waits. A corrupt oversized row fails locally without rewriting it or blocking another row. The portable entry has no native imports, background task, implicit retry, hidden runtime or production consumer.

Stored means the adapter read back these exact ciphertext bytes, not recipient installation or proof against a malicious server. Only the declared transport error becomes uncertain Pending; validation/defects/interruption propagate. Sender/principal binding and honest-host admission belong to the authenticated adapter. Recovery reports, repair/discovery, mailbox duplicate-flood fix, durable recipient custody, publisher-loss backup and new atomic rotation remain later owners.

## Reproducible evidence

The isolated unchanged candidate's focused 4096-envelope test fails 0/1 with ValidationError:oversize; its source and staged hashes stay unchanged. New real SQLite behavior preserves 4096 historical rows and admits the next genuine signed HPKE envelope, retaining all 4097 originals. Two separate child-process exits occur after outbox persistence/before send and after actual host commit/before response, with no finalizers. A second process resumes the exact bytes with no signer/key supplied to the recovery call. This is process durability for ciphertext, not actual device-loss backup.

The owning suite also verifies first-write immutability across handles, copies, Scope close, wrong/forged current views, locally observed revocation rollback against a deliberately permissive malicious host, bad saved ciphertext, cancellation without Pending conversion, foreign/missing file preservation and per-row corruption isolation. Shared synthetic epoch fixtures are extracted from the existing HPKE suite without removing its behavioral coverage. Package tests 172/172, typecheck and root lint pass; full root check and exact Draft CI are recorded separately. Earlier fixture-only type/lint corrections remain in evidence.

Final 172-test code tree passed full root check with native Git/local IPC. Format, docs and public boundary pass. No final code change followed that validation; exact-head remote CI is reported independently.
