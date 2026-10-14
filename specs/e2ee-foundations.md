# E2EE foundation boundary

Status: draft
Translation: current

[中文](e2ee-foundations.zh.md)

A client receiving encrypted bytes first needs an unambiguous format and a
signature tied to the organization and document it intended to open. The
foundation package provides that check without enabling an encrypted workspace.

The caller supplies the independently trusted organization genesis, document
resource, epoch, purpose and signing public key. None is trusted merely because
it appears in a packet or URL. Content v0 retains `docEpoch = 0`; unsupported
versions and generations fail. Encoding remains fixed: version byte, u32be Org
epoch, u16be document epoch, 32-byte signing key, 24-byte nonce, ciphertext/tag,
64-byte signature. Document context binds genesis and resource; purpose and
optional external binding participate in authentication. The four document
update/snapshot purposes share key-derivation context, not authentication bytes.

Byte wrappers copy public material. Canonical CBOR rejects alternate encodings,
trailing input and unsupported types, with size/depth/array limits. Strict Ed25519
rejects invalid signatures and noncanonical or mixed-torsion signing keys.

Signature validity is only one prerequisite. The root foundation entry does not verify current
membership, freshness, write permission, snapshot history or server admission.
The separate AEAD primitive derives a scoped content key with HKDF-SHA-256 and
validates XChaCha20-Poly1305 tags using caller-supplied context/header and binding.
New encryption requires a secure random 24-byte nonce. Tag validity alone does
not establish author identity or authority. It does not expose a signer, private-key export, platform storage,
transport or production feature switch. Platform custody and full content opening
remain separate work. This draft is not product or all-platform acceptance.

The separate HPKE epoch primitive preserves Base X25519/HKDF-SHA-256/ChaCha20-Poly1305,
info `lody-e2ee/hpke-epoch/v1\0` and canonical four-field ledger AAD. It seals only
a 32-byte epoch key to `enc32/ct48`, accepts externally owned device key handles,
and exposes no delivery or installation workflow. Host secure randomness is
required; async native completion precedes temporary-buffer cleanup and cancellation
completion. Outer signatures, current eligibility and epoch commitments remain
mandatory caller responsibilities; HPKE validity does not establish sender identity.

## Current formats only

E2EE has not shipped and has no deployed ledger or journal data to migrate. Support only the current format for each entrypoint; do not add old-format decoders, dual readers, schema upgrades, legacy imports or compatibility facades. Unsupported formats fail without rewriting their input. Normal reopening of current stores, verified history within the current ledger and epoch-key history recovery remain required. This scope choice does not select any pending replacement format or approve production activation.

## Local epoch protection boundary

A recipient must be able to reopen a durably retained installed epoch key without
requiring its original sender to remain active. Trusted host composition may
initialize one native protect/unprotect capability; ordinary consumers continue
using opaque keys. Native protection binds purpose, Org genesis, recipient, epoch
and commitment together with the key. A compromised host can copy plaintext;
this contract does not claim OS isolation or reversible erasure of those copies.

Installation reporting must follow durable save, actual reload/unprotect and
independent commitment verification. Failure must never claim reported installation.
Native settlement and temporary cleanup precede cancellation/Scope completion.
No plaintext fallback or production composition is allowed. Native adapter choice,
recovery file/wrapping/concurrency and publisher-loss backup remain unresolved
separate decisions. This Spec revision stays draft; accepted boundary direction
and executed synthetic tests do not approve this entire revision or native custody.

[Host contract and validation boundary](../packages/e2ee-core/src/keys/HOST-PROTECTION.md).

## Evidence

[Module and entrypoints](../packages/e2ee-core/README.md),
[fixed vectors and negative cases](../packages/e2ee-core/test/foundation.test.ts),
[source fingerprints](../packages/e2ee-core/provenance.json).
