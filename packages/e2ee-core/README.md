# E2EE foundations

An independently testable extraction, with no production consumers. The root
foundation entry is `@lody/e2ee-core`; it uses the root Effect 4.0.2 catalog.

| Entry                                                    | Responsibility                                                                        |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `Bytes`                                                  | Copy-owning public keys, hashes, IDs, signatures and opaque epoch secrets             |
| `encodeCbor` / `decodeCbor`                              | Bounded canonical array/scalar CBOR; no ledger schemas                                |
| Context/header/AAD/signing-byte encoders                 | Existing content v0 byte domains, document generation zero                            |
| `inspectContentFrame`                                    | Unverified routing metadata only                                                      |
| `verifySignature`                                        | Strict Ed25519 Result; no signing or private-key input                                |
| `verifyContentSignature`                                 | v0 signature against caller-supplied scope and trusted signer                         |
| `deriveContentKey`                                       | HKDF-SHA-256 scoped opaque leaf from `Bytes.EpochKey`                                 |
| `sealContentAead` / `openContentAead`                    | Content v0 XChaCha20-Poly1305 primitive; separate signature/authority checks required |
| `epochHpkeAad` / `sealEpochKeyHpke` / `openEpochKeyHpke` | Fixed Base epoch HPKE primitive; no sender authentication, authority or installation  |

Compose HPKE Effects directly and use `Effect.fromResult` for Result primitives
in existing workflows; this package starts no runtime.
CBOR encoding budgets the expanded wire size before serialization and copies only
bounded data. Shared values remain valid within 8192 bytes; cycles return a Result
failure. These limits bound data traversal, not arbitrary code in getters/proxies.
`verifyContentSignature(frame, trustedScope, trustedSigner, additionalData?)`
checks the supplied organization genesis, document resource, epoch, purpose and
independent binding. It does not decrypt, establish membership, approve a
snapshot, or grant publication permission. A valid signature can cover invalid
ciphertext. `contentKeyInfo` returns derivation context, not derived key material.

