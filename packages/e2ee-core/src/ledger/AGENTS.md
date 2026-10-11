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
