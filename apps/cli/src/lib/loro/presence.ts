import {
  EphemeralStoreAdaptor,
  EphemeralStreamCrdt,
  type EphemeralStreamSubscription,
} from '@loro-dev/streams-crdt/loro';
import { EphemeralStore, type Value } from 'loro-crdt';
import { v4 as uuidv4 } from 'uuid';
import {
  LODY_PRESENCE_HEARTBEAT_MS,
  LODY_PRESENCE_TTL_MS,
  LORO_STREAMS_BUCKET_ID,
  createLoroStreamUrl,
  getLoroMetaStreamId,
  getLoroStreamsPresenceBaseUrl,
  getLodyMachinePresenceKey,
  getLodySessionPresenceKey,
  getServerNow,
  parseLodyPresenceStates,
  toLodyPresenceStreamUrl,
  type LodyMachinePresenceState,
  type LodyPresenceInstanceId,
  type LodyPresenceState,
  type LodyPresenceStateMap,
  type LodySessionPresenceState,
  type MachineId,
  type SessionId,
  type SessionStatus,
  type WorkspaceId,
} from '@lody/shared';
import type { Logger } from '@/utils/logger';
import { formatSafeLogFields } from '@/platform/logger';

type StreamsAuthCallback = (context?: { reason: string }) => Promise<string | undefined>;

export type CliPresenceRuntimeOptions = {
  workspaceId: WorkspaceId;
  logger: Logger;
};

export type CliPresenceStreamsOptions = {
  streamsBaseUrl: string;
  auth: StreamsAuthCallback;
  /** Hosted shard topology from the token response; presence publishes to its dedicated host when set. */
  shardHostSuffix?: string;
};

// Presence is a liveness channel: a failed join or a dead room must never be
// permanent. Initial joins retry forever with capped backoff, and terminal
// room states (`error`/`disconnected` — the transport's own reconnects only
// cover retriable failures) trigger an explicit rejoin.
const JOIN_RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 15_000, 30_000];
const REJOIN_DELAYS_MS = [2_000, 5_000, 10_000, 30_000, 60_000];

// Temporary observation adapter for streams-crdt 0.16.2. It never owns/reimplements
// the send queue. Replace with native upstream stage/receipt events when published.
class PresenceDiagnostics {
  private attempt = 0;
  private readonly authPending = new Map<number, number>();
  private readonly postPending = new Map<number, number>();
  private lastPostResponseAtMs: number | undefined;
  private failures = 0;
  private lastSummaryAtMs = -Infinity;

  constructor(
    private readonly logger: Logger,
    private readonly generation: number,
    private readonly workspaceId: WorkspaceId,
    private readonly fetchImpl = globalThis.fetch.bind(globalThis)
  ) {}

  log(
    level: 'trace' | 'debug' | 'warn',
    stage: string,
    fields: Record<string, unknown> = {}
  ): void {
    this.logger[level](
      `[${this.workspaceId}] Loro presence${formatSafeLogFields({ generation: this.generation, stage, ...fields })}`
    );
  }

  closeReturned(): void {
    this.log('debug', 'close_returned', {
      authPending: this.authPending.size,
      postPending: this.postPending.size,
      peerReceipt: 'unavailable',
    });
  }

  summary(fields: Record<string, unknown> = {}): void {
    const now = Date.now();
    if (now - this.lastSummaryAtMs < LODY_PRESENCE_HEARTBEAT_MS) return;
    this.lastSummaryAtMs = now;
    const age = (pending: Map<number, number>): number =>
      pending.size === 0 ? 0 : Math.max(0, now - Math.min(...pending.values()));
    const authAgeMs = age(this.authPending);
    const postAgeMs = age(this.postPending);
    this.log(
      this.failures > 0 || Math.max(authAgeMs, postAgeMs) >= LODY_PRESENCE_HEARTBEAT_MS
        ? 'warn'
        : 'debug',
      'health',
      {
        authPending: this.authPending.size,
        postPending: this.postPending.size,
        authAgeMs,
        postAgeMs,
        failures: this.failures,
        ...(this.lastPostResponseAtMs === undefined
          ? {}
          : { sincePostResponseMs: Math.max(0, now - this.lastPostResponseAtMs) }),
        queueAgeMs: 'unavailable',
        retryAttempt: 'unavailable',
        peerReceipt: 'unavailable',
        ...fields,
      }
    );
    this.failures = 0;
  }

