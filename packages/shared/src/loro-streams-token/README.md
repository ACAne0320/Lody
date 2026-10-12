# Streams token provider

`../loro-streams-auth.ts` retains ordinary Zod schemas, encoding, and the genuine
WebCrypto/fetch boundary. `service.ts` owns native credential admission, refresh,
cache publication, shared leases and cleanup. `io.ts` retains raw Promise receipts
until real settlement. `legacy.ts` is the sole deprecated program executor.

`makeLoroStreamsTokenProvider(options)` requires `LoroStreamsTokenPorts` and Scope;
`LoroStreamsTokensLive(options)` builds the equivalent Service. Supply one ports
instance per provider. `LoroStreamsTokenWebLive` composes native credentials,
signal-aware fetch, Clock with the server offset, and optional encrypted storage.
Tests may inject native ports without replacing the coordinator. `requestTimeoutMs`
bounds a waiter, including credential resolution; `cleanupTimeoutMs` separately
sets the base for bounded cleanup (defaults: 30 seconds and 5 seconds).
Raw joins use the base; producer observers allow twice that base and read observers
three times it so the inner bounded finalizer can report its complete Cause first.
Injected raw ports must use a cleanup bound no larger than that base.

Each get owns an admission/read operation and borrows one lease on the shared
refresh. Cancelling one read does not cancel another lease. Last-lease release,
credential replacement and close stop the producer and inspect its actual Exit.
A raw operation that ignores abort keeps its owner and blocks handoff, even if
its Effect fiber has finished with a release defect. `LoroStreamsTokenReleaseFailed`
retains raw settlement/abort capabilities; `LoroStreamsTokenShutdownFailed` retains
the provider and complete Cause. Call `retryCleanup` to join retained work before
retrying handoff/close. Concurrent close shares one Deferred receipt; failed close
keeps that failure until explicit successful recovery. Parent Scope close reports
the same failure and does not silently release the retained child Scope.

The optional cache stays encrypted and partitioned by endpoint/workspace, with
credential and rejected-token publication fences. Its storage/crypto failures remain
cache misses, while interruption and cleanup failure propagate. Auth callbacks map
only a Cause consisting entirely of credential auth failures to undefined.

Renderer workspace runtime, CLI durable transports and Machine RPC still use
`createLoroStreamsTokenProviderLegacy` / `createTokenProviderLegacy`. Renderer
teardown awaits this provider's close, retaining it on failure; the CLI official
cloud composition retains Legacy providers until cloud-port disposal. Native
`CloudStreamsTokenPort.createTokenProvider` places ownership in its caller's Scope.
These are token-provider owners, not completion of upper runtime/daemon shutdown.

Decision, alternatives and evidence:
[owning Note](../../../../.agents/notes/implemented/architecture/2026-10-12-effect-streams-token-provider.md).
