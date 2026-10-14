# Public E2EE migration

[中文](e2ee-migration.zh.md)

The stack adds an inert public core and a synthetic runnable Lab. E2EE has not shipped; old ledger/data/API compatibility is out of scope. It does not enable product E2EE or migrate production data.

## Source and ownership

The [manifest](e2ee-migration-manifest.json) retains all380 pinned source items, core/candidate hashes and source export inventories. Retired source implementations do not imply retirement of current required behavior. The original source/design/candidate remain read-only. Current dependency pins come from package manifests/lock, not old checkpoint prose.

| Current owner | Responsibility |
|---|---|
| [core](../../packages/e2ee-core/README.md) | Canonical bytes, signatures, ledger facts/permission, fixed crypto and explicit subentries |
| [ledger](../../packages/e2ee-core/src/ledger/README.md) | Full/suffix replay, snapshot qualification, signed ordinary admission and exact expected checkpoints |
| [keys](../../packages/e2ee-core/src/keys/README.md) | Fixed envelopes/history, recipient/repair/report/distribution; one receiver-owned protected store |
| [submission](../../packages/e2ee-core/src/submission/README.md) | Already merged P09 persists original bytes before CAS and reconciles/readbacks without re-signing |
| [content](../../packages/e2ee-core/src/content/README.md) | Header3 update binding and current-author host admission; copied parsed bytes reused within one operation |
| [Lab](../../packages/e2ee-lab/README.md) | Actual SDK/HTTP/SQLite/Loro/Flock/OS processes and finite action/CLI evidence |

## Current formats and simplified implementation

No legacy JSON journal import, schema upgrade, dual decoder or metadata-prefix genesis shim is planned. Current P09 control histories contain original signed genesis. The unused volatile key cache, member-only author wrapper, Promise-phase path and unconnected attack hooks are retired. Unsupported formats fail without rewriting their input. Normal current-format reopen, original-byte retry, historical authorship and backward epoch-key recovery remain required.

[Current-only decision and simplification](../notes/implemented/architecture/2026-10-15-e2ee-current-decisions.md#current-format-only) records the retained scope. [Lab boundaries](../notes/implemented/architecture/2026-10-15-e2ee-current-decisions.md#module-and-validation-boundaries) owns resource and authority boundaries. Earlier step-by-step checkpoints and immutable old-failure evidence remain in Git/linked reports; they are not current completion claims.

## Remaining work

- Resumable workspace creation, independent trusted-checkpoint acquisition and durable host crash/lost-ACK closure.
- Final authenticated content-snapshot position/format and actual authorized history-retention/read APIs.
- Atomic member-removal/new-epoch producer encoding, candidate recoverability/backup exception and recovery vault decisions.
- Exact-original replay entropy and remaining original actor/attack scenarios; pure comparison is not execution coverage.
- Comparison-note authority, strict deadlineB, real native protector and private product wiring.

RestrictedA approves initialization-time protection of verified installed keys only; it does not approve the whole recovery/vault/publisher scope. All linked Specs remain drafts where no complete revision approval exists. The tutorial has a Spec but no application source at the pinned sources. Current author/CI/independent review/production acceptance are separate evidence; test counts and file statuses are not completion percentages.

## Delivery

Use the existing native stack #1490 and PR scope. Maximum24 migration PRs; all remain Draft until explicitly changed by the user. This cleanup stays in [#1557](https://github.com/LodyAI/Lody/pull/1557), preserves earlier heads as ancestors and changes no product activation or release. Accurate head/base and checks live in each PR and fixed delivery report; this page does not duplicate a live pin table.