  async authenticate(
    auth: StreamsAuthCallback,
    context?: { reason: string }
  ): Promise<string | undefined> {
    const attempt = ++this.attempt;
    const start = Date.now();
    this.authPending.set(attempt, start);
    this.log('trace', 'auth_start', { attempt });
    try {
      const token = await auth(context);
      this.authPending.delete(attempt);
      this.log(Date.now() - start >= 5_000 ? 'debug' : 'trace', 'auth_ready', {
        attempt,
        elapsedMs: Math.max(0, Date.now() - start),
      });
      return token;
    } catch (error) {
      this.failures += 1;
      this.authPending.delete(attempt);
      this.log('trace', 'auth_failed', { attempt, outcome: 'rejected' });
      this.summary();
      throw error;
    } finally {
      this.authPending.delete(attempt);
    }
  }

  async fetch(input: string, init?: RequestInit): Promise<Response> {
    const post = init?.method === 'POST';
    const attempt = ++this.attempt;
    const start = Date.now();
    if (post) {
      this.postPending.set(attempt, start);
      this.log('trace', 'post_start', { attempt });
    }
    try {
      // Pass through the original signal/headers/body. Observe response headers only;
      // never consume or clone the SSE/error body, and never log input or credentials.
      const response = await this.fetchImpl(input, init);
      if (post) this.postPending.delete(attempt);
      const accepted = post ? response.status === 200 || response.status === 204 : response.ok;
      if (post && accepted) this.lastPostResponseAtMs = Date.now();
      if (!accepted) this.failures += 1;
      this.log(
        accepted && Date.now() - start >= 5_000 ? 'debug' : 'trace',
        post ? 'post_response' : 'read_response',
        {
          attempt,
          elapsedMs: Math.max(0, Date.now() - start),
          httpStatus: response.status,
          outcome: accepted ? 'ok' : 'http_failure',
        }
      );
      if (!accepted) this.summary();
      return response;
    } catch (error) {
      this.failures += 1;
      if (post) this.postPending.delete(attempt);
      this.log('trace', post ? 'post_failed' : 'read_failed', {
        attempt,
        outcome: init?.signal?.aborted ? 'aborted' : 'rejected',
      });
      this.summary();
      throw error;
    } finally {
      if (post) this.postPending.delete(attempt);
    }
  }
}

export class CliPresenceRuntime {
  private readonly instanceId = uuidv4() as LodyPresenceInstanceId;
  /**
   * Workspace presence replica: this process's own writes PLUS every other peer
   * (remote CLIs, other clients) received over the shared workspace presence
   * room. Read by in-process consumers that need the whole room — machine
   * online checks, the PR poller's `session-viewing` signal.
   */
  private readonly store = new EphemeralStore(LODY_PRESENCE_TTL_MS);
  /**
   * Entries AUTHORED BY THIS PROCESS only, and the sole payload of the local
   * data plane — that plane splits by ORIGIN, not by content. Relaying
   * {@link store} instead would hand the renderer's "local" snapshot authority
   * over peers it already replicates live from the cloud; see
   * `specs/local-first-two-plane.md` (presence 的平面划分按「来源」) for why.
   */
  private readonly localOriginStore = new EphemeralStore(LODY_PRESENCE_TTL_MS);
  // Streams sink is optional and attached only when the remote bridge connects;
  // presence production (store + heartbeat) runs regardless, so local-first
  // renderers can read it over the local data plane while offline.
  private transport: EphemeralStreamCrdt | null = null;
  private readonly machineTimer: NodeJS.Timeout;
  private readonly localOriginChangeListeners = new Set<() => void>();
  private subscription: EphemeralStreamSubscription | null = null;
  private machineId: MachineId | null = null;
  private machineKey: string | null = null;
  private readonly sessionKeys = new Map<SessionId, string>();
  private machineHeartbeatSeq = 0;
  private diagnostics: PresenceDiagnostics | null = null;
  private diagnosticGeneration = 0;
  /**
   * One outstanding update-chain snapshot barrier, never an exact heartbeat receipt.
   */
  private heartbeatBarrierProbe: { seq: number; enqueuedAtMs: number } | null = null;
  private sessionPresenceSeq = 0;
  private started = false;
  private stopped = false;
  private joinRetryTimer: NodeJS.Timeout | null = null;
  private rejoinTimer: NodeJS.Timeout | null = null;
  private rejoinBackoffIndex = 0;
  private joinedOnce = false;
  private joinedWaiters: Array<(joined: boolean) => void> = [];

