# Lody security assessment (2026-10-11)

Defense-only review of the public Lody tree. This document names controls, gaps, and
remediation. It does not include exploit procedures, payloads, or live secrets.

| | |
| --- | --- |
| Scope commit | `2768e033` on `main` (public repository checkout) |
| Review date | 2026-10-10 |
| Method | Static reading of apps, packages, specs, and GitHub Actions, plus operator facts supplied by the team. Those facts are labeled as such. They were not re-checked against Cloudflare, the private release repository, or a live daemon. No offensive tooling, no production login, no secret extraction. |
| Overall | No Critical issue was evidenced in this tree. The shipped OSS desktop is a local agent with a deliberately narrow cloud boundary. The highest practical risks are a network-reachable Git credential broker, plaintext CLI cloud credentials, and trust boundaries that live in hosted services this repository does not contain. |
| Location | Repository root `SECURITY_AUDIT.md`. A root `docs/` directory is rejected by the public-boundary check, so this assessment does not live under that path. |

Severity here combines impact and how often the precondition is realistic. Likelihood is stated separately. Items marked **hypothesis** were not executed.

## 1. Scope and architecture

### In scope

- `apps/cli` — local daemon, sessions, MCP, preview, Git credential broker, managed runtimes
- `apps/electron` — desktop shell, IPC, renderer CSP, local file capabilities
- `packages/components`, `packages/ui`, `packages/shared`, `packages/platform`, `packages/cloud-api`, `packages/loro-streams-rpc`
- `site-docs` — public documentation site source
- `.github/workflows` — CI, release, PR policy, E2E, nightly notification

### Out of scope (not in this tree)

Hosted account, billing, share-storage, machine-lifecycle, and Streams-token services; organization settings; production headers and WAF; secret stores; installer signing, notarization, and object-storage credentials. Those live with the private release repository, not in this public tree. Findings about them are residual risks, not confirmed defects.

### Operator context (team-supplied, not re-verified here)

These points came from the team's ops notes. This review treats them as architecture facts, not as a vulnerability list.

- Public product source is `https://github.com/LodyAI/Lody`. The homepage is `https://lody.ai`.
- Nightly and Stable packaging and signing run in the private release repository `https://github.com/loro-dev/lody`. This public repo is the notify and submodule source only. It intentionally does not hold signing or object-storage credentials (`.github/AGENTS.md`).
- The OSS nightly job dispatches with repository variables `NIGHTLY_DISPATCH_*` and the secret `NIGHTLY_DISPATCH_APP_PRIVATE_KEY`.
- The marketing site is Cloudflare Pages built from that private repo's `lody-oss` submodule. It is not live-synced to public `main`.
- Update feeds are `https://updates.lody.ai/production/` and `https://nightly-updates.lody.ai/production/nightly/`.
- Clients are Electron Stable and Nightly (separate app ids), the CLI/daemon, and MCP.
- Vulnerability reports go through GitHub Security Advisories only (`SECURITY.md`).

### Sketch

```text
Electron renderer
  contextIsolation, no nodeIntegration, allowlisted IPC
        | Unix socket / named pipe (per-user, mode 0700 on Unix)
        v
CLI daemon (local platform by default)
  control plane: HTTP over user socket, header gate, Zod, machineId match
  data plane: Loro JSON lines on a second user socket
  MCP HTTP: 127.0.0.1 + bearer; Linux also checks peer uid
  Git broker: 0.0.0.0 ephemeral port + bearer  (cloud GitHub sessions)
  Preview: loopback targets only, capability tokens
        |
        | optional, non-OSS composition
        v
Hosted account / Streams / share / machine verify
  Electron cookies via safeStorage; CLI token in credentials.json
  Streams JWTs cached in renderer localStorage (AES-GCM obfuscation)
```

OSS desktop composition is local-only. It must not discover deployment env files, start authenticated product-cloud clients, or enable telemetry. Public managed-runtime downloads are the documented exception. Optional cloud behavior is selected by platform capabilities, not by a shared package forking into a private backend.

Trust model for the default desktop: the OS user who runs the daemon is trusted. Same-user processes can reach local sockets. Remote parties are not on that trust boundary unless a feature explicitly publishes a port or a share link.

### Auth and data, as implemented here

