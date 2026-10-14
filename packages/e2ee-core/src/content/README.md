# Ledger-bound signed documents

`@lody/e2ee-core/content` migrates the settled Loro/Flock update/snapshot workflow.
It preserves content v0 wire bytes, purpose domains, scoped document HKDF and
XChaCha20-Poly1305. The four document purposes share a leaf but have distinct
signature/AAD contexts. The root foundation remains separate.

`deriveDocumentKey(scope, epochKey)`, `importDocumentKey(scope, bytes)` and
`exportDocumentKey(key)` are synchronous Result functions. A document leaf is
registered in a private WeakMap and bound to genesis/resource/epoch/docEpoch=0;
clones cannot create keys. Import/export own copies and grant no authority.
The supplied epoch key/document leaf must come from the caller's validated local
installation; derivation alone does not verify an epoch commitment. `scopedDocumentKey` derives lazily and releases its independently owned leaf with Scope.
`disposeDocumentKey` is idempotent and invalidates only that leaf, leaving borrowed
epoch keys and independent siblings intact. Owned byte buffers are cleared; this
is not native secure custody or guaranteed physical-memory erasure. Device private keys cannot be exported here.

`sealDocument` returns an inert Effect. Inputs are read and bounded when it runs;
caller-owned scope, plaintext, binding, signer and lookup capabilities are captured
before the first async lookup. The scoped plaintext scratch is wiped after sealing
and on failure/interruption; the caller buffer remains theirs.
The caller supplies a borrowed DeviceSigner and a synchronized verified-view
lookup. Each view must be genuine full replay or explicitly qualified endorsed
state, with its provenance preserved. Later lookups must extend the first verified
prefix; known rollback/forks fail. Sealing binds
the caller's genesis, resource, purpose and current epoch; active non-Guest
personal/machine devices may seal only when rotation is not required. It checks
before encryption and after asynchronous signing, and always verifies signer
output with the fixed strict verifier. No injected verifier/authority can accept
unsigned content. Each run is a new encryption; a transport retry must retain the
returned bytes, rather than rerun encryption. No pending store is introduced.

`authenticateDocument` returns only historical author/signature evidence relative
to that verified view and caller scope. It authenticates revoked admitted authors;
the returned author is a discriminated identity: full available history gives
`kind: member` with the original actor/membership; snapshot replay-prevention
facts for a retired device give only `kind: device-only`, device and
`missing-history-context`. No original user is guessed and no new write right
is restored. This does not establish current publication permission, ciphertext validity, global
freshness or prior host admission. `openDocument` additionally verifies the AEAD
and returns an owned plaintext buffer. Untrusted metadata cannot choose the
trusted genesis/resource/purpose. Context, signature or tag failure returns no
plaintext and never falls back to ordinary bytes. The consumer owns plaintext
cleanup after use. Host admission must independently enforce current permissions.

`@lody/e2ee-core/signing` exposes a borrowed `DeviceSigner`, `signVerified` and
`nativeDeviceSigner`. The native adapter borrows an existing Ed25519 CryptoKey,
creates no identity and starts no runtime. It awaits non-cancellable WebCrypto
settlement and wipes message scratch on success/failure before interruption
completes. The owner retains the handle's lifecycle; cancellable custom signers
must implement cancellation in their Effects. The factory validates key shape;
`signVerified` proves the signature matches its expected public key, not ledger
permission. Neither performs platform-specific secure storage.

Non-document generic content, published-SDK protection/admission, recovery and Lab
composition remain separate migration owners. Canonical epoch history and ordinary
ledger signing now have their own public subentries. Presence/RPC machine-operation scope requires its
own decision. This module does not enable product E2EE or publish a package.

Run package `typecheck` and `test`. The owning crypto suite uses fixed synthetic
Node/native WebCrypto signatures, real HKDF/AEAD and explicit Deferred/native
interruption signals. Crypto completion gating is a stated test boundary; no
sleeps, real keys or physical-device claims are involved.

[Trust decisions](../../../../.agents/notes/implemented/architecture/2026-10-15-e2ee-current-decisions.md#trust-and-authority)
 · [Source fingerprints](provenance.json).

`./content/streams` adds `makeStreamsUpdateBinding`, an Effect-native header3 update
codec typed against published streams-crdt 0.16.2. Its initialization Scope closes
admission, awaits active operations and rejects late output. The independently
selected Org/resource/model/write epoch and fixed signer are captured once. Each
key read must transfer a fresh owned opaque epoch key; the codec verifies its real
ledger commitment before deriving a scoped leaf and clears both after use.
Historical signatures are checked before untrusted frame epochs can request keys.
It contains no Promise runner, production protector or SDK transport. Lab owns the
actual SDK bridge, plaintext disposal after use and transport/native lifetime.
Snapshot writer and its authenticated format remain unimplemented pending the
offset-binding decision; this partial codec rejects snapshots explicitly and
does not count as complete provider migration. See [binding provenance](streams-provenance.json).


Host consumers may use `admitDocument` for fresh writes: a genuine current view,
exact scope and externally authenticated device must qualify; the fixed signature
binds the same author. Historical `authenticateDocument` remains separate.
`admitStreamsUpdateBatch` checks released streams-crdt0.17 framing and header3,
rejecting the entire mixed batch before a host forwards unchanged original bytes.
It does not decrypt, admit snapshots or prove ciphertext usability.
