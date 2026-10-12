# Native Streams token refresh ownership

Status: implemented
Translation: current

[中文](2026-10-12-effect-streams-token-provider.zh.md)

## Abstract

Streams token refresh used a provider-local Promise that fenced publication but
could not cancel or await actual refresh work. One Effect 4.0.2 kernel now owns
credential admission, shared refresh leases and encrypted-cache publication;
Promise callers use one explicitly named Legacy facade. Cancellation of one
waiter preserves other consumers, while replacement/close waits for actual I/O
and retains failed cleanup owners and their complete Causes. Renderer/durable
orchestration and daemon-wide shutdown remain outside this unit.

## Contract and decision

This partially replaces the implementation mechanism in the
[refresh decision](../bug-fix/2026-09-13-streams-token-refresh.md), preserving
its endpoint/workspace isolation, current-credential resolution on memory hits,
terminal 401/403 suppression, last returned token fallback and rejected-token
single slot. A refresh sent before a rejection can make one additional request;
all joined waiters share it. WebCrypto completion checks both the credential
and rejection fences immediately before storage write. Pure schema/encoding and
CRDT work remain ordinary functions. The [existing Spec](../../../../specs/streams-token-refresh.md)
stays draft; no new Spec, protocol, server or deployment is introduced.

The five lifecycle questions are:

- Trigger: a read resolves the current credential, then hits cache or borrows a
  provider-local refresh. Rejection only invalidates the matching served token.
- Owner: provider Scope holds admission/read fibers and an explicit child producer
  Scope; each caller owns its waiter and lease. Raw fetch/body, credentials at the
  registered Legacy boundary, and WebCrypto retain actual settlement receipts.
- Cancellation: waiter timeout/cancellation retires only its read; last-lease release
  aborts and joins the producer. Credential replacement/close cannot replace its
  ownership slot until cleanup is confirmed. Independent admission snapshots are
  fenced by resolution order and remain individually owned until they end.
- Handoff: synchronous generation/credential/rejection fences precede publication;
  close is memoized by Deferred. Failed close retains one receipt and the child
  Scope. Explicit `retryCleanup` joins retained resources before admission resumes.
- Failure/recovery: typed auth, HTTP/credential/response, deadline and interruption
  stay distinct. Auth callbacks map only an all-auth Cause to undefined. Release
  defects retain raw owners; shutdown defects retain the provider and complete
  Cause, including simultaneous timeout/interruption and release failure.

An outer `tryPromise(getToken)` was rejected because it leaves Lody's Promise
coordinator intact. RcMap/FiberMap were considered but do not establish awaited
replacement or failure-preserving cleanup in pinned v4; this finite provider uses
Semaphore, Scope, Fiber and Deferred. Scope.make deliberately retains the child
until explicit successful close, rather than attaching an unbounded auto-close
that would hang after a bounded failed release.

Pinned source evidence: `effect@4.0.2`'s `internal/effect.ts` `raceAllFirst` resumes
with the winning Exit, while its loser-interruption join does not project that
loser's cleanup failure. Deadline therefore belongs on an observation of a read
fiber, followed by a separately owned interrupt-and-Exit join. Raw joins race an
interruptible settlement observer against Clock sleep; the raw operation itself
remains in the I/O registry after the bound. A second Scope.close does not share
its first finalizers, so the provider uses its own receipt.

## Consumers and boundaries

Native API: `LoroStreamsTokens` / `LoroStreamsTokensLive`,
`makeLoroStreamsTokenProvider`, and provider-specific `LoroStreamsTokenPorts`.
The official CLI composition's native token port requires Scope and supplies
native credentials plus signal-aware getCliHttpFetch. Local ports still expose
no cloud token capability, and telemetry stays disabled.

Remaining consumers are renderer workspace/eager-sync auth, CLI durable
streams-access/streams-transport and Machine RPC. They use the one
`createLoroStreamsTokenProviderLegacy` facade and the visible platform
`createTokenProviderLegacy` port/type. The old unqualified factory and Promise
port entry are deleted. Renderer teardown joins close before dropping the
provider; the official CLI root retains Legacy providers through disposal,
retaining failed providers for recovery. Runtime and provider abort signals
are composed instead of overriding each other.

Delete the Legacy facade, compatibility credential adapter and provider-owner
registry once those callers and their application owners compose native Effects.
No upper caller or end-to-end daemon ownership is claimed native merely by using
this kernel. The root roadmap is maintained separately by the coordinator.

## Evidence and limits

Base: `3ac76bad10f46720517a2ca6929f03de4ef5bb9b`. Effect remains 4.0.2;
no manifest, lockfile or submodule gitlink changes. The existing token suite uses
explicit HTTP/encryption/admission signals and TestClock for native workflow
bounds, retaining real WebCrypto encryption/cache regressions. Two old tests
that admitted new work before old raw cleanup now assert the required handoff;
a callback-resolution-count race was replaced by explicit encryption fencing.
Mock-count-only assertions were removed; concurrent callbacks wait for real
admission before releasing HTTP rather than relying on Promise scheduling.

Validation: existing shared auth suite 45 passed; five CLI token/local-only/document
suites 44 passed; renderer runtime/eager/meta and cloud-policy suites 111 passed.
Root `pnpm check` completed typecheck and lint, then failed in the unchanged CLI
child-process suites: 15 failures in `baguette-process`, `guest-buttons`,
`host-controls`, `github-git-transport` and `cloudflared-process` (4026 other CLI
tests passed). An independent checkout of the base SHA with the same locked
dependencies and pinned ACP artifacts reproduced the same 15 failures, using
`pnpm --dir apps/cli exec vitest run` on those five files and `--testTimeout=5000`
to bound diagnosis. Failures include the inherited Git shim's `context_unreadable`,
unavailable simulator fixtures and cloudflared exit/cleanup timeouts. These are
baseline/environment failures, not changed token behavior; Electron tests after
that recursive test step did not execute. The final shared typecheck and root lint
were also run separately after the raw-owner Cause aggregation change.

`pnpm format`, `pnpm format:check`, explicit root Oxfmt on changed shared/docs
files, `pnpm run docs status`, `pnpm run docs check`, i18n, Code Collab, platform,
CLI process and public-boundary guards passed. Initial dependency/submodule and
restricted worker failures were resolved in this unit's clone; no global Git
configuration was changed. Verification children alone stripped inherited
`GIT_CONFIG_*` variables.

In a disposable overlay, baseline and restored auth suites passed. Removing
shared lease protection, raw settlement join, rejected-token storage fence,
late unauthorized matching, credential-after-encryption fence or full raw-owner
Cause aggregation each made its behavioral regression fail. Scripts and logs
remain outside the product/repository.
No live cloud/issuer, production service, npm publication, installed desktop,
Windows/macOS packaging, or whole Session/Turn/durable lifecycle is verified.