| Surface | What this repo shows |
| --- | --- |
| Desktop login | Better Auth in Electron main, PKCE/browser callback owned by main, cookies through `safeStorage` when cloud composition is on. OSS must not exchange cloud credentials. |
| CLI cloud token | Long-lived bearer written as JSON by `saveAuthInfo`. Unix mode `0600` after the write. No OS keystore on this path. |
| Device / machine pairing | Client calls a hosted device flow and pairing-token prefix. Verification of those tokens is not in this tree. |
| Local daemon | User-scoped socket plus `x-lody-local-control: 1`. That header is a constant, not a secret. |
| Streams | Short-lived JWTs from a hosted issuer. Renderer cache is encrypted with a key derived from the workspace id and the current auth token. Comment in code: obfuscation at rest, not an XSS boundary. |
| Machine RPC | Transport authenticates the stream, not the `requesterUserId` field. Callers must authorize upstream. Session rules forbid sending an untrusted requester through that RPC. |
| Session share | Random 32-byte bearer in the link fragment. Spec: the bearer is an access credential, not a decryption key. No sharing E2EE format in this version. |
| E2EE UI | Presentational prototypes. Rules forbid production crypto wiring. |
| Data at rest | Local SQLite, Loro documents, session files under the installation data dir. Remote workspace sync is a hosted concern. |

### Third parties touched by this tree

Coding-agent runtimes (managed archives with pinned hashes), GitHub (credential broker and PR poller), optional analytics on the docs site, public artifact distribution, and GitHub Actions. No Terraform or cloud IAM documents are in the repository.

## 2. Findings

### Critical

None evidenced in the public tree. A Critical would require a demonstrated path to account takeover, cross-tenant data access, or secret disclosure that does not depend on hosted code this review could not read. That bar was not met here.

### High

#### H1. Git credential broker listens on every interface

| | |
| --- | --- |
| Where | `apps/cli/src/lib/git-credential-broker.ts` (`GitCredentialBroker.start`, `createGitCredentialBrokerHandler`, `writeBrokerStateFile`) |
| Impact | A caller that presents the broker bearer can ask the daemon to resolve GitHub credentials for the broker's session context. The listen address is `0.0.0.0`, so the ephemeral port is not limited to loopback or to the Docker bridge the comment describes. |
| Likelihood | Low for an unauthenticated remote caller: the bearer is 32 random bytes, state files are opened with mode `0600`, and `/health` does not return the token. Medium on a host with containers, a permissive firewall, or another local principal who can read the daemon environment or the state file. |
| Evidence | `server.listen(0, '0.0.0.0')`. The process copies the URL and token into `process.env`. `writeBrokerStateFile` writes `{ url, port, token }` to the shared `broker.json` and to a per-workspace file. Authorization compares the header with ordinary string equality, unlike the MCP host which uses a constant-time compare. |

The shared `broker.json` is last-writer-wins across workspaces of one fleet process. Per-workspace files and per-call broker arguments exist so host git does not follow that ambient value. The shared file remains for containers and restart recovery. A reader of the shared file can still land on whichever workspace wrote it last. That is a cross-workspace credential-routing hazard, not only a network one.

**Remediation**

- Bind to loopback by default. Publish a non-loopback listener only behind an explicit operator flag, or give containers a Unix socket / user-namespace path instead of `0.0.0.0`.
- Stop copying the broker token into the daemon-wide environment. Pass it only on the git helper's environment, which the worktree path already knows how to do.
- Compare the bearer with `timingSafeEqual` on equal-length buffers.
- Treat the shared state file as legacy: stop writing the token there once every container path uses the per-workspace file.
- Confirm host firewalls do not accept inbound connections to ephemeral daemon ports.

### Medium

#### M1. CLI cloud credentials are plaintext JSON

| | |
| --- | --- |
| Where | `apps/cli/src/lib/auth.ts` `saveAuthInfo`; path from `apps/cli/src/utils/const.ts` (`credentials.json` under the data dir) |
| Impact | Anyone who can read that file holds a long-lived cloud API token, user profile, and machine id. Backups, same-user malware, and a world-readable data directory all qualify. |
| Likelihood | Low for the OSS desktop, which is not supposed to perform authenticated cloud calls. Medium for cloud CLI builds and for any machine that has logged in with `lody login`. Windows never applies the Unix mode. The `chmod` is best-effort after `writeFileSync`, and a failure is swallowed. The parent directory is created with default permissions. |

Electron cloud cookies go through `safeStorage` (`apps/electron/src/main/auth-storage.ts`, `auth-service.ts`). The CLI file does not.

**Remediation.** Store the CLI token with the OS keystore (or encrypt it with a key the OS holds). Create the file with mode `0600` in the write itself, and set a restrictive ACL on Windows. Fail closed if the permission change fails. Keep the data directory `0700`.

#### M2. Machine access trusts a requester id the transport does not prove