  constructor(private readonly options: CliPresenceRuntimeOptions) {
    this.machineTimer = setInterval(() => {
      this.writeMachineHeartbeat();
    }, LODY_PRESENCE_HEARTBEAT_MS);
    this.machineTimer.unref?.();
  }

  /**
   * Subscribe to this process's OWN presence writes (drives the local
   * data-plane push). Peer updates arriving from the presence room never fire
   * it — they are not this plane's payload.
   */
  subscribeLocalOriginPresence(listener: () => void): () => void {
    this.localOriginChangeListeners.add(listener);
    return () => this.localOriginChangeListeners.delete(listener);
  }

  /** Snapshot of this process's OWN presence entries, for the local data plane. */
  encodeLocalOriginPresence(): Uint8Array {
    return this.localOriginStore.encodeAll();
  }

  private notifyLocalOriginChange(): void {
    for (const listener of this.localOriginChangeListeners) {
      listener();
    }
  }

  /**
   * Single write path for locally-authored presence: keeps the workspace
   * replica and the local-origin view from ever diverging, and is the only
   * place that announces a local-plane push.
   *
   * The workspace's SHARED presence transport sends serial POSTs. Its built-in
   * adaptor coalesces unsent same-key updates, but never in-flight writes or
   * distinct keys. Callers must still be driven by a timer, a lifecycle transition,
   * or a user navigation — never by a stream/progress/chunk callback. A burst
   * here makes this machine read offline even though the room stays `joined`.
   * Bounds: `specs/loro-ephemeral-presence-channel.md`.
   */
  private writeLocalOrigin(key: string, state: LodyPresenceState): void {
    this.store.set(key, state as unknown as Value);
    this.localOriginStore.set(key, state as unknown as Value);
    this.notifyLocalOriginChange();
  }

  /** Single delete path for locally-authored presence (see {@link writeLocalOrigin}). */
  private deleteLocalOrigin(key: string): void {
    this.store.delete(key);
    this.localOriginStore.delete(key);
    this.notifyLocalOriginChange();
  }

  /**
   * Attach the cloud Streams sink (idempotent). Presence keeps being produced
   * locally without this; attaching only additionally mirrors it to the cloud
   * presence stream once the remote bridge is online.
   */
  attachStreams(streamsOptions: CliPresenceStreamsOptions): void {
    if (this.stopped || this.transport) return;
    const durableStreamUrl = createLoroStreamUrl({
      bucketId: LORO_STREAMS_BUCKET_ID,
      streamId: getLoroMetaStreamId(this.options.workspaceId),
      baseUrl: getLoroStreamsPresenceBaseUrl(
        streamsOptions.streamsBaseUrl,
        undefined,
        streamsOptions.shardHostSuffix
      ),
    });
    const diagnostics = new PresenceDiagnostics(
      this.options.logger,
      ++this.diagnosticGeneration,
      this.options.workspaceId
    );
    this.diagnostics = diagnostics;
    this.transport = new EphemeralStreamCrdt({
      streamUrl: toLodyPresenceStreamUrl(durableStreamUrl),
      auth: (context) => diagnostics.authenticate(streamsOptions.auth, context),
      fetch: (input, init) => diagnostics.fetch(input, init),
      adaptor: EphemeralStoreAdaptor(this.store),
    });
    if (this.started) {
      return;
    }
    this.started = true;
    this.options.logger.debug(`[${this.options.workspaceId}] Joining Loro presence room`);
    void this.joinWithRetry(0);
  }

