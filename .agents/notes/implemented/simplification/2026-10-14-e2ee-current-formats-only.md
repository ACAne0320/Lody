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