| | |
| --- | --- |
| Where | `apps/cli/src/lib/message-handler.ts` `verifyMachineAccess`; `packages/platform/src/local.ts` `createLocalCloudPort`; `apps/cli/src/commands/session.ts` `readDelegatedMachineAccess`; `apps/cli/src/session/AGENTS.md` |
| Impact | If the claimed `requesterUserId` equals the daemon's user id, the daemon allows the call and does not ask the hosted checker. On the local platform the same comparison is the entire check: the catalog user is allowed and everyone else is `requester_not_member`. A peer who can submit that field as the owner skips membership and project checks. Session rules already say not to send an untrusted requester on workspace Machine RPC, because the stream does not authenticate the field. |
| Likelihood | Evidenced in the client. Whether a remote workspace member can place that field on a Machine RPC is a **hypothesis**: the gateway is not in this tree. Same-user local sockets can, which matches the desktop trust model. Delegated MCP checks both the CLI account and the driving human, and denies the cross-user case when the hosted combined query is missing. Preview control and machine lifecycle still call hosted verify on the paths that were read. |

**Remediation.** Treat the owner short-circuit as safe only for requests that already ran on the daemon's own authenticated turn. For Streams-delivered RPC, ignore the body user id and use the subject the gateway put on the stream. Keep one allowlist of methods that may run without that binding. Confirm the hosted checker does not accept a client-supplied owner id either.

#### M3. A published share link is a bearer for plaintext content, and agents receive the full URL

| | |
| --- | --- |
| Where | `specs/session-sharing.md` (status: draft, no linked human approval); `packages/shared/src/session-share-credentials.ts`; `packages/components/src/lib/session-share-secrets.ts`; `packages/cloud-api/src/session-sharing.ts` |
| Impact | Anyone with the link secret can read the published package. The bearer is an access credential, not a decryption key, and this version has no sharing E2EE format. After a human approval, MCP delivery returns the complete URL to the requesting agent. An agent log or later tool call can disclose it. Revoke and reset cannot recall bytes already downloaded. |
| Likelihood | By design once a user approves publication. The approval card must say the agent receives the URL. Cross-account MCP delivery is specified to fail. The spec calls the feature an in-progress cutover: portable client and management UI exist; hosted deployment acceptance is not established by this repository. Sharing rules say not to deploy until the anonymous reader, MCP confirmation, GC, and integration fixtures switch together. |

The lifecycle the client and spec implement is in section 3. The control-plane DTOs do not return the credential or its hash. The raw secret is stored on the device and sent to the share API only as an Authorization header.

**Remediation.** Keep the approval copy. Prefer a handle the agent cannot dereference, and show the URL only in the authenticated app. Confirm hosted object storage has no public bucket URLs, that revoke overrides the retired-deployment grace interval, and that the 24-hour agent-link lifetime is enforced on the server. Do not describe this path as encrypted.

#### M4. Most GitHub Actions are version tags, not commit SHAs

| | |
| --- | --- |
| Where | `.github/workflows/ci.yml` and the other workflows (`actions/checkout@v4`, `pnpm/action-setup@v4`, `actions/labeler@v6`, and similar). Exceptions that are SHA-pinned include `actions/create-github-app-token` in `notify-desktop-nightly.yml` and the policy's rule for actions that receive signing keys. |
| Impact | A retagged or compromised action can run in CI with the job's `GITHUB_TOKEN`. Code CI is `contents: read` and `persist-credentials: false`, which limits the blast radius. `release.yml` and the E2E failure reporter have write permissions. |
| Likelihood | Low for first-party `actions/*` today; non-zero as a standing supply-chain exposure. CI also runs `pnpm install` and tests on pull-request code. Fork PRs should not receive repository secrets; that org setting was not visible from the repo. |

**Remediation.** Pin third-party actions to full SHAs and bump them with a bot. Add Dependabot or Renovate for GitHub Actions and npm. There is no `.github/dependabot.yml` today. Keep `minimumReleaseAge: 10080` in `pnpm-workspace.yaml`.

#### M5. Nightly workflow can start Actions in another repository

| | |
| --- | --- |
| Where | `.github/workflows/notify-desktop-nightly.yml` |
| Impact | A malicious commit on `main`, or theft of `NIGHTLY_DISPATCH_APP_PRIVATE_KEY`, can `workflow_dispatch` a destination workflow with an App token that has Actions write on that one repository. The destination can then run whatever that workflow is allowed to run. |
| Likelihood | Low. The job is gated on the repository name and `vars.NIGHTLY_DISPATCH_ENABLED`. Permissions on this workflow are empty. The token action is SHA-pinned and limited to one owner/repository. Checkout is not performed. |

**Remediation.** Keep the GitHub App installed on only the destination repository. Require a human merge before any release artifact is published there. Alert on unexpected dispatches. Rotate the private key on a schedule. This workflow cannot be fully judged without the destination workflow, which is not in this tree.