  private async joinWithRetry(attempt: number): Promise<void> {
    const transport = this.transport;
    if (!transport) return;
    try {
      const result = await transport.join({
        onStatusChange: (status) => {
          if (this.transport === transport) {
            this.handleRoomStatus(status);
          }
        },
      });
      if (this.stopped || this.transport !== transport) {
        if (result.ok) result.value.unsubscribe();
        return;
      }
      if (result.ok) {
        this.subscription = result.value;
        this.options.logger.debug(
          `[${this.options.workspaceId}] Loro presence subscription established`
        );
        return;
      }
      // The raw result stays with the existing join caller, never the log sink.
    } catch {
      if (this.stopped || this.transport !== transport) return;
    }
    const delayMs =
      JOIN_RETRY_DELAYS_MS[Math.min(attempt, JOIN_RETRY_DELAYS_MS.length - 1)] ?? 30_000;
    this.diagnostics?.log('warn', 'join_failed', { attempt: attempt + 1, outcome: 'rejected' });
    this.joinRetryTimer = setTimeout(() => {
      this.joinRetryTimer = null;
      void this.joinWithRetry(attempt + 1);
    }, delayMs);
    this.joinRetryTimer.unref?.();
  }

  private handleRoomStatus(status: string): void {
    this.options.logger.debug(`[${this.options.workspaceId}] Loro presence room status: ${status}`);
    if (this.stopped) return;
    if (status === 'joined') {
      this.rejoinBackoffIndex = 0;
      this.resolveJoinedWaiters(true);
      // Presence writes are idempotent, while the server may have lost its
      // ephemeral state during any reconnect. Reassert on every joined edge.
      this.republishLocalState();
      return;
    }
    // The transport retries retriable failures internally; `error` and
    // `disconnected` are terminal for its read loop and need an explicit
    // rejoin, otherwise presence silently stops flowing for the rest of the
    // process lifetime.
    if (status === 'error' || status === 'disconnected') {
      this.scheduleRejoin();
    }
  }

  private scheduleRejoin(): void {
    if (this.stopped || this.rejoinTimer) return;
    const delayMs =
      REJOIN_DELAYS_MS[Math.min(this.rejoinBackoffIndex, REJOIN_DELAYS_MS.length - 1)] ?? 60_000;
    this.rejoinBackoffIndex += 1;
    this.rejoinTimer = setTimeout(() => {
      this.rejoinTimer = null;
      if (this.stopped || !this.transport) return;
      this.options.logger.warn(
        `[${this.options.workspaceId}] Loro presence room in terminal state; rejoining`
      );
      this.transport.rejoin();
    }, delayMs);
    this.rejoinTimer.unref?.();
  }

  /** Re-broadcast machine + session presence after the room recovered. */
  private republishLocalState(): void {
    if (this.stopped) return;
    if (this.machineKey) {
      this.writeMachineHeartbeat();
    }
    let republished = 0;
    for (const key of this.sessionKeys.values()) {
      const state = this.localOriginStore.get(key) as LodySessionPresenceState | undefined;
      if (!state) continue;
      this.writeLocalOrigin(key, { ...state, updatedAt: getServerNow() });
      republished += 1;
    }
    if (republished > 0) {
      this.options.logger.debug(
        `[${this.options.workspaceId}] Republished ${republished} session presence entr${republished === 1 ? 'y' : 'ies'} after presence room recovery`
      );
    }
  }

