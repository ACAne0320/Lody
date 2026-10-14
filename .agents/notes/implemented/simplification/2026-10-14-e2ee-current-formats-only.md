# E2EE supports current formats only

Status: implemented
Translation: current

[中文](2026-10-14-e2ee-current-formats-only.zh.md)

## Abstract

E2EE has not shipped and there are no deployed old ledgers or journals to preserve. The user explicitly removed compatibility and legacy-data migration from scope on 2026-10-14. Current entrypoints support their current format only; unused Lab aliases and old report projections are removed, and compatibility-only source tasks are retired. Normal ledger history, epoch-key recovery and reopening current stores remain required. This decision does not implement or approve any pending replacement protocol.

## Responsibility and findings

The core audit found no legacy-data importer, schema upgrade, multiple-version decoder or old-client fallback in the current stack. SQLite owners either create an empty dedicated store or require their exact application/schema ID. Record, snapshot, content and envelope decoders accept one supported format and reject unsupported input. Existing `v0`/`v1` domain names designate current protocol formats; renumbering or removing them would change authenticated bytes rather than remove compatibility.

The manifest incorrectly retained source `ledger/compat.ts`, `pure/legacy-error.ts` and JSON `pure/journal-codec.ts` as work to port. They are now retired without targets; source fingerprints stay unchanged. Required submission durability remains owned by the current P09 SQLite implementation, and snapshot authority still requires independent trust. Source-era JSON storage is not a new recovery requirement.

Lab removes three unused boolean reference projections and the synthetic-protector fixture re-export. Tests now use allow/deny/unmeasured and the explicit public synthetic protector. Fingerprints remove the obsolete unauthorized-content outside-model projection and unused old report fields; current judgments still report unmeasured observations and measured violations. No old API aliases or data conversion are added in their place.

## Scope boundary

- Keep full/suffix verification, historical author attribution, rollback/fork rejection, exact-byte pending/report retries and native resource ownership. They are needed after first deployment even with one format.
- Keep authenticated epoch history: deriving an older key from a newer installed key is a current sharing feature, not an old-format reader. Its separate product-approval boundary is unchanged.
- Keep generic foreign-format/schema rejection without mutating the input. It is input validation, not compatibility support.
- Keep the registered SDK/HTTP callback bridge; published SDKs actually require Promise callbacks. It neither opens old data nor imports an old ledger.
- Retire the unimplemented metadata-only/prepended-genesis compatibility alternative. Current public P09 already requires full signed control history including genesis; resumable creation/checkpoint durability remains unfinished.
- Remove old-reader/dual-format/capability-pin interoperability requirements from the unapproved D12 draft. Final atomic operation/snapshot encoding, authorization and independent freshness still need review; no new tag/domain is implemented.

The public foundation draft and whitepaper now state the current-only policy instead of directing users to an old experimental reader. The original source/design/candidate and their fingerprints remain untouched. Other draft decisions, including vault/backup/strict B and production custody, are unchanged.

## Verification

Existing reference-policy cases move to the current tri-state APIs without losing role, rotation, unknown-observation or exact retry-byte assertions. Real Loro/Flock, HPKE, SQLite and OS-child tests consume the same public synthetic protector directly. Validation and exact head are recorded in the existing [#1557](https://github.com/LodyAI/Lody/pull/1557) delivery; this cleanup adds no PR and does not merge or enable E2EE.

## Redundant paths removed

The wider follow-up removes the unconsumed volatile key cache, member-only historical-author wrapper and unused identifier/snapshot helpers. Historical identity now uses the existing explicit member/device-only union. Relevant fake-key, revoked-view, rollback/fork and close assertions run on the actual protected store; its missing-row read does not claim to observe a ledger it never queried.

Receiver, distributor and installed-history consumers now borrow one receiver-owned installed-key store instead of opening the same database three times. Capabilities stay opaque and host-only. Borrowers settle before owner close; protection/native leases and final context/readback checks remain.

Content authenticate/open share one owned parsed frame. Seal keeps the exact-message verification already performed by signVerified and removes a second full-frame verify. AEAD, fixed signer checks, captured inputs and pre/post-await permission/prefix checks remain.

Lab removes unused pause/resume/permit-next, freeze/intercept, start-log and Promise-phase paths. Actual SQL/HTTP/ciphertext faults remain in the action executor. Phase parent and scheduler state use the native Effect path. Callback fibers use the fixed-scope LabCallbackRunner only at actual Node/SDK boundaries: host HTTP, SDK protection and fetch response callbacks are its consumers; owner close rejects new work and waits cleanup, and aggregate causes remain visible. Generic Layer initialization and unused runner methods are gone. Gate registration precedes synchronous notification, and the driver retains its first typed failure before closing gates.

Current docs and manifest no longer duplicate intermediate checkpoint counts, live PR pins or source/target hash inventories. All380 source entries, their SHA and original export inventories remain in the manifest; actual-run hashes are captured by the evidence module. Git5ab9394392a3577a76b14ab0552c33f755b3ce48 and fixed reports retain historical evidence. Current Lab parent identities use JSON tuples without a delimiter-compatibility reader. No protocol wire, algorithm, product activation or protocol approval is introduced.