#### M6. Product Electron window disables the Chromium sandbox

| | |
| --- | --- |
| Where | `apps/electron/src/main/window.ts` `webPreferences`: `sandbox: false`, `nodeIntegration: false`, `contextIsolation: true`. The public browser view in `public-browser-service.ts` sets `sandbox: true` and has no preload. |
| Impact | Renderer code execution reaches a larger Chromium and preload surface than a sandboxed renderer would. Preload exposes only `invoke`, `on`, and `send`, with an allowlist. |
| Likelihood | Depends on a renderer bug (XSS, compromised dependency, malicious workspace content that escapes the sanitizer). Not a default remote compromise by itself. |

**Remediation.** Track enabling `sandbox: true` for the product window, or document the preload constraint that blocks it. Keep IPC validation at the service boundary. Do not widen the preload.

#### M7. User-configured HTTP MCP servers are an SSRF-shaped client

| | |
| --- | --- |
| Where | `apps/cli/src/commands/mcp.ts` (HTTP MCP URL from configuration). Rules in `apps/cli/src/mcp/AGENTS.md` say `lody_mcp_configure` may act only on an explicit user request, creates new random ids, and must not echo credentials. |
| Impact | The daemon can be pointed at an internal HTTP service (metadata endpoints, loopback admin ports) if a person or a confused agent saves that URL. |
| Likelihood | Hypothesis for a malicious config. The configure tool's prompt-injection limits are specified; this review did not re-prove every call site. Ordinary operator configuration of a remote MCP server is a feature. |

**Remediation.** Block link-local and cloud-metadata addresses unless an explicit flag is set. Keep the "repository content cannot configure MCP" rule tested at the tool boundary.

#### M8. Devbar is a local control plane when enabled

| | |
| --- | --- |
| Where | `apps/electron/src/AGENTS.md` and `apps/electron/src/main/services/devbar/` |
| Impact | Developer Mode or `LODY_DEVBAR=true` exposes MCP and terminals on loopback. A page that satisfies the origin check could drive local execution. |
| Likelihood | Low by default (off). Higher on automation machines that set the env flag and then browse untrusted content in the same app. |

**Remediation.** Keep the default off. Require the per-process token for every non-app origin, including opaque origins. Do not enable it in packaged stable builds.

### Low

#### L1. Local control and Loro sockets trust the OS user

`apps/cli/src/lib/local-session-control.ts` requires `x-lody-local-control: 1` and a matching `machineId`. `apps/cli/src/lib/local-loro-data-plane-server.ts` has no second bearer. Unix run directories are mode `0700` (`packages/shared/src/node/local-ipc.ts`). Windows named pipes rely on the default owner ACL; comments say Node cannot set an explicit DACL.

Impact is same-user compromise, which already implies the daemon's files. Likelihood is high only after local malware. Remediation: keep the socket inside the user directory; do not add a TCP listener for these planes. On Windows, set an explicit pipe DACL if the runtime grows a supported API.

#### L2. Streams JWT cache is not an XSS boundary

`packages/shared/src/loro-streams-auth.ts` `deriveTokenStorageKey` documents AES-GCM as obfuscation. The key is derived from data the renderer already has. A renderer XSS can decrypt the cache. Remediation: treat any XSS as token theft; keep CSP and markdown sanitization tight; prefer memory-only cache if logout semantics allow it.

#### L3. Agent-controlled Mermaid SVG is inserted as HTML

`packages/components/src/components/ai-gui/markdown-mermaid-block.tsx` uses `dangerouslySetInnerHTML` for diagram SVG. `markdown-mermaid.ts` sets Mermaid `securityLevel: 'strict'`. Markdown generally uses `rehype-sanitize`; raw HTML is opt-in. Residual risk is a sanitizer or Mermaid bypass into the app origin. Remediation: keep the strict level, and render diagrams in a sandboxed frame if the dependency advisory history worsens.

#### L4. Renderer CSP allows inline styles and any loopback port

`apps/electron/src/renderer/index.html` sets `default-src 'self'`, a hashed boot script, and `script-src` without `unsafe-eval` (it does allow `wasm-unsafe-eval`). `style-src` includes `unsafe-inline`. `connect-src` and `frame-src` allow `http://127.0.0.1:*` and `http://localhost:*`. That is required for local preview and the daemon, and it also means a renderer bug can talk to any loopback port. Remediation: keep script-src hashed; narrow `frame-src` to preview ports if the product can.

#### L5. Managed runtime mirrors may use cleartext HTTP