  private resolveJoinedWaiters(joined: boolean): void {
    if (joined) {
      this.joinedOnce = true;
    }
    const waiters = this.joinedWaiters;
    this.joinedWaiters = [];
    for (const waiter of waiters) {
      waiter(joined);
    }
  }

  /**
   * Resolves true once the remote presence room has applied its initial
   * bootstrap. Local-only presence production does not satisfy this boundary.
   */
  waitUntilJoined(timeoutMs: number): Promise<boolean> {
    if (this.joinedOnce && this.transport) return Promise.resolve(true);
    if (this.stopped || !this.transport) return Promise.resolve(false);
    return new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve(false);
      }, timeoutMs);
      timer.unref?.();
      this.joinedWaiters.push((joined) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(joined);
      });
    });
  }

  /** Current presence snapshot (local writes + remote peers, TTL-pruned). */
  getPresenceStates(): LodyPresenceStateMap {
    return parseLodyPresenceStates(this.store.getAllStates() as Record<string, unknown>);
  }

  /**
   * Detach the cloud Streams sink but keep producing presence locally (the
   * remote bridge went offline / was revoked). A later `attachStreams` re-joins.
   */
  async detachStreams(): Promise<void> {
    if (this.stopped || !this.transport) return;
    if (this.joinRetryTimer) {
      clearTimeout(this.joinRetryTimer);
      this.joinRetryTimer = null;
    }
    if (this.rejoinTimer) {
      clearTimeout(this.rejoinTimer);
      this.rejoinTimer = null;
    }
    this.subscription?.unsubscribe();
    this.subscription = null;
    const transport = this.transport;
    this.transport = null;
    this.started = false;
    this.joinedOnce = false;
    this.resolveJoinedWaiters(false);
    this.rejoinBackoffIndex = 0;
    const diagnostics = this.diagnostics;
    this.diagnostics = null;
    this.heartbeatBarrierProbe = null;
    await transport.close();
    diagnostics?.closeReturned();
  }

  /**
   * Subscribe to parsed presence snapshots. Fires on any store change (remote
   * peer updates and our own local writes alike).
   */
  subscribe(listener: (states: LodyPresenceStateMap) => void): () => void {
    return this.store.subscribe(() => {
      listener(this.getPresenceStates());
    });
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.resolveJoinedWaiters(false);
    clearInterval(this.machineTimer);
    if (this.joinRetryTimer) {
      clearTimeout(this.joinRetryTimer);
      this.joinRetryTimer = null;
    }
    if (this.rejoinTimer) {
      clearTimeout(this.rejoinTimer);
      this.rejoinTimer = null;
    }
    this.clearMachinePresence();
    for (const sessionId of Array.from(this.sessionKeys.keys())) {
      this.clearSessionPresence(sessionId);
    }
    this.subscription?.unsubscribe();
    this.subscription = null;
    this.localOriginChangeListeners.clear();
    await this.transport?.close();
    this.diagnostics?.closeReturned();
    this.diagnostics = null;
    this.heartbeatBarrierProbe = null;
    this.transport = null;
    this.store.destroy();
    this.localOriginStore.destroy();
  }

  setMachineOnline(machineId: MachineId): void {
    if (this.stopped) return;
    this.machineId = machineId;
    this.machineKey = getLodyMachinePresenceKey(machineId, this.instanceId);
    this.writeMachineHeartbeat();
  }

  writeMachineHeartbeat(): void {
    if (this.stopped || !this.machineId || !this.machineKey) return;
    const seq = ++this.machineHeartbeatSeq;
    const state: LodyMachinePresenceState = {
      kind: 'machine',
      machineId: this.machineId,
      instanceId: this.instanceId,
      updatedAt: getServerNow(),
    };
    this.writeLocalOrigin(this.machineKey, state);
    const fields = {
      seq,
      pendingLocalCount: this.subscription?.pendingLocalCount,
      room: this.subscription?.status ?? 'unavailable',
      barrierPendingMs: this.heartbeatBarrierProbe
        ? Math.max(0, Date.now() - this.heartbeatBarrierProbe.enqueuedAtMs)
        : 0,
    };
    if (this.diagnostics) this.diagnostics.log('trace', 'local_update', fields);
    else
      this.options.logger.trace(
        `[${this.options.workspaceId}] Loro presence${formatSafeLogFields({ generation: this.diagnosticGeneration, stage: 'local_update', ...fields })}`
      );
    this.diagnostics?.summary(fields);
    this.observeHeartbeatBarrier(seq);
  }

  /** One bounded observer of the captured chains. Coalescing may replace this
   * heartbeat; later independent chains are outside the barrier. It proves
   * neither an exact send timestamp nor any peer's receipt. */
  private observeHeartbeatBarrier(seq: number): void {
    const subscription = this.subscription;
    const diagnostics = this.diagnostics;
    if (!subscription || !diagnostics || this.heartbeatBarrierProbe) return;
    const probe = { seq, enqueuedAtMs: Date.now() };
    this.heartbeatBarrierProbe = probe;
    void subscription
      .waitUntilSynced()
      .then(() => {
        if (this.subscription !== subscription) return;
        const barrierAgeMs = Math.max(0, Date.now() - probe.enqueuedAtMs);
        diagnostics.log(
          barrierAgeMs >= LODY_PRESENCE_TTL_MS ? 'warn' : 'trace',
          'barrier_complete',
          {
            seq,
            barrierAgeMs,
            peerReceipt: 'unavailable',
          }
        );
      })
      .catch(() => {
        if (this.subscription !== subscription) return;
        diagnostics.log('debug', 'barrier_failed', { seq, outcome: 'rejected' });
      })
      .finally(() => {
        if (this.heartbeatBarrierProbe === probe) this.heartbeatBarrierProbe = null;
      });
  }

  setSessionPresence(args: {
    sessionId: SessionId;
    machineId: MachineId | undefined;
    status: SessionStatus | undefined;
  }): void {
    if (this.stopped) return;
    if (!args.status || args.status.type === 'idle') {
      this.clearSessionPresence(args.sessionId);
      return;
    }
    // Session meta may not have synced yet (fast-path dispatch, fresh
    // sessions); presence is only ever published by the executing machine, so
    // the local machine identity is the correct fallback.
    const machineId = args.machineId ?? this.machineId;
    if (!machineId) {
      this.options.logger.debug(
        `[${this.options.workspaceId}] Skipped session presence write: machineId unknown (session=${args.sessionId})`
      );
      return;
    }
    const key = getLodySessionPresenceKey(args.sessionId, this.instanceId);
    this.sessionKeys.set(args.sessionId, key);
    const seq = ++this.sessionPresenceSeq;
    const state: LodySessionPresenceState = {
      kind: 'session',
      sessionId: args.sessionId,
      machineId,
      instanceId: this.instanceId,
      status: args.status,
      updatedAt: getServerNow(),
    };
    this.writeLocalOrigin(key, state);
    this.options.logger.trace(
      `[${this.options.workspaceId}] Loro presence session heartbeat written (session=${args.sessionId} status=${args.status.type} seq=${seq})`
    );
  }

  clearSessionPresence(sessionId: SessionId): void {
    const key = this.sessionKeys.get(sessionId);
    if (!key) return;
    this.sessionKeys.delete(sessionId);
    this.deleteLocalOrigin(key);
    this.options.logger.trace(
      `[${this.options.workspaceId}] Loro presence session entry cleared (session=${sessionId})`
    );
  }

  private clearMachinePresence(): void {
    if (!this.machineKey) return;
    this.deleteLocalOrigin(this.machineKey);
    this.machineKey = null;
    this.machineId = null;
  }
}
