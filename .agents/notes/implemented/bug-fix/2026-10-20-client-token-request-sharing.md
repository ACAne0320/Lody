# Share client token requests and back off failed ones

Status: implemented
Translation: current

[中文](2026-10-20-client-token-request-sharing.zh.md)

## Abstract

Clients asked the hosted service for the same token more often than their caches
implied. Concurrent or late GitHub 401s each forced a refresh. Two Convex JWT entry
points did not share a request. The CLI credential broker had no in-flight sharing,
and the PR poller asked the cloud on every poll even when it ended up using local
`gh`. Durable sync and Machine RPC also kept separate Streams token kernels. Each of
these now joins one request per identity and scope. A rejection drops a token only
while it is still the cached one. The CLI reuses a failed GitHub answer for at most
30 seconds, so a newly granted credential can take that long to be used without a
configuration signal. Cross-window sharing and production request rates are not
covered here.

## Problem and evidence

Offline reproductions drove the real client modules with synthetic network answers.
The following produced one request per caller rather than one per key:

| Path                                                                | Before                      |
| ------------------------------------------------------------------- | --------------------------- |
| 20 operations seeing a 401 for one personal GitHub token            | 20 refreshes                |
| An old request's 401 arriving after a refresh published a new token | deletes it, refreshes again |
| Convex auth refresh and GitHub `unauthorized` recovery at once      | 2 JWT requests              |
| 20 concurrent broker candidate lookups (`getCredentialCandidate`)   | 20 requests                 |
| Personal identity unavailable, 20 lookups                           | 20 requests                 |
| PR poller with managed tokens unavailable, `gh` working             | one cloud request per poll  |
| Durable sync and Machine RPC cold start for one workspace           | 2 Streams token requests    |

The causes were all local. `getGitHubOperationToken` skipped its cache and in-flight
map when given `invalidatedPersonalToken`. Invalidation deleted by key, not by token.
`cloud-github-token-port.ts` kept its own in-flight JWT promise, separate from the
provider's per-session map. `GitHubTokenManager` cached only successful candidates
and states, and the session and PR poller each created their own manager. The CLI
cloud port built a Streams kernel per consumer.

## Decision

**Renderer GitHub tokens.** Cached, expired and rejected acquisition share one path
in `github-token.ts`. A caller that saw a 401 passes the token it used. The cache
entry is dropped only while it still holds that token, so a late 401 reuses the newer
token. Waiters join the key's in-flight fetch. Only when that fetch was not told
about the rejection and returned the rejected token does one more fetch run, and that
fetch is shared by every waiter with the same rejection. The workspace generation
fence is unchanged.

**Convex JWT.** `lib/convex-jwt.ts` owns the per-auth-client request map. The
mounted provider publishes its auth key (recovery generation, logout intent, session
ID). GitHub recovery joins that key's request and returns null if the intent
generation or key changed before the JWT arrived. Different sessions still never
share a request.

**CLI GitHub tokens.** `createSharedGitHubTokenManagers` gives sessions and the PR
poller leases on one manager per workspace; the last lease shuts it down. Candidate
lookups join an in-flight request keyed like the cache, with the same
rejected-token rule as the renderer. Failures are remembered per partition in both
the candidate cache and the write-token state:

| Answer                                                                                        | Reuse                                 |
| --------------------------------------------------------------------------------------------- | ------------------------------------- |
| Unlinked repository, unavailable personal grant, installation/authorization/membership errors | 30 s                                  |
| Network error, timeout, `token_generation_failed`                                             | 1 s doubling to 30 s, from completion |
| `unauthorized` (CLI login)                                                                    | never                                 |

Invalidation and `invalidateAll` clear remembered failures and fence in-flight
fetches by epoch. A rejection of a token already replaced is ignored. During
reuse the source still fails, and source order, machine eligibility and the
"once per operation" rule are unchanged. The [identity fallback Spec](../../../../specs/github-identity-fallback.md)
now states this; it remains a draft for review. This partly replaces the
"failure is not cached" choice of the [identity fallback note](../architecture/2026-10-03-github-identity-fallback.md).

**CLI Streams tokens.** `streams-token-shares.ts` keeps one kernel per workspace in
the official cloud port. Native and Legacy providers are views of it:

| Question         | Answer                                                                                                                                                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Trigger          | The first borrow builds the kernel in a share-owned Scope; later borrows join it.                                                                                                                                        |
| Owner            | The share owns the kernel; each consumer owns its view.                                                                                                                                                                  |
| Cancellation     | A waiter's interruption releases its kernel lease only. A view's close fences that view and interrupts its reads; others continue.                                                                                       |
| Handoff          | The last close removes the share and closes the kernel. A later borrow builds a new kernel, as a per-consumer kernel did before.                                                                                         |
| Failure recovery | A failed kernel close reports the kernel as owner; `retryCleanup` on any view delegates to it.                                                                                                                           |
| Containment      | A kernel release failure or terminal 401/403 now fences Machine RPC together with durable/presence, which already shared one. Before, Machine RPC never ran `retryCleanup`. The durable attach path now recovers it too. |

## Alternatives considered

- Fixed-interval PR-poll throttling instead of a failure cache would have delayed
  successful managed tokens as well. The failure cache affects only answers that
  would fail again.
- Streams cache sharing through an in-memory storage port would let a late provider
  reuse a token, but simultaneous cold starts would still fetch twice.
- A global token queue would serialize unrelated keys. Sharing is per key.

## Verification and limits

New cases in the owning suites (`github-token.test.ts`,
`recoverable-convex-better-auth-provider.test.tsx`, `github-token-manager.test.ts`,
`cloud-cli-port.test.ts`) use explicit deferred answers and an injected clock. They
assert the requests reaching the cloud boundary and the tokens callers receive. An
ablation against the previous implementations made the key cases fail: 2 of the
renderer cases, 8 of the manager cases and the Streams sharing case.

Not covered: cross-window or cross-tab sharing (stage D needs a platform service
and its own review), one-shot CLI commands (separate processes), Electron main's
own JWT fetch, and hosted-side deduplication. No production request rates were
measured; reductions must be compared by client version after release.