`packages/platform/src/runtime-artifacts.ts` and `apps/cli/src/agent/managed-agent-runtime.ts` accept `https:` and `http:` for an explicit base-URL override. Archives are checked with sha256 and size before use (`sha256File` against the pinned manifest). A cleartext mirror can observe downloads and waste bandwidth; it should not substitute a different binary unless the pin is also wrong. Remediation: reject `http:` outside a documented dev flag.

#### L6. Local file capabilities send `Access-Control-Allow-Origin: *`

`apps/electron/src/main/services/local-file-resource.ts`. URLs are opaque capabilities, not paths, with a per-renderer cap and a CSP of `default-src 'none'; sandbox`. A leaked capability could be fetched by another origin that can use the custom scheme. Remediation: omit `*` if no cross-origin reader needs it, or reflect a single allowed origin.

#### L7. E2E failure workflow grants `contents: write`

`.github/workflows/e2e-pr-reconcile.yml` has `contents: write` plus `pull-requests: write`. The job's purpose is to comment with failure evidence and uses a checksum-pinned `gh` binary. Extra content permission is unnecessary if the job never pushes. Remediation: drop `contents: write` if a permission audit confirms it is unused.

#### L8. Operator-widened file preview roots

`apps/cli/src/lib/file-preview/file-preview-path-policy.ts` allows the session workspace, the OS temp directory, the chat subdirectory of the data dir, and `LODY_FILE_PREVIEW_EXTRA_ROOTS`. The data-dir root is intentionally excluded because it holds `credentials.json` and broker state. Symlink targets are checked after resolution. `file/resolve-local` is a same-machine Electron capability and is not a Streams method. Remediation: log when the extra-roots variable is set; do not let an agent set it.

#### L9. Docs site loads third-party scripts

`site-docs` root route loads analytics and can include another script when a build-time public key is present. Production response headers (CSP, HSTS, framing) are not in this repository. The local static host does not set them. Remediation: set CSP and HSTS on the production host; avoid putting privileged keys in the client bundle.

#### L10. Nested macOS entitlements disable library validation

`apps/electron/build/entitlements.mac.inherit.plist`, documented in `apps/electron/AGENTS.md`, so unsigned native addons in the embedded CLI can load. Top-level entitlements stay strict. This is an accepted packaging constraint. Remediation: keep the after-pack probes, and do not copy the nested entitlement onto the outer app.

### Informational

#### I1. E2EE components are not a product cryptosystem

`packages/components/src/components/e2ee/AGENTS.md` forbids production entry points and crypto services. Workspace stream E2EE is out of scope in the sharing and streams specs. Do not describe the desktop as end-to-end encrypted on the basis of this UI.

#### I2. Static HTML preview is scripted but origin-isolated

`managed-preview-frame-cache.ts` sets `sandbox="allow-scripts"` without `allow-same-origin` for untrusted documents, plus `credentialless`. Managed app preview uses a wider sandbox because it is a separate endpoint origin. The iOS simulator viewer allows scripts and same-origin for its own viewer page (`ios-simulator-viewer.tsx`). Keep static documents on the strict sandbox.

#### I3. Preview proxy is loopback-only

`apps/cli/src/preview/preview-service.ts` rejects non-loopback targets. Remote viewers still reach approved loopback dev servers on the agent machine. That is a product privilege, bounded by capability tokens and signed control proofs. It is not an open SSRF relay to the public internet.

#### I4. Auth redirects are allowlisted

`packages/components/src/lib/auth-redirect.ts` allows same-origin targets and `https` on the product registrable domain, and rejects `javascript:`, `data:`, and cleartext product URLs.

#### I5. No inbound webhook verifier in this tree

PR status polling compensates for hosted GitHub webhook fan-out (`apps/cli/src/lib/pr-poller/`). Signature checks for inbound webhooks were not found under `apps/`, `packages/`, or `site-docs`. If those endpoints exist, they live in the hosted service.

#### I6. No committed live credentials

Secret-shaped strings that turned up are synthetic fixtures (redaction tests, Storybook). No cloud-provider access-key prefix or PEM private key was found in tracked product source. This is not a scan of git history.

#### I7. Prompt-injection and agent authority are product boundaries, not a single bug

Agents run tools, shell, and git inside a workspace the user opened. MCP rules require the active turn user to match the CLI account, forbid echoing MCP credentials, and limit feedback uploads to suggestion text plus version and platform. Those are strong controls. A malicious repository can still try to steer an agent that the user has authorized to act. Treat workspace content as untrusted input to the agent, which the product already documents in the MCP configure rule.

## 3. Deepened boundaries

### Session-share bearer

