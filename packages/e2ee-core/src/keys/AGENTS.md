# Epoch keys and host protection

`CLAUDE.md` is a symlink to this file. Edit `AGENTS.md` only.

- Ordinary `./keys`, envelope/content/delivery consumers retain opaque epoch keys.
  Secret-bearing protection callbacks live only under explicit `./keys/host` and
  `./keys/host/sqlite`, `./keys/host/receive/sqlite` and `./keys/host/mailbox/sqlite`,
  initialized once by trusted host composition. Never accept per-install arbitrary
  callbacks, add a generic secret export, or wire production.
- Native protection must authenticate the entire fixed purpose/Org/recipient/epoch/
  commitment/key payload. Disk metadata and an epoch-zero commitment alone cannot
  bind Org. No plaintext fallback, new wire algorithm or recovery format.
- Await non-cancellable native settlement and wipe operation-owned plaintext on
  success, failure and interruption. Application Scope closes admission, waits
  native leases and closes storage; a timeout does not prove native work stopped.
- Record genuine fixed-Org/known-prefix observations before business rejection or
  pin UPDATE. Failed writes retain memory; successful persistence requires one row
  and exact bounded context/head/count readback, without a failed-write reopen claim.
- Save/reload/unprotect/commitment verification precedes any installation report
  queue. Signed reports remain claims. Failed uncertain writes retain originals;
  no implicit delete/replace/legacy import. Durable public authority observations
  do not become document/transport cursors or trusted journal role certificates.
- Host adapters and synthetic Lab protection are distinct. Never access real
  keys/keychains or claim a mock protector establishes native-platform acceptance.

- Recipient receive/report uses actual HPKE/commitment, protected save/readback and
  fixed own-signature verification before queuing original report bytes. A disk
  phase or old report cannot stand in for decrypting a new envelope or current
  protected-key possession. Retry queued bytes without signing again.
- Discovery/repair revisions are remote hints, not ledger authority. Only a real
  current ledger may terminate an epoch/recipient task as obsolete/revoked. Finite
  keyset task pages allow blocked work without starving later tasks; no hidden loop.
- Reported is local remote-ACK attempt history, never server/key-custody proof or
  current key availability. No document/transport cursor is advanced here. Retain
  source/report history and unconsumed results until explicit acknowledgement.

- Repair retains validated observations across failed pin UPDATEs; never dispatch
  via an older view. Successful pin persistence binds exact Org/self/head/count.
- Repair enqueue durably binds stable caller IDs to this Org/device/epoch/rejected
  digest before dispatch; retries never invent another ID. Only genuine ledger
  changes terminate work. Keep original/result rows through explicit acknowledgement.
  Repaired is local repair-ACK history, never key installation or custody proof.
  This Scope owns the journal; callers cancel/await borrowed ledger/transport work
  before destroying those owners. Closure guards reject late local ACK writes.

- The recipient mailbox facade constructs actual receiver/protected store and repair
  queue at host initialization. No arbitrary install callback. Own every fetched
  row before async recheck; validate the whole bounded page before task writes.
  Failed install returns no successful next hint; no durable cursor is saved.
  Failure diagnosis binds the exact owned frame digest and public context while
  retaining the original Cause. No automatic rejection; callers explicitly choose
  stable-ID targeted repair versus retry of local storage/native failures.

- Facade fetch and repair share the receiver’s genuine durable observation boundary
  before eligibility. Rejected revocation remains known; observation writes/readback
  preserve fixed Org/self/head/count, and failure rolls back without forgetting the
  genuine in-memory prefix. Fixed page counts cannot change while row getters run.

- Sender distribution composes the actual receiver/protected store/outbox owners.
  Discover targets from genuine current ledger, not a remote list. Preserve immutable
  outbox ciphertext and every per-revision task/result through explicit acknowledgement.
  Hints only trigger retries; only genuine epoch/revocation changes terminate tasks.
  Exact readback is observation, never installation. Use already committed protected
  keys; candidate backup/rotation/vault decisions remain separately gated.

- `./keys/host/history` borrows installed protected-store capabilities at trusted
  initialization. Recover from the installed latest key only, fixed-verify the
  full history/commitments before writes, wipe owned opaque recovery copies on
  every exit, and preserve validated observations before missing-epoch failures.
  It never restores historical envelopes, publishes epochs, creates reports,
  selects vault formats or grants current writing rights. Storage failures may
  leave safe originals; retries are explicit and idempotent, never deletion.

- Distributor metadata audits use a captured task budget; reaching capacity never deletes originals. Existing terminal/ack transitions remain possible within budget; new tasks are blocked explicitly.

- The receiver constructs the installed store once; host facades forward the same opaque read/save capability. Borrowers do not create/close another owner. No caller-supplied substitute or secret material export.
