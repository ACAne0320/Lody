# Open E2EE contracts and integration work

Status: proposed
Translation: current

[中文](2026-10-15-e2ee-open-contracts.zh.md)

## Abstract

Current public consumers do not complete every whitepaper behavior or establish
production E2EE. Keep unresolved decisions in their existing draft Specs, without
repeating proposed fields in per-PR Notes. Missing integration is tracked separately
from decisions requiring human approval. The [current decision record](../../implemented/architecture/2026-10-15-e2ee-current-decisions.md)
does not approve any item below.

## Decisions requiring review

| Owner | Open boundary |
| --- | --- |
| [Atomic removal](../../../../specs/e2ee/atomic-removal.md) | One removal+epoch record and one CAS are settled; final operation/snapshot encoding and authenticated position are not. No old-client capability or downgrade mechanism is required. |
| [Recovery vault](../../../../specs/e2ee/recovery-vault.md) | Derivation/wrapping, concurrent CAS/reservation, retention and fresh recovery remain draft. Valid old ciphertext does not prove latest state. |
| [Publisher recoverability](../../../../specs/e2ee/publisher-key-recoverability.md) | Independent pre-publication key backup versus accepting the first-delivery loss window remains undecided. Restricted installed-key protection does not approve candidate backup or recover management identity. |
| Snapshot and checkpoint trust | Content continuation position needs authentication; production permission-snapshot qualification/current checkpoint sourcing remain unfinished; explicit qualified read/startup consumers now exist. Existing update binding or SQL caches do not supply those guarantees. |
| Other product/protocol scope | Installed-history product scope, signed comparison notes, strict deadline B and entropy-based exact replay are separate decisions. Secure first sealing and existing ordinary tolerance remain unchanged. |

## Integration still unfinished

The [manifest](../../../docs/e2ee-migration-manifest.json) owns detailed disposition.
Remaining work includes resumable workspace creation/checkpoint durability, a durable
independent publisher backup contract (local durable publication is implemented), protected content snapshots, upstream
history retention/recovery, original model-driven attack/replay coverage, machine
execution and other content consumers, real native protectors and product assembly.
The tutorial has a Spec but no migrated application source. These gaps are not all
new protocol decisions; implement settled work without inventing the unresolved parts.

No pending option is selected here. Notes, source inventories, synthetic tests or
an ancestor's READY/CI cannot grant human approval or production acceptance.