| Step | What the public client and spec say |
| --- | --- |
| Create | A workspace writer publishes conversations they can read. A human action in the authenticated app freezes the package, then uploads and commits. There is no publication preview. MCP may request a share and must not approve it. |
| Secret | The client draws 32 random bytes (`createSessionShareSecret`). The link is `/s/<shareId>#access=v1.<64 hex>`. The parser accepts that fragment only, not a query parameter. The control plane is specified to store a hash, and recipient-encrypted ciphertext for approved MCP delivery. It must not receive the raw secret. |
| Scope | One static copy. Later source edits do not change it. Update replaces the deployment and keeps the same secret. The set of conversations is explicit and capped (32 children on the client). Future children do not join. Sharing does not authorize the source workspace, original stream, or agent runtime. Typed files are omitted while the attachment switch defaults off; images are copied, with a 64-image / 20 MB each cap on new shares. Known share-capability fragments in captured history are rewritten to `#access=omitted`. That is not general secret detection. History text is published as-is. |
| Where the secret lives | Device `localStorage` key `lody:session-share-secret:v1:` plus user, workspace, and share id, with a credential version. It is plaintext. Ordinary cache clear keeps it. It is not written to Flock. A missing local secret requires reset; the cloud copy is not a recovery path. Upload secrets stay in the editor and are not persisted. The anonymous reader keeps the opened deployment in memory and must not write the share to durable storage or open a workspace Repo. |
| Reset | Rotates the secret. Does not rebind ownership. |
| Revoke | Publisher may revoke their own share. Administrators and owners may revoke others' shares and may not read those link secrets or take over publication. Revoke disables every deployment and overrides the grace interval for a retired deployment. Cancellation of an unfinished MCP request does not revoke a published share. Removing the publisher's membership, account, or workspace disables access. A replacement membership does not revive it. Source deletion does not delete the published copy. |
| Expiry | The share link itself has no client-side TTL; it lasts until revoke, reset, or membership loss. Copy Agent Prompt issues a separate read-only link that the spec says expires within 24 hours, cannot outlive the deployment or a revoke/reset, and cannot renew, publish, or read source resources. MCP approval renews a 24-hour upload window; publication starts a 24-hour result window. Those clocks are specified for the service. This tree cannot show they are enforced. |
| Agent delivery | The CLI creates a recipient key before intent. The app encrypts the reader secret to that key, bound to the request and origin. The CLI decrypts locally and returns the full URL. Same-account only: CLI owner, turn requester, and approver must match. Loss of the local recipient key cannot be repaired by the server. |

Residual: a holder of the fragment can read the published plaintext until revoke, and can keep what they already downloaded. The publisher's browser profile holds the long-lived secret in `localStorage`. Hosting must rate-limit agent-link issuance and omit capability URLs from logs; that requirement is not implemented in this repo.

### Daemon machine access

