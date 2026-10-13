# Epoch keys and host protection

`CLAUDE.md` is a symlink to this file. Edit `AGENTS.md` only.

- Ordinary `./keys`, envelope/content/delivery consumers retain opaque epoch keys.
  Secret-bearing protection callbacks live only under explicit `./keys/host` and
  `./keys/host/sqlite` and `./keys/host/receive/sqlite`, initialized once by trusted
  host composition. Never accept
  per-install arbitrary callbacks, add a generic secret export, or wire production.
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
