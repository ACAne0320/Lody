# Public ledger workflows

Follow the package [boundary](../../AGENTS.md) and [record/replay contract](README.md).

- Keep record domains, supported v1 operations and explicit snapshot qualification.
  No arbitrary-state authority, injected verifier or unknown-prefix skipping.
- Admission/genesis lives only under `./ledger/admission`; use fixed borrowed-signer
  verification and existing genuine-view proof/permission gates. Proof is consent,
  not account identity or admission. Producer genesis bytes do not prove publication,
  endpoint freshness, key durability or recovery backup.
- Preserve nullable join expiry; no new strict deadline claim or ordinary tolerance
  change. Reject obsolete RemoveMember/tag2; D12 owns its replacement format.
- Creation borrows already retained key/identity, never generates or stores secrets.
  Capture public fields/capabilities before async work. Do not add secret byte export
  or protection callbacks without the explicitly discussed host trust boundary.
- Prepared ordinary records remain parent-relative; no implicit rebase/re-sign.
  Application Scope owns storage/network/native handles, cancellation and await.

- Full-history feed entries retain original v1 frames and opaque offsets. Only the
  initial exact genesis can be bound once; never skip known records or unknown
  snapshot prefixes. A separately trusted endpoint is required, not inferred from
  remote position. Persist records and cursor atomically; no progress on failure.
  Local retention budgets fail closed, without deleting committed history.
- Borrowed SDK reads propagate abort and are retained/awaited until settlement.
  Close this Scope before destroying the SDK owner. ACK/CAS and snapshot bootstrap
  remain separate contracts; no fallback append or new snapshot header.
