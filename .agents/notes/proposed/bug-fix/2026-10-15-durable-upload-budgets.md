# Durable upload budgets and snapshot scheduling

Status: proposed
Translation: current

[中文](2026-10-15-durable-upload-budgets.zh.md)

## Abstract

Durable POST and snapshot PUT used a ten-second request deadline whose legacy name suggested connection establishment. A healthy large upload could exhaust that deadline, and a snapshot held the room's serialized queue while waiting for HTTP. The proposed SDK change separates token and durable request budgets and captures immutable snapshot bytes with their continuation offset before releasing the room queue. Lody explicitly selects bounded budgets and logs safe snapshot stages, preserving request identity and typed cancellation evidence. Local synthetic verification does not establish a production incident's cause or delivery of a repaired client; adoption depends on official SDK and Repo releases.

## Ownership and decision

The public `LodyAI/Lody` repository owns CLI composition and shared diagnostic projection. `loro-dev/loro-streams` owns request timers, token acquisition, CRDT snapshot capture, encoding and HTTP scheduling. `loro-dev/loro-repo` owns the safe error-context projection between those layers. Product source stays in the public repository; a private composition must adopt a merged public revision separately.

The legacy `connectTimeoutMs` covers control requests through response headers, including dispatcher queueing. It is not a TCP-only measurement. The new SDK API separates `authTimeoutMs` from `uploadTimeoutMs`; the latter bounds request dispatch, body upload and response-header waiting. Lody proposes 10 seconds for token acquisition and 60 seconds for durable POST/PUT, while preserving the control/read deadline. This is a finite total budget, not a progress-resetting idle timeout or a promise that all large documents can upload within it.

Increasing the general connection default would also extend unrelated control operations and would leave the room queue blocked. Disabling snapshots or changing their gap/debounce would avoid some work without addressing the request boundary. The chosen source-layer change retains the existing snapshot thresholds and only holds the serialized room queue while checking completeness and capturing snapshot bytes with the exact covered offset. Encoding and PUT then use that immutable pair outside the queue. A single upload owner prevents overlapping snapshots across room generations; append producer epochs, retry bytes and cursor durability barriers retain their existing owners.

## Safe diagnostics

`snapshotUpload.onDiagnostic` covers permission, auth, HEAD, export, encode and PUT. Each event has a generated snapshot identity, stage duration and total workflow duration from a monotonic clock. Request events add a separately generated request ID, configured budget, HTTP status and encoded body length when known. The request ID is transmitted as `X-Request-ID`, enabling correlation with a gateway that preserves that header. Neither identity authenticates a device or proves that a request reached a backend.

Lody's shared projection selects fields explicitly. It preserves typed source, operation, request phase, `abortKind`, elapsed time and safe offset/request labels. It does not serialize body contents, tokens, headers, raw URLs, arbitrary errors or causes. The normal file logger already collects debug events: successful stages use debug and failures use warn. Auth failure remains distinct from an attempted PUT. A body-complete request with a missing response has an unknown remote outcome; local timeout alone never proves that data was not saved.

## Dependency and verification status

The independent public checkout starts at `a06a69f3e96eec68751ebd4df1d050cbbc4f1cea`, with locked CRDT 0.17.0, transitive Client 0.10.0 and Repo 0.22.0. Official registry versions observed when starting this work were CRDT 0.18.0, Client 0.11.0 and Repo 0.22.0. Those releases do not contain this change. SDK source work starts from canonical main `cbed6ade64382afe34bd696b636f5ac007aa2346`; the separate Repo projection starts from `8e25f7e6963f147751d4d137519ca8c2e0b1c285`.

Formal adoption must update catalog versions, the lockfile and exact release-age exceptions only after the actual releases exist. Local source packages may be used in disposable validation checkouts with hashes and source provenance; they must not be represented as published versions or committed as product dependencies.

The source changes are formal, non-Draft PRs: [Streams #422](https://github.com/loro-dev/loro-streams/pull/422), final head `05a58718cc4d4ad3bc357ab94df1522ffa82dbfc`, and [Repo #151](https://github.com/loro-dev/loro-repo/pull/151), head `ef84de8bc6d0db869c3c94aa74e9fcc99aed4d95`. Both exact-head CI checks passed. Repo passes its complete check (505 passed, 17 existing skips), build and package check. Its three new public-boundary cases fail against the unchanged base and pass after the field projection change.

The same synthetic native-fetch tests were run against canonical SDK base and release-tag source `f81e6037c245d07f8e89849cafbf7c75e4369766` (Client 0.10.0 / CRDT 0.17.0). Each old source has four direct upload-abort assertion failures and three same-room blocking watchdog failures. The latter are runner timeouts, not typed assertion failures. The new 19-case suite passes with real Loro/Flock replicas, owned loopback listeners, explicit gates and virtual request clocks. It covers dispatch queueing, slow progress, stalled requests, auth/HEAD/PUT errors, lost responses, immutable snapshot bytes/offset, retry identity, append/cursor progress, close during encoding and rejoin while an older PUT is still live. A delayed Flock export case protects against accidentally consuming pending updates during a safety check.

The disposable Lody combination passes the complete root `pnpm check` and `pnpm format` with the final source artifacts, including CLI 4,266 tests, components 5,343, shared 1,507 and Electron 220. Its focused suites also pass 81 shared and 50 relevant CLI tests. The initial Electron test attempt waited for a missing binary download; a matching 44.7.0 package cache was copied only into the disposable clone before the successful full rerun. No app was launched. The public checkout has no `check:affected` script. Docs check retains six existing links into excluded Kimi/Pi modules, no errors in changed docs and no protected topics.

Local artifact hashes and exact source revisions are retained outside the repository. This is not a frozen-installed-executable test. Virtual deadlines do not measure real uplink throughput; the synthetic snapshot host closes connections, so proxy and connection-reuse behavior remain untested. No production diagnostics, network load, deployment, client replacement or proxy change is part of this work.