- Cloud `verifyMachineAccess` calls `canUseMachineForCliToken` with the daemon token, workspace, machine, requester, and optional local project (`apps/cli/src/lib/cloud-cli-port.ts`). The decision itself is hosted.
- Before that call, `MessageHandler.verifyMachineAccess` returns allowed when `requesterUserId` equals the daemon user, unless `forceBackendVerification` is set. Owner dispatch still schedules a backend recheck on a separate path (`fireOwnerAccessRecheck` in the session rules). A definitive deny fails the turn. `indeterminate` (network or auth error) does not become a deny; the turn stays pending. That fail-open is intentional for availability and is also a window if the hosted check cannot be reached.
- Local OSS never calls a service. Only the injected catalog user is allowed (`packages/platform/src/local.ts`).
- Delegated use (an agent on someone else's machine) must pass for both the token user and the driving human. If the hosted combined query is absent, a different human on a machine the owner does not own is denied (`readDelegatedMachineAccess`).
- MCP requires the active turn user to equal the CLI account. Resource discovery uses `canAccess`. Role dispatch checks both the executing machine owner and the driving human, and must not trust a synced `MachineMeta.ownerUserId` alone.

### Streams and Flock

Ordinary workspace sync is plaintext. `specs/workspace-streams-content.md` is a seam for a future protected mode. Omitted config and explicit `plaintext` keep the current transport. `protected` fails closed unless every Meta room, Loro document, and named Flock room selects protection, but the factory does not fetch keys and the spec says this seam does not enable E2EE. Persisted mode discovery, legacy-client exclusion, and server snapshot admission are open.

Trust boundary that is implemented:

- The Streams JWT is the room credential. It is cached in renderer storage under a key derived from the auth token (`packages/shared/src/loro-streams-auth.ts`). The streams-token spec says that storage is an optimization, not an XSS or revocation boundary. A provider is bound to one endpoint and workspace; a credential change must not return the previous user's token.
- Flock is a CRDT. A peer who can write the room can merge. Field-level ACLs are not a second layer in this client. Workspace MCP catalogs and agent roles live in the workspace Flock document. Role rows must not hold secrets, API keys, or MCP connection values. Capability-cache rows live in the Machine Flock document, which syncs, and must not store environment values (`specs/acp-capability-refresh-cache.md`).
- Dual author: the renderer writes user and UI state on its own Streams connection; the CLI writes agent-produced data. The old write-intent proxy is removed and must not return.
- Meta and Flock checkpoints stay on the replica that loaded them. Local presence for an origin is authoritative over a lagging cloud replica. The local Loro data-plane socket has no application bearer (finding L1).
- Renderer joins must not open a cloud session room. Local and cloud room health are not interchangeable.

### Client-exposed secrets

| Item | Exposure |
| --- | --- |
| Share reader secret | Plaintext `localStorage`, survives ordinary cache clear. Same origin as the app. |
| Streams JWT cache | AES-GCM in `localStorage`, key derived from the auth token already in the renderer. |
| CLI `credentials.json` | Plaintext on disk (M1). Not used by the local OSS port. |
| Git broker bearer | Process environment and `broker.json` (H1). |
| `lody agent-config show --show-secrets` | Prints raw provider env values. Default output is key names only (`agent-config-output.ts`). |
| `VITE_PUBLIC_POSTHOG_KEY`, `VITE_VIBELOFT_WEB_AUTH_KEY` | Build-time public client keys for analytics and the docs site. Local composition deletes the PostHog key and must not start telemetry. They are not server credentials, and they are visible to anyone who can read the bundle if a cloud or site build inlines them. |
| Electron cloud session | `safeStorage`, not the renderer. |
| Share and control-plane DTOs | Must not return the share secret or its hash. |

No additional hardcoded live credential was found while reading these paths.

## 4. Positive controls already in place

- **Public/local boundary.** OSS desktop and CLI default to local. Platform rules hard-disable local telemetry. `scripts/check-public-boundary.mjs` rejects closed product paths, private workspace dependencies, and a list of hosted deployment hostnames in publishable text.
- **Electron IPC.** No `window.api` mega-bridge. Preload is allowlisted. Product-window senders are checked. Zod at foreign boundaries. Renderer CSP is tested (`apps/electron/src/renderer/renderer-csp.test.mjs`).
- **Local IPC.** Per-user socket directory mode `0700`, machine-id match, body limits, Zod parsing.
- **MCP HTTP.** Loopback bind, constant-time bearer compare, Linux peer-uid check, refusal to start when `/proc/net/tcp` is unreadable, connection and header timeouts (`apps/cli/src/mcp/lody-mcp-http-host.ts`).
- **Preview and files.** Loopback target normalization, symlink-resolved allowlists, data-dir root excluded from remote preview, opaque local file capabilities, static HTML sandbox without same-origin.
- **Markdown.** `rehype-sanitize` on the default path. Changelogs keep raw HTML off. Auth redirect allowlist.
- **Credential hygiene in nearby paths.** Electron `safeStorage` for cloud session cookies. Broker and context files mode `0600`. Log helpers redact proxy and URL userinfo (`apps/cli/src/utils/log-sanitize.ts`). ACP auth rules forbid putting authorization data in logs, chat, or config. Child process filters strip `NODE_OPTIONS` and dynamic linker variables for Codex and similar launches. Feedback uploads exclude cwd, env, logs, and history.
- **Supply chain.** `pnpm-lock.yaml` installs with `--frozen-lockfile` in CI. New npm releases wait seven days (`minimumReleaseAge`). CI permissions are read-only. Checkout does not persist credentials. `pull_request_target` workflows are documented in `.github/workflow-security.md`; `pr-scope.yml` does not check out the PR. Managed runtime archives are hash- and size-checked against in-repo manifests. The E2E reporter verifies the `gh` binary hash. Release workflow in this repo publishes notes, not installers.
- **Disclosure.** `SECURITY.md` routes vulnerability reports to private GitHub Security Advisories and forbids public issues.

## 5. Priority 30-day fix plan

Ordered for risk reduction in the code this repository can change. Hosted confirmation items are called out so they are not mistaken for local patches.

1. **Git broker (H1).** Loopback or socket by default; remove the daemon-wide env copy; constant-time compare; stop publishing the token in the shared state file. Add a regression test that the listen address is loopback unless the operator flag is set.
2. **CLI token file (M1).** OS-backed encryption and atomic restrictive permissions, including Windows. Align the behavior with Electron `safeStorage`.
3. **Action pinning (M4).** SHA-pin third-party actions. Add a dependency update bot for Actions and npm. Re-read `e2e-pr-reconcile.yml` permissions (L7) in the same change.
4. **RPC identity checklist (M2).** Stop treating a body `requesterUserId` that matches the daemon user as proof on Streams-delivered calls. Inventory methods that skip `forceBackendVerification`. Confirm the hosted checker binds the stream subject. Keep the local catalog comparison for OSS, where there is no other user.
5. **Share-link handling (M3).** Confirm hash-only storage, no public object URLs, revoke-over-grace, and the 24-hour agent-link clock on the service. Keep MCP from receiving a dereferenceable URL if that is still acceptable to the product. Move the device copy of the reader secret out of plaintext `localStorage`, or accept that any same-origin script can read it. Do not ship the cutover until the spec's deploy gate is met.
6. **Runtime mirror and preview roots (L5, L8).** Reject cleartext mirrors except an explicit dev flag. Warn on `LODY_FILE_PREVIEW_EXTRA_ROOTS`.
7. **Electron sandbox decision (M6).** Either enable the Chromium sandbox or record the preload constraint in the window module so it is not copied into new windows by accident. Devbar (M8) stays default-off.
8. **MCP URL guard (M7).** Reject metadata and link-local targets unless opted in.
9. **Operational.** Confirm fork-PR secret isolation, branch protection, and that `NIGHTLY_DISPATCH_APP_PRIVATE_KEY` can dispatch only the intended private repository (M5). Signing keys, notarization material, and object-storage credentials stay in that private release repo; this public tree should continue to lack them. Confirm the Stable and Nightly update feeds (`https://updates.lody.ai/production/` and `https://nightly-updates.lody.ai/production/nightly/`) serve only signed artifacts. Set production CSP and HSTS for `https://lody.ai` (L9). Confirm inbound webhook signature checks in the hosted service (I5).

## 6. Residual risks and what was not verified

- **Hosted authorization.** Account sessions, Streams JWT issuance, share-object ACLs, the 24-hour agent-link clock, machine-lifecycle verify, preview verify, billing, and webhook receivers are outside this repository. Client code can be careful and still be wrong if the service trusts a client-supplied id.
- **Private release and signing.** Packaging, notarization, signing keys, and object-storage credentials for Stable and Nightly are in `https://github.com/loro-dev/lody`, not here. This review did not read that repository. A leak there can ship a signed desktop even if this public tree is clean. The public nightly workflow only holds a GitHub App key that dispatches into that repo.
- **Site and update channels.** Cloudflare Pages is built from the private repo's submodule and is not the same commit as public `main`. Response headers, WAF, and the contents of `https://updates.lody.ai/production/` and `https://nightly-updates.lody.ai/production/nightly/` were not fetched. Cookie `Secure` / `SameSite` / `HttpOnly` flags as actually set were not visible.
- **GitHub organization settings.** Branch protection, required reviews, Actions allowlists, fork PR approval, and who can read `NIGHTLY_DISPATCH_APP_PRIVATE_KEY` were not visible.
- **Signing and updates.** This repo's tag workflow does not build installers. A compromised update feed would bypass the hash pins in the git tree. Electron Stable and Nightly are separate app ids; which feed each build trusts was not confirmed from a packaged artifact.
- **Artifact host.** Clients verify sha256 against manifests shipped in the app. They do not prove the host's TLS configuration or that an already-released manifest was the one operators intended.
- **Submodules.** ACP extension checkouts follow gitlinks. Trust depends on review at each bump.
- **Git history and developer machines.** This pass did not scan full history, private forks, or laptops for leaked tokens.
- **Runtime behavior.** Bind addresses, file modes, and CSP were read from source. They were not observed on a packaged build, on Windows ACLs, or against a live daemon.
- **Agent autonomy.** Even with the controls above, an authorized agent can read and modify the workspace, talk to configured MCP servers, and use Git credentials the session was given. That is the product's power, and it is the main residual risk for a user who opens an untrusted repository.

## 7. How this review was done

The first pass covered Electron `webPreferences` and CSP, IPC preload policy, daemon sockets, credential storage, the Git broker, MCP HTTP, preview and file-preview policy, markdown and HTML sinks, auth redirects, managed-runtime hashing, workflow permissions, and secret-shaped literals. The follow-up read the session-share spec and credential helpers, daemon `verifyMachineAccess` and the local access oracle, Streams content and token-refresh specs, Flock role/catalog rules, and client env flags that can print or bundle keys. Operator notes about the private release repo, Pages, and update feeds are quoted as team context and were not independently verified. Hypotheses are labeled. No finding depends on a live secret, and none should be copied into a public issue with reproduction detail. Use `SECURITY.md` for anything that is exploitable.