[P14](#terms) can consume `Bytes.SigningPublicKey`, `Bytes.EncryptionPublicKey`,
`Bytes.Signature` and the validators from this root entry. Private keys and native
handles stay in the platform owner. `EncryptionPublicKey` preserves the candidate's
32-byte, nonzero wire-shape check; it is not proof of safe X25519 agreement or
possession. Do not use it as one. The root foundation has no signer or key export.
Full signed HPKE delivery, generic non-document content and SDK workflows remain
subsequent slices; no SDK or repo dependency is needed by the foundation.

Historical migration source files and input SHA-256 values are archived at a fixed commit in [provenance.json](https://github.com/LodyAI/Lody/blob/5f97599e60700d6185834632df85922ea0d73ec6/packages/e2ee-core/provenance.json).
Extraction omits ledger/snapshot schemas, trust caches, injected executors,
full signed content workflows and host adapters. The HKDF salt is returned as a
fresh copy instead of shared mutable bytes. Protocol bytes remain unchanged.

Run `pnpm --filter @lody/e2ee-core typecheck` and
`pnpm --filter @lody/e2ee-core test`. Tests include the
[RFC 8032 §7.1 vector](https://www.rfc-editor.org/rfc/rfc8032#section-7.1).
`test/content-vector.json` is a synthetic v0 frame signed independently with
Node's native Ed25519 and the RFC test seed: genesis `11` repeated 32 times,
epoch `0x01020304`, resource `doc`, purpose 1, nonce `22` repeated 24 times,
opaque ciphertext/tag `33` repeated 16 times, optional binding `abcd`.
This fixture tests signatures, not AEAD. Both frames are fixed and native-checked.

See the [Spec](../../specs/e2ee-foundations.md) and
[extraction decision](../../.agents/notes/implemented/architecture/2026-10-10-e2ee-foundations.md)
for trust boundaries, failure ownership and validation limits.

## Content AEAD primitive ([P07-b](#terms))

`deriveContentKey(epochKey, trustedScope)` consumes an opaque `Bytes.EpochKey`.
The returned opaque key owns its bytes and derivation context; it has no public
constructor or export. Four document purposes share a derived leaf. Other purposes
have independent leaves. Every seal/open checks the derivation context and binds
the exact purpose, trusted signing device, header and optional external data in AAD.
Salt, info, big-endian fields and domains retain candidate content v0 bytes.

`sealContentAead(key, trustedHeader, plaintext, additionalData?)` returns only
`{ nonce, ciphertext }`, where ciphertext includes exactly one 16-byte tag. It
obtains a fresh 24-byte nonce from `globalThis.crypto.getRandomValues`; missing or
throwing randomness returns `content-random-unavailable`. No caller nonce or random
source override is exposed. Retain exact ciphertext for retries. `openContentAead`
accepts that nonce/ciphertext and the independently trusted header; it returns
plaintext only after tag verification. Neither function creates a signed frame,
verifies author authority, or checks permission/freshness. Callers must perform
those checks separately before consuming plaintext or publishing bytes.

Inputs are bounded before large copies: plaintext 0..16 MiB, ciphertext 16..16 MiB

- 16, nonce exactly 24 bytes, external binding 0..1024 bytes. Scope/header errors
  retain the existing content codes; malformed nonce/ciphertext have separate codes,
  context-key mismatch is `content-key-scope-mismatch`, tag failure is
  `content-authentication-failed`. Errors contain codes only. Temporary epoch-key
  copies, HKDF PRK, operation key copies and encryption plaintext copies are wiped
  in `finally`; the derived key lasts while its opaque object is reachable. This is
  best-effort JavaScript cleanup, not a guarantee that runtimes erase all copies.

[Fixed synthetic vectors](test/crypto-vector.json) use Python HMAC-SHA256 and
PyNaCl 1.6.2/libsodium with independently encoded v0 bytes. Tests also compare with
native Node/WebCrypto HKDF, cover wrong contexts/keys, tampering, exact limits,
random-source failure and input ownership through the public package entry.
A browser bundle was exercised in Chromium; this is not all-platform acceptance.
See the [extraction note](../../.agents/notes/implemented/architecture/2026-10-11-e2ee-content-crypto.md).

To regenerate the fixture in a disposable Python environment, install `PyNaCl==1.6.2`
and run `python test/generate-crypto-vector.py > test/crypto-vector.json` from this
package. Runtime tests consume the checked-in JSON; Python is not a project dependency.

The separate [`@lody/e2ee-core/ledger`](src/ledger/README.md) subentry now
provides strict records, signature/chain verification and deterministic permission
replay from caller-pinned trust. Snapshot qualification and local submission use
explicit separate subentries; there is no production consumer. Root crypto exports
remain independent. Ledger extraction
fingerprints are [separate](https://github.com/LodyAI/Lody/blob/5f97599e60700d6185834632df85922ea0d73ec6/packages/e2ee-core/src/ledger/provenance.json).

The [submission subentry](src/submission/README.md) adds finite persistent recovery
for existing-ledger ordinary records, with an explicit Scope-owned SQLite Layer.
It calls [P08](#terms) replay before CAS and readback, retains exact signed bytes and
unconsumed results across process restart, and exposes no production host or signer.

## HPKE epoch primitive (P07-c)

`epochHpkeAad`, `sealEpochKeyHpke` and `openEpochKeyHpke` preserve the existing
ledger envelope's Base suite: DHKEM(X25519, HKDF-SHA-256), HKDF-SHA-256 and
ChaCha20-Poly1305 (RFC identifiers 0x0020/0x0001/0x0003). Info is exactly
`lody-e2ee/hpke-epoch/v1\0`, including the final zero byte. AAD is canonical
DAG-CBOR `[genesis32, epoch(u32), senderSign32, recipientSign32]`, supplied from
independently trusted caller context. Plaintext is one opaque 32-byte EpochKey;
output is `enc32` and `ct48`. The existing full envelope remains
`AAD || enc32 || ct48 || signature64`, signed over
`lody-e2ee/epoch-env/v1\0 || AAD || enc32 || ct48`. This slice does not construct,
sign, authenticate, deliver or install that full envelope.

The functions return Effect values with fixed, non-secret errors. Execute them in
the caller's existing Effect owner. Every new seal gets 32 bytes of host secure
randomness for DHKEM derivation, with no public entropy override or retry fallback.
Opening requires a caller-owned X25519 CryptoKeyPair and its independently trusted
expected encryption public key. No private-key generation/export/store is added.
Temporary plaintext and random copies are wiped after native work settles;
interruption waits for that cleanup because WebCrypto has no abort API. This is
not a bounded shutdown guarantee if the host's native crypto never settles, nor
complete erasure of library/native-runtime internal copies.

Base decryption **does not authenticate a sender or grant authority**. Callers must
verify the outer signature, current sending/receiving eligibility, recipient key
binding and epoch-key commitment before using or durably installing the result,
and recheck authority after async operations. Those workflows remain separate.
The primitive exposes no transport, ledger shortcut, recovery format or production
switch. [HPKE tests](test/hpke.test.ts) cover independently encoded RFC/Python
vectors, trusted-context mismatch, lengths, randomness failure and interruption.

## Signed document workflows

The explicit [`./content` and `./signing` entries](src/content/README.md) add
ledger-bound document sealing/authentication/opening and borrowed Ed25519 signing.
They reuse these primitives and require opaque verified views; the root remains
unchanged. Native key custody, generic non-document policy, SDK protection,
distribution, recovery and Lab acceptance remain later migration owners.

## Canonical epoch history

The explicit [`./keys` entry](src/keys/README.md) preserves ledger v1 commitment
and 72-byte history, verifies every reverse link/commitment and supplies an
application-scoped volatile verified key cache. It grants no document-write rights
and supplies no persistence, rotation, delivery, recovery-vault format or backup.

## Local authenticated key mailbox

The explicit Node [`./keys/mailbox/sqlite`](src/keys/MAILBOX.md) reference binds host-authenticated principals, admits fixed-verified current epoch envelopes and pages indexed recipient rows. [`./keys/reports`](src/keys/reports.ts) preserves signed installation-claim bytes. Reports are claims, not custody receipts; distribution/receive persistence and production authentication remain separate owners.

Host-only epoch protection and recipient durable retention use explicit `./keys/host` and `./keys/host/sqlite` entries; see [boundary](src/keys/HOST-PROTECTION.md). The portable root stays unchanged. No production/native assembly, report queue or recovery format is introduced.

The host-only `./keys/host/receive/sqlite` adds [finite install and original-report retry](src/keys/RECEIVE.md), without changing portable root, HPKE or submission. Remote ACK history never proves current key availability or server custody.

The explicit [full-history feed](src/ledger/FEED.md) composes framed SDK reads with
verified ledger suffixes and atomic SQLite position persistence. The original Lab
consumer, submission CAS adapter and snapshot bootstrap remain separately owned.

The explicit [durable repair queue](src/keys/REPAIR.md) binds stable source request IDs before dispatch and retains local ACK history without claiming key installation. Sender discovery remains separate. The host-only [`./keys/host/mailbox/sqlite` facade](src/keys/RECIPIENT-MAILBOX.md) composes actual receive/protection and repair with finite copied fetch pages; failed installation returns no successful next hint. It saves no document/transport cursor and introduces no arbitrary install callback.

The explicit [released-SDK submission adapter](src/submission/STREAMS.md) binds independently verified full history to CAS positions and retains raw non-abortable writes through Scope close. Snapshot bootstrap/provider and actual Lab remain separate.

The explicit [host distribution entry](src/keys/DISTRIBUTION.md) `./keys/host/distribution/sqlite` combines actual receiver/protected-key/outbox owners with finite verified-target sender rounds. It uses already committed keys and preserves original tasks/results/ciphertexts; it does not select backup/rotation/vault formats or enable production.

## Verification work and production limits

Pure Result verification remains synchronous. I/O owners use `verifyLedgerEffect`
and `extendLedgerEffect`: capture bounded originals, yield between batches and
verify signatures with the fixed host WebCrypto Ed25519 backend. The same pure
replay kernel still decides permissions, proofs, chain order and error positions.
Canonical nonzero prime-subgroup A/R and S<L checks remain mandatory. Private bounded
caches retain only exact public-byte mathematical successes; they never cache
membership, current permissions or endpoint freshness. Native backend failures
return `native-unavailable`, not a successful refusal measurement. Native work
settles before owned verification scratch is cleared and interruption completes.

Private ledger maps, sets and hash prefixes use persistent Effect collections;
independent branches share immutable structure. Inspection returns detached maps.
Header3 host admission also has an Effect path and rechecks genuine current write
permission after native verification. Large frames outside the bounded exact-tuple
cache still run the pure strict check; this is not constant-time batch admission.

Full feed reopening remains an O(N) cryptographic audit; cooperative native work
reduces CPU cost and event-loop blocking, not the amount of trusted history needed.
An explicit independently qualified snapshot origin supports read/startup/reopen;
SQL never selects trust. Experimental current tag8 adds atomic member removal and
header4 binds protected content snapshots to their continuation positions.
Production still needs independent qualification acquisition, vault policy, strict
B and actual platform custody. The current publisher protects and durably retains
the candidate, signed record and all post-transition HPKE frames, stages the entire
group and checks exact readback before [P09](#terms) CAS. A conflict discards the candidate;
unknown outcomes resume the same originals. Committed staged recipients can recover
without the publisher's disk. A manager bypassing staging remains a measured key-
withholding limitation. Current tag8 shares that path and excludes all removed
devices. See the [draft contract](../../specs/e2ee/atomic-removal.md).
There is no product consumer or activation change.

Local publisher recovery is explicit under
[`./keys/host/rotation/sqlite`](src/keys/HOST-PROTECTION.md#local-publisher-candidates).
The independent snapshot-origin reader is documented under
[`./ledger/feed/snapshot/sqlite`](src/ledger/FEED.md#independently-qualified-snapshot-origin).
Neither creates a production consumer or changes the portable root exports.


The staging adapter verifies device possession and original signatures and keeps
each group's bytes immutable. Only the original publication-signing device can
delete its group; an account role or occupied-slot claim is insufficient. Honest
clients additionally verify the genuine competing commitment before cleanup.

## Terms

These are work-plan labels, not wire versions or security guarantees.

| Term                       | Meaning                                                                                                                                           |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| P07                        | Byte formats, scoped keys and crypto primitives                                                                                                   |
| P08                        | Signed permission ledger, roles and independently qualified snapshots                                                                             |
| P09                        | Durable original-record submission, CAS and unknown-result reconciliation                                                                         |
| P10                        | Content protection binding for the released synchronization SDK                                                                                   |
| P11                        | Central key delivery, receive, reporting and repair workflows                                                                                     |
| P12                        | Atomic member-removal format, authorization and replay                                                                                            |
| P13                        | Durable preparation, submission and key delivery for atomic removal                                                                               |
| P14                        | Platform key-storage port and desktop/CLI adapters; native acceptance separate                                                                    |
| D12                        | One Owner-personal-signed tag8 removes a non-Owner member and activates next epoch                                                                |
| strict B                   | Proposed strict deadline/freshness enforcement; ordinary token TTL is not approval                                                                |
| RestrictedA / restricted A | Approved initialization-time trusted-host protection of already installed keys; no ordinary key export, identity recovery or native custody claim |

[Atomic removal](../../specs/e2ee/atomic-removal.md) and
[content formats](../../specs/e2ee-foundations.md) remain revised drafts for review.

Migration source records are immutable archive evidence. Current entrypoints,
contracts and explicit production gaps are maintained in these READMEs and Specs;
archiving does not turn old per-file statuses into current acceptance.


## Workspace and recovery composition

`@lody/e2ee-core/workspace` exposes the Scope-owned `E2eeWorkspace` facade:
create/open, ledger commands, staged rotation/removal, finite key rounds, documents
and concrete recovery. All native resources arrive through `WorkspacePlatform.layer`.
The [facade contract](src/workspace/README.md) describes resource ownership and outcomes.
Products must use this facade; low-level exports remain library building blocks.
No product E2EE switch is enabled.

`@lody/e2ee-core/recovery` implements vault-v1 encryption, immutable entries,
encrypted-index CAS, durable setup/restore and rollback pins. Its server/local
storage ports have no hidden platform defaults. See the [draft vault specification](../../specs/e2ee/recovery-vault.md).
The desktop main adapter lives in `apps/electron/src/main/e2ee-custody.mts`;
Web/mobile/CLI custody remains unavailable. Recovery-device secrets are temporary.

Inviter-pinned [snapshot joining](../../specs/e2ee/snapshot-join.md) persists the
qualified snapshot and validates only subsequent records on normal reopen.
`./content/record-boundary` defines the content-blind backend position port;
consumers never parse or order opaque offset tokens.

[Non-gating benchmarks](bench/README.md) emit environment-qualified JSON.
