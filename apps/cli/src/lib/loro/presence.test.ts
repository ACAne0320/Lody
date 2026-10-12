import { EphemeralStore } from 'loro-crdt';
import { EphemeralStoreAdaptor, EphemeralStreamCrdt } from '@loro-dev/streams-crdt/loro';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getLodySessionPresenceKey,
  LODY_PRESENCE_HEARTBEAT_MS,
  LODY_PRESENCE_TTL_MS,
  parseLodyPresenceStates,
  SessionStatusFactory,
  type LodyPresenceInstanceId,
  type LodyPresenceStateMap,
  type LodySessionPresenceState,
  type MachineId,
  type SessionId,
  type WorkspaceId,
} from '@lody/shared';

import type { Logger } from '@/utils/logger';
import { CliPresenceRuntime } from './presence';

const createLogger = (): Logger => diagnosticLogger().logger;

const SESSION_ID = 'session-presence-1' as SessionId;
const MACHINE_ID = 'machine-presence-1' as MachineId;
const REMOTE_SESSION_ID = 'session-presence-remote' as SessionId;
const REMOTE_MACHINE_ID = 'machine-presence-remote' as MachineId;
const REMOTE_INSTANCE_ID = 'remote-instance' as LodyPresenceInstanceId;
/** Replicate through the actual bootstrap/SSE API and preserve the local plane. */
const replicatePeerFromPresenceRoom = async (presence: CliPresenceRuntime): Promise<void> => {
  const transport = controlledTransport(true);
  vi.stubGlobal('fetch', transport.fetch);
  const peer = new EphemeralStore(LODY_PRESENCE_TTL_MS);
  try {
    attach(presence);
    expect(await presence.waitUntilJoined(1_000)).toBe(true);
    const read = observePeer(presence, peer);
    transport.receive(peer.encodeAll());
    await read.applied;
    read.unsubscribe();
  } finally {
    await presence.detachStreams();
    await transport.releaseAll();
    peer.destroy();
  }
};

/** Decode what the local data plane would push to a renderer. */
const decodeLocalOriginSnapshot = (presence: CliPresenceRuntime): LodyPresenceStateMap => {
  const decoded = new EphemeralStore(LODY_PRESENCE_TTL_MS);
  try {
    decoded.apply(presence.encodeLocalOriginPresence());
    return parseLodyPresenceStates(decoded.getAllStates() as Record<string, unknown>);
  } finally {
    decoded.destroy();
  }
};
const getSessionPresenceState = (
  presence: CliPresenceRuntime
): LodySessionPresenceState | undefined => {
  const states = presence.getPresenceStates();
  return Object.values(states).find(
    (state): state is LodySessionPresenceState =>
      state.kind === 'session' && state.sessionId === SESSION_ID
  );
};

let runtime: CliPresenceRuntime | null = null;

const createRuntime = (logger: Logger = createLogger()): CliPresenceRuntime => {
  runtime = new CliPresenceRuntime({
    workspaceId: 'workspace-presence-1' as WorkspaceId,
    logger,
  });
  return runtime;
};

afterEach(async () => {
  await runtime?.stop();
  runtime = null;
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('CliPresenceRuntime session presence', () => {
  it('falls back to the local machine identity when session meta has no machineId yet', () => {
    const presence = createRuntime();
    presence.setMachineOnline(MACHINE_ID);

    presence.setSessionPresence({
      sessionId: SESSION_ID,
      machineId: undefined,
      status: SessionStatusFactory.running(),
    });

    expect(getSessionPresenceState(presence)).toMatchObject({
      sessionId: SESSION_ID,
      machineId: MACHINE_ID,
      status: SessionStatusFactory.running(),
    });
  });

  it('skips the write when no machine identity is known at all', () => {
    const presence = createRuntime();

    presence.setSessionPresence({
      sessionId: SESSION_ID,
      machineId: undefined,
      status: SessionStatusFactory.running(),
    });

    expect(getSessionPresenceState(presence)).toBeUndefined();
  });

  it('clears the entry when an idle status is forwarded', () => {
    const presence = createRuntime();
    presence.setMachineOnline(MACHINE_ID);

    presence.setSessionPresence({
      sessionId: SESSION_ID,
      machineId: MACHINE_ID,
      status: SessionStatusFactory.initializing(),
    });
    expect(getSessionPresenceState(presence)).toBeDefined();

    presence.setSessionPresence({
      sessionId: SESSION_ID,
      machineId: MACHINE_ID,
      status: SessionStatusFactory.idle(),
    });
    expect(getSessionPresenceState(presence)).toBeUndefined();
  });

  it('republishes local session presence after real bootstrap and SSE reconnect', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    const transport = controlledTransport(true);
    vi.stubGlobal('fetch', transport.fetch);
    const presence = createRuntime();
    presence.setMachineOnline(MACHINE_ID);
    presence.setSessionPresence({
      sessionId: SESSION_ID,
      machineId: MACHINE_ID,
      status: SessionStatusFactory.running(),
    });
    const before = getSessionPresenceState(presence)?.updatedAt ?? 0;
    vi.setSystemTime(before + 1_000);
    attach(presence);
    expect(await presence.waitUntilJoined(1_000)).toBe(true);
    const afterInitial = getSessionPresenceState(presence)?.updatedAt ?? 0;
    expect(afterInitial).toBeGreaterThan(before);
    const republished = Promise.withResolvers<void>();
    const unsubscribe = presence.subscribe(() => {
      if ((getSessionPresenceState(presence)?.updatedAt ?? 0) > afterInitial) republished.resolve();
    });
    try {
      vi.setSystemTime(afterInitial + 1_000);
      transport.endRead();
      await vi.advanceTimersByTimeAsync(0);
      await republished.promise;
      expect(getSessionPresenceState(presence)?.updatedAt).toBeGreaterThan(afterInitial);
    } finally {
      unsubscribe();
      await presence.stop();
      await transport.releaseAll();
    }
  });
});

describe('CliPresenceRuntime local-origin plane payload', () => {
  it('carries this process own machine and session entries', () => {
    const presence = createRuntime();
    presence.setMachineOnline(MACHINE_ID);
    presence.setSessionPresence({
      sessionId: SESSION_ID,
      machineId: MACHINE_ID,
      status: SessionStatusFactory.initializing(),
    });

    expect(Object.values(decodeLocalOriginSnapshot(presence))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'machine', machineId: MACHINE_ID }),
        expect.objectContaining({ kind: 'session', sessionId: SESSION_ID }),
      ])
    );
  });

  it('excludes peers replicated from the workspace presence room', async () => {
    const presence = createRuntime();
    presence.setMachineOnline(MACHINE_ID);
    await replicatePeerFromPresenceRoom(presence);

    // The replica sees the peer; the local plane must not carry it, or the
    // renderer would read a remote machine's status as local-origin.
    expect(
      Object.values(presence.getPresenceStates()).some(
        (state) => state.kind === 'session' && state.sessionId === REMOTE_SESSION_ID
      )
    ).toBe(true);
    expect(
      Object.values(decodeLocalOriginSnapshot(presence)).some(
        (state) => state.kind === 'session' && state.sessionId === REMOTE_SESSION_ID
      )
    ).toBe(false);
  });

  it('notifies local-plane consumers with own changes and leaves their snapshot sequence unchanged on peer updates', async () => {
    const transport = controlledTransport(true);
    vi.stubGlobal('fetch', transport.fetch);
    const presence = createRuntime();
    const peer = new EphemeralStore(LODY_PRESENCE_TTL_MS);
    attach(presence);
    expect(await presence.waitUntilJoined(1_000)).toBe(true);
    const snapshots: LodyPresenceStateMap[] = [];
    const unsubscribe = presence.subscribeLocalOriginPresence(() =>
      snapshots.push(decodeLocalOriginSnapshot(presence))
    );
    try {
      presence.setMachineOnline(MACHINE_ID);
      const machineSnapshot = decodeLocalOriginSnapshot(presence);
      expect(snapshots).toEqual([machineSnapshot]);
      const read = observePeer(presence, peer);
      transport.receive(peer.encodeAll());
      await read.applied;
      read.unsubscribe();
      expect(snapshots).toEqual([machineSnapshot]);
      presence.setSessionPresence({
        sessionId: SESSION_ID,
        machineId: MACHINE_ID,
        status: SessionStatusFactory.running(),
      });
      expect(snapshots).toEqual([machineSnapshot, decodeLocalOriginSnapshot(presence)]);
      expect(Object.values(snapshots.at(-1) ?? {})).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: 'machine' }),
          expect.objectContaining({ kind: 'session', sessionId: SESSION_ID }),
        ])
      );
    } finally {
      unsubscribe();
      await presence.stop();
      await transport.releaseAll();
      peer.destroy();
    }
  });

  it('drops a cleared session entry so the renderer stops showing it as working', () => {
    const presence = createRuntime();
    presence.setMachineOnline(MACHINE_ID);
    presence.setSessionPresence({
      sessionId: SESSION_ID,
      machineId: MACHINE_ID,
      status: SessionStatusFactory.running(),
    });

    presence.clearSessionPresence(SESSION_ID);

    const snapshot = decodeLocalOriginSnapshot(presence);
    expect(
      Object.values(snapshot).some(
        (state) => state.kind === 'session' && state.sessionId === SESSION_ID
      )
    ).toBe(false);
    // The machine entry must survive the session clear.
    expect(
      Object.values(snapshot).some(
        (state) => state.kind === 'machine' && state.machineId === MACHINE_ID
      )
    ).toBe(true);
  });
});

/** Synthetic transport, real CRDT/adaptor/queue. Every pending request has an
 * explicit gate; no network, polling, sleeps or private transport fields. */
const controlledTransport = (autoAck = false) => {
  const encoder = new TextEncoder();
  const empty = new EphemeralStore(LODY_PRESENCE_TTL_MS);
  const bootstrap = empty.encodeAll();
  empty.destroy();
  const toEvent = (event: string, bytes: Uint8Array) =>
    encoder.encode(`event: ${event}\ndata: ${Buffer.from(bytes).toString('base64')}\n\n`);
  let sse: ReadableStreamDefaultController<Uint8Array> | undefined;
  let endRead = () => {};
  const requests: Array<{
    bytes: Uint8Array;
    signal: AbortSignal | null | undefined;
    response: ReturnType<typeof Promise.withResolvers<Response>>;
    finished: ReturnType<typeof Promise.withResolvers<void>>;
  }> = [];
  const arrivals = new Map<number, ReturnType<typeof Promise.withResolvers<void>>>();
  const fetch = async (_input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    if (init?.method !== 'POST') {
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            sse = controller;
            let open = true;
            endRead = () => {
              if (open) {
                open = false;
                controller.close();
              }
            };
            const endThisRead = endRead;
            controller.enqueue(toEvent('bootstrap', bootstrap));
            init?.signal?.addEventListener('abort', endThisRead, { once: true });
          },
        }),
        { headers: { 'Content-Type': 'text/event-stream', 'Stream-SSE-Data-Encoding': 'base64' } }
      );
    }
    const request = {
      bytes: new Uint8Array(init.body as Uint8Array),
      signal: init.signal,
      response: Promise.withResolvers<Response>(),
      finished: Promise.withResolvers<void>(),
    };
    requests.push(request);
    if (autoAck) request.response.resolve(new Response(null, { status: 204 }));
    arrivals.get(requests.length - 1)?.resolve();
    try {
      return await request.response.promise;
    } finally {
      request.finished.resolve();
    }
  };
  return {
    fetch,
    requests,
    endRead: () => endRead(),
    nextPost: async (index: number) => {
      if (!requests[index]) {
        const gate = Promise.withResolvers<void>();
        arrivals.set(index, gate);
        await gate.promise;
      }
      const request = requests[index];
      if (!request) throw new Error('POST gate resolved without request');
      return request;
    },
    receive: (bytes: Uint8Array) => {
      if (!sse) throw new Error('SSE not open');
      sse.enqueue(toEvent('data', bytes));
    },
    releaseAll: async () => {
      for (const request of requests) request.response.resolve(new Response(null, { status: 204 }));
      await Promise.all(requests.map((request) => request.finished.promise));
    },
  };
};

const diagnosticLogger = () => {
  const records: Array<{ level: string; fields: Record<string, unknown> }> = [];
  const joined = Promise.withResolvers<void>();
  const listeners: Array<{ stage: string; gate: ReturnType<typeof Promise.withResolvers<void>> }> =
    [];
  const sink =
    (level: string) =>
    (...args: unknown[]) => {
      const text = String(args[0]);
      if (text.includes('subscription established')) joined.resolve();
      const marker = text.indexOf('Loro presence {');
      if (marker < 0) return;
      const fields: Record<string, unknown> = JSON.parse(
        text.slice(marker + 'Loro presence '.length)
      );
      records.push({ level, fields });
      for (const listener of listeners)
        if (fields.stage === listener.stage) listener.gate.resolve();
    };
  const logger: Logger = {
    trace: sink('trace'),
    debug: sink('debug'),
    info: sink('info'),
    warn: sink('warn'),
    error: sink('error'),
    success: sink('info'),
    child: () => logger,
    setLevel() {},
    setDebug() {},
    close: async () => {},
  };
  return {
    logger,
    records,
    joined: joined.promise,
    stage: (stage: string) => {
      const gate = Promise.withResolvers<void>();
      if (records.some((record) => record.fields.stage === stage)) gate.resolve();
      else listeners.push({ stage, gate });
      return gate.promise;
    },
  };
};

const attach = (
  presence: CliPresenceRuntime,
  auth: () => Promise<string | undefined> = async () => 'secret-token'
) => presence.attachStreams({ streamsBaseUrl: 'https://secret.invalid/private?secret=url', auth });

const observePeer = (presence: CliPresenceRuntime, peer: EphemeralStore) => {
  const applied = Promise.withResolvers<void>();
  const unsubscribe = presence.subscribe((states) => {
    if (
      Object.values(states).some(
        (state) => state.kind === 'session' && state.sessionId === REMOTE_SESSION_ID
      )
    )
      applied.resolve();
  });
  peer.set(getLodySessionPresenceKey(REMOTE_SESSION_ID, REMOTE_INSTANCE_ID), {
    kind: 'session',
    sessionId: REMOTE_SESSION_ID,
    machineId: REMOTE_MACHINE_ID,
    instanceId: REMOTE_INSTANCE_ID,
    status: SessionStatusFactory.running(),
    updatedAt: Date.now(),
  });
  return { applied: applied.promise, unsubscribe };
};

describe('presence diagnostics at the real ephemeral boundary', () => {
  it('observes healthy reads while POST is blocked and reports actual pending age without invented queue stats', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const start = Date.now();
    const transport = controlledTransport();
    vi.stubGlobal('fetch', transport.fetch);
    const logs = diagnosticLogger();
    const presence = createRuntime(logs.logger);
    const peer = new EphemeralStore(LODY_PRESENCE_TTL_MS);
    try {
      attach(presence);
      await logs.joined;
      presence.setMachineOnline(MACHINE_ID);
      const post = await transport.nextPost(0);
      const read = observePeer(presence, peer);
      transport.receive(peer.encodeAll());
      await read.applied;
      read.unsubscribe();
      expect(
        Object.values(decodeLocalOriginSnapshot(presence)).some((state) => state.kind === 'session')
      ).toBe(false);
      vi.setSystemTime(start + LODY_PRESENCE_HEARTBEAT_MS);
      presence.writeMachineHeartbeat();
      const health = logs.records.filter((record) => record.fields.stage === 'health').at(-1);
      expect(health).toMatchObject({
        level: 'warn',
        fields: {
          room: 'joined',
          pendingLocalCount: 2,
          postPending: 1,
          postAgeMs: LODY_PRESENCE_HEARTBEAT_MS,
          authPending: 0,
          queueAgeMs: 'unavailable',
          retryAttempt: 'unavailable',
          peerReceipt: 'unavailable',
        },
      });
      expect(logs.records.some((record) => record.fields.stage === 'barrier_complete')).toBe(false);
      expect(post.signal?.aborted).toBe(false);
      expect(JSON.stringify(logs.records)).not.toMatch(
        /secret|payload|lastLocalAppend|lastWriteError|ageAtSend|queuedAhead/
      );
      post.response.resolve(new Response(null, { status: 204 }));
      const second = await transport.nextPost(1);
      second.response.resolve(new Response(null, { status: 204 }));
      await logs.stage('barrier_complete');
      expect(
        logs.records.find((record) => record.fields.stage === 'barrier_complete')
      ).toMatchObject({
        level: 'trace',
        fields: { barrierAgeMs: LODY_PRESENCE_HEARTBEAT_MS, peerReceipt: 'unavailable' },
      });
    } finally {
      await presence.stop();
      await transport.releaseAll();
      peer.destroy();
    }
  });

  it('distinguishes a stuck auth callback from a POST and rate limits health warnings', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const start = Date.now();
    const transport = controlledTransport();
    vi.stubGlobal('fetch', transport.fetch);
    const logs = diagnosticLogger();
    const presence = createRuntime(logs.logger);
    const authStarted = Promise.withResolvers<void>();
    const token = Promise.withResolvers<string>();
    let readAuthenticated = false;
    try {
      attach(presence, async () => {
        if (!readAuthenticated) {
          readAuthenticated = true;
          return 'secret-read-token';
        }
        authStarted.resolve();
        return token.promise;
      });
      await logs.joined;
      presence.setMachineOnline(MACHINE_ID);
      await authStarted.promise;
      vi.setSystemTime(start + LODY_PRESENCE_HEARTBEAT_MS);
      presence.writeMachineHeartbeat();
      const health = logs.records.filter((record) => record.fields.stage === 'health');
      expect(health.at(-1)).toMatchObject({
        level: 'warn',
        fields: {
          authPending: 1,
          authAgeMs: LODY_PRESENCE_HEARTBEAT_MS,
          postPending: 0,
          pendingLocalCount: 2,
        },
      });
      const before = [...logs.records];
      presence.writeMachineHeartbeat();
      expect(logs.records.filter((record) => record.fields.stage === 'health')).toEqual(health);
      expect(logs.records.slice(before.length).every((record) => record.level === 'trace')).toBe(
        true
      );
      token.resolve('secret-write-token');
      await transport.nextPost(0);
    } finally {
      await presence.stop();
      token.resolve('secret-write-token');
      await transport.releaseAll();
    }
  });

  it('projects auth rejection safely while preserving local presence', async () => {
    const transport = controlledTransport();
    vi.stubGlobal('fetch', transport.fetch);
    const logs = diagnosticLogger();
    const presence = createRuntime(logs.logger);
    let readAuthenticated = false;
    try {
      attach(presence, async () => {
        if (!readAuthenticated) {
          readAuthenticated = true;
          return 'secret-read';
        }
        throw new Error('secret-auth-error https://secret.invalid');
      });
      await logs.joined;
      presence.setMachineOnline(MACHINE_ID);
      await logs.stage('auth_failed');
      expect(logs.records.find((record) => record.fields.stage === 'auth_failed')).toMatchObject({
        fields: { outcome: 'rejected' },
      });
      expect(logs.records.some((record) => record.fields.stage === 'post_start')).toBe(false);
      expect(Object.values(decodeLocalOriginSnapshot(presence))).toEqual([
        expect.objectContaining({ kind: 'machine', machineId: MACHINE_ID }),
      ]);
      expect(JSON.stringify(logs.records)).not.toMatch(/secret|payload|url/);
    } finally {
      await presence.stop();
      await transport.releaseAll();
    }
  });

  it('projects HTTP failure without consuming the response body or leaking its URL/token/payload', async () => {
    const transport = controlledTransport();
    vi.stubGlobal('fetch', transport.fetch);
    const logs = diagnosticLogger();
    const presence = createRuntime(logs.logger);
    try {
      attach(presence);
      await logs.joined;
      presence.setMachineOnline(MACHINE_ID);
      const post = await transport.nextPost(0);
      post.response.resolve(
        new Response('secret-error-body https://secret.invalid', { status: 400 })
      );
      await logs.stage('barrier_failed');
      expect(logs.records.find((record) => record.fields.stage === 'post_response')).toMatchObject({
        fields: { httpStatus: 400, outcome: 'http_failure' },
      });
      expect(JSON.stringify(logs.records)).not.toMatch(/secret|payload|url/);
    } finally {
      await presence.stop();
      await transport.releaseAll();
    }
  });

  it('keeps late POST observations in their original generation after detach and reattach', async () => {
    const transport = controlledTransport();
    vi.stubGlobal('fetch', transport.fetch);
    const logs = diagnosticLogger();
    const presence = createRuntime(logs.logger);
    try {
      attach(presence);
      await logs.joined;
      presence.setMachineOnline(MACHINE_ID);
      const oldPost = await transport.nextPost(0);
      await presence.detachStreams();
      expect(oldPost.signal?.aborted).toBe(false);
      attach(presence);
      await presence.waitUntilJoined(1_000);
      oldPost.response.resolve(new Response(null, { status: 204 }));
      await oldPost.finished.promise;
      await logs.stage('post_response');
      expect(logs.records.find((record) => record.fields.stage === 'post_response')).toMatchObject({
        fields: { generation: 1 },
      });
      expect(logs.records.filter((record) => record.fields.stage === 'close_returned')).toEqual([
        expect.objectContaining({
          fields: expect.objectContaining({
            generation: 1,
            postPending: 1,
            peerReceipt: 'unavailable',
          }),
        }),
      ]);
    } finally {
      await presence.stop();
      await transport.releaseAll();
    }
  });
});

// Pins the current upstream contract. These are boundary observations, not
// lifecycle guarantees: upgrading streams-crdt must revisit the close case.
describe('streams-crdt 0.16.2 public boundary', () => {
  it('waitUntilSynced captures chains, follows same-key replacement, and excludes later independent writes', async () => {
    const transport = controlledTransport();
    const store = new EphemeralStore(LODY_PRESENCE_TTL_MS);
    const received = new EphemeralStore(LODY_PRESENCE_TTL_MS);
    const room = new EphemeralStreamCrdt({
      streamUrl: 'https://synthetic.invalid/room?ephemeral=presence',
      adaptor: EphemeralStoreAdaptor(store),
      fetch: transport.fetch,
    });
    try {
      const joined = await room.join();
      if (!joined.ok) throw new Error('synthetic join failed');
      expect(joined.value.lastLocalAppendAtMs).toBeUndefined();
      expect(joined.value.lastWriteError).toBeUndefined();
      store.set('blocker', 1);
      const first = await transport.nextPost(0);
      store.set('target', 1);
      const barrier = joined.value.waitUntilSynced();
      store.set('target', 2);
      store.set('later', 3);
      expect(joined.value.pendingLocalCount).toBe(4);
      first.response.resolve(new Response(null, { status: 204 }));
      const second = await transport.nextPost(1);
      received.apply(second.bytes);
      expect(received.get('target')).toBe(2);
      second.response.resolve(new Response(null, { status: 204 }));
      await barrier;
      await transport.nextPost(2);
      expect(joined.value.pendingLocalCount).toBe(1);
      expect(received.get('later')).toBeUndefined();
    } finally {
      await room.close();
      await transport.releaseAll();
      store.destroy();
      received.destroy();
    }
  });

  it('applies bootstrap and live reads while outbound flush still prevents join from returning', async () => {
    const transport = controlledTransport();
    const store = new EphemeralStore(LODY_PRESENCE_TTL_MS);
    const peer = new EphemeralStore(LODY_PRESENCE_TTL_MS);
    const applied = Promise.withResolvers<void>();
    const unsubscribe = store.subscribe(() => {
      if (store.get('peer') === 7) applied.resolve();
    });
    const room = new EphemeralStreamCrdt({
      streamUrl: 'https://synthetic.invalid/room?ephemeral=presence',
      adaptor: EphemeralStoreAdaptor(store),
      fetch: transport.fetch,
    });
    let returned = false;
    const joining = room.join().then((result) => {
      returned = true;
      return result;
    });
    try {
      store.set('local-during-join', 1);
      const post = await transport.nextPost(0);
      peer.set('peer', 7);
      transport.receive(peer.encodeAll());
      await applied.promise;
      expect(returned).toBe(false);
      post.response.resolve(new Response(null, { status: 204 }));
      expect((await joining).ok).toBe(true);
      expect(store.get('peer')).toBe(7);
    } finally {
      await room.close();
      await joining;
      await transport.releaseAll();
      unsubscribe();
      store.destroy();
      peer.destroy();
    }
  });

  it('close rejects the barrier and unsubscribes local updates while the actual POST remains unfinished', async () => {
    const transport = controlledTransport();
    const store = new EphemeralStore(LODY_PRESENCE_TTL_MS);
    const room = new EphemeralStreamCrdt({
      streamUrl: 'https://synthetic.invalid/room?ephemeral=presence',
      adaptor: EphemeralStoreAdaptor(store),
      fetch: transport.fetch,
    });
    try {
      const joined = await room.join();
      if (!joined.ok) throw new Error('synthetic join failed');
      store.set('test', 1);
      const post = await transport.nextPost(0);
      const barrier = joined.value.waitUntilSynced().then(
        () => 'complete',
        () => 'rejected'
      );
      let finished = false;
      void post.finished.promise.then(() => {
        finished = true;
      });
      await room.close();
      expect(await barrier).toBe('rejected');
      expect(finished).toBe(false);
      expect(post.signal?.aborted).toBe(false);
      const pending = joined.value.pendingLocalCount;
      store.set('after-close', 2);
      expect(joined.value.pendingLocalCount).toBe(pending);
      post.response.resolve(new Response(null, { status: 204 }));
      await post.finished.promise;
      expect(finished).toBe(true);
    } finally {
      await room.close();
      await transport.releaseAll();
      store.destroy();
    }
  });
});
// Native kernel acceptance uses injected I/O capabilities until the upstream release
// is consumed. The final integration suite must also exercise its real fetch boundary.
import { it as effectIt } from '@effect/vitest';
import { Cause, Clock, Deferred, Effect, Exit, Fiber, Layer } from 'effect';
import { TestClock } from 'effect/testing';
import {
  PresenceHost,
  PresenceTransport,
  PresenceReleaseFailed,
  PresenceUnavailable,
  makeWorkspacePresence,
  type PresenceStream,
  type PresenceStats,
  PresenceDeliveryStalled,
  WorkspacePresenceOwnersLive,
  recoverWorkspacePresenceShutdown,
} from './workspace-presence';

const nativeFixture = Effect.fnUntraced(function* (
  releaseTimeoutMs = 100,
  holdJoinCleanup = false
) {
  const clock = yield* Clock.Clock;
  const events: Array<{ stage: string; generation: number; code?: string; ageMs?: number }> = [];
  const rooms: Array<{
    readonly started: Deferred.Deferred<void>;
    readonly bootstrap: Deferred.Deferred<void>;
    readonly closing: Deferred.Deferred<void>;
    readonly released: Deferred.Deferred<void>;
    readonly ack: Deferred.Deferred<void>;
    readonly joinCleanup: Deferred.Deferred<void>;
    readonly cancellingJoin: Deferred.Deferred<void>;
    readonly receiver: EphemeralStore;
    readonly store: EphemeralStore;
    readonly status: (status: string) => void;
    readonly stats: PresenceStats;
    live: boolean;
    joinFailure?: Cause.Cause<unknown>;
    rejoinFailure?: Cause.Cause<unknown>;
    releaseFailure?: Cause.Cause<unknown>;
  }> = [];
  const io = Layer.succeed(PresenceTransport, {
    isReleaseFailure: (cause) =>
      cause.reasons.some(
        (reason) => Cause.isFailReason(reason) && reason.error instanceof PresenceReleaseFailed
      ),
    create: (_workspaceId, store) =>
      Effect.gen(function* () {
        const started = yield* Deferred.make<void>();
        const bootstrap = yield* Deferred.make<void>();
        const closing = yield* Deferred.make<void>();
        const released = yield* Deferred.make<void>();
        const ack = yield* Deferred.make<void>();
        const joinCleanup = yield* Deferred.make<void>();
        const cancellingJoin = yield* Deferred.make<void>();
        const receiver = new EphemeralStore(LODY_PRESENCE_TTL_MS);
        let notify: (status: string) => void = () => {};
        const stats = {
          status: 'connecting',
          pendingLocalCount: 1,
          physicalEntries: 1,
          queuedBytes: 64,
          releasePending: 0,
        };
        const room = {
          started,
          bootstrap,
          closing,
          released,
          ack,
          joinCleanup,
          cancellingJoin,
          receiver,
          store,
          stats,
          live: true,
          joinFailure: undefined as Cause.Cause<unknown> | undefined,
          rejoinFailure: undefined as Cause.Cause<unknown> | undefined,
          releaseFailure: undefined as Cause.Cause<unknown> | undefined,
          status: (status: string) => {
            stats.status = status;
            notify(status);
          },
        };
        rooms.push(room);
        yield* Effect.addFinalizer(() => Effect.sync(() => receiver.destroy()));
        const close = Effect.uninterruptible(
          Effect.gen(function* () {
            yield* Deferred.succeed(closing, undefined);
            yield* Deferred.await(released);
            if (room.releaseFailure) return yield* Effect.failCause(room.releaseFailure);
            room.live = false;

            return undefined;
          })
        );
        const stream: PresenceStream = {
          stats,
          close,
          retryRelease: close,
          rejoin: Effect.suspend(() =>
            room.rejoinFailure
              ? Effect.failCause(room.rejoinFailure)
              : Effect.sync(() => room.status('joined'))
          ),
          join: ({ onStatusChange }) =>
            Effect.gen(function* () {
              notify = onStatusChange;
              yield* Deferred.succeed(started, undefined);
              yield* Deferred.await(bootstrap).pipe(
                Effect.onExit((exit) =>
                  Exit.isFailure(exit) && holdJoinCleanup
                    ? Effect.uninterruptible(
                        Deferred.succeed(cancellingJoin, undefined).pipe(
                          Effect.andThen(Deferred.await(joinCleanup)),
                          Effect.andThen(
                            Effect.suspend(() =>
                              room.releaseFailure
                                ? Effect.failCause(room.releaseFailure)
                                : Effect.void
                            )
                          )
                        )
                      )
                    : Effect.void
                )
              );
              if (room.joinFailure) return yield* Effect.failCause(room.joinFailure);
              room.status('joined');
              return {
                syncBarrier: () =>
                  Effect.gen(function* () {
                    yield* Deferred.await(ack);
                    receiver.apply(store.encodeAll());
                    stats.pendingLocalCount = 0;

                    return undefined;
                  }),
              };
            }),
        };
        return stream;
      }),
  });
  const host = Layer.succeed(PresenceHost, {
    instanceId: () => REMOTE_INSTANCE_ID,
    serverOffsetMs: () => 0,
    report: (_workspaceId, event) => {
      events.push(event);
    },
  });
  const owner = yield* makeWorkspacePresence('workspace-native' as WorkspaceId, {
    releaseTimeoutMs,
  }).pipe(Effect.provide(Layer.merge(io, host)));
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      for (const room of rooms) {
        room.releaseFailure = undefined;
        Deferred.doneUnsafe(room.released, Effect.void);
        Deferred.doneUnsafe(room.joinCleanup, Effect.void);
      }
    })
  );
  const attachEffect = owner.attach({
    streamsBaseUrl: 'https://synthetic.invalid',
    auth: () => Effect.succeed('synthetic-token'),
  });
  return { owner, attach: attachEffect, rooms, events, io, host, clock };
});

const readyNative = Effect.fnUntraced(function* (
  fixture: Effect.Success<ReturnType<typeof nativeFixture>>
) {
  yield* fixture.attach;
  const room = fixture.rooms[0];
  if (!room) return yield* Effect.die('No native room');
  yield* Deferred.await(room.started);
  yield* Deferred.succeed(room.bootstrap, undefined);
  yield* fixture.owner.waitUntilJoined(1000);
  return room;
});

describe('native workspace presence ownership', () => {
  effectIt.effect('keeps origin partition and local heartbeat after cloud revoke', () =>
    Effect.gen(function* () {
      const fixture = yield* nativeFixture();
      const room = yield* readyNative(fixture);
      const { owner } = fixture;
      owner.replica.setMachineOnline(MACHINE_ID, 10);
      const peer = new EphemeralStore(LODY_PRESENCE_TTL_MS);
      peer.set('synthetic-peer', {
        kind: 'machine',
        machineId: REMOTE_MACHINE_ID,
        instanceId: REMOTE_INSTANCE_ID,
        updatedAt: 10,
      });
      room.store.apply(peer.encodeAll());
      peer.destroy();
      const local = new EphemeralStore(LODY_PRESENCE_TTL_MS);
      local.apply(owner.replica.encodeLocalOriginPresence());
      expect(
        Object.values(parseLodyPresenceStates(local.getAllStates())).some(
          (s) => s.kind === 'machine' && s.machineId === REMOTE_MACHINE_ID
        )
      ).toBe(false);
      local.destroy();
      expect(
        Object.values(owner.replica.getPresenceStates()).some(
          (s) => s.kind === 'machine' && s.machineId === REMOTE_MACHINE_ID
        )
      ).toBe(true);
      yield* Deferred.succeed(room.released, undefined);
      yield* owner.detach;
      yield* TestClock.adjust(LODY_PRESENCE_HEARTBEAT_MS);
      const state = Object.values(owner.replica.getPresenceStates()).find(
        (s) => s.kind === 'machine' && s.machineId === MACHINE_ID
      );
      expect(state?.updatedAt).toBe(LODY_PRESENCE_HEARTBEAT_MS);
      expect(room.live).toBe(false);
      yield* owner.stop;

      return undefined;
    })
  );

  effectIt.effect('cancelled/timed-out readiness waiters leave the shared join usable', () =>
    Effect.gen(function* () {
      const fixture = yield* nativeFixture();
      yield* fixture.attach;
      const room = fixture.rooms[0];
      if (!room) return yield* Effect.die('No room');
      yield* Deferred.await(room.started);
      const cancelled = yield* Effect.forkChild(fixture.owner.waitUntilJoined(1000));
      const timed = yield* Effect.forkChild(fixture.owner.waitUntilJoined(10).pipe(Effect.exit));
      yield* Fiber.interrupt(cancelled);
      yield* TestClock.adjust(10);
      const expired = yield* Fiber.join(timed);
      expect(Exit.isFailure(expired)).toBe(true);
      expect(room.live).toBe(true);
      yield* Deferred.succeed(room.bootstrap, undefined);
      yield* fixture.owner.waitUntilJoined(1000);
      yield* Deferred.succeed(room.released, undefined);
      yield* fixture.owner.stop;

      return undefined;
    })
  );

  effectIt.effect(
    'concurrent stop joins cleanup and rejects replacement until actual completion',
    () =>
      Effect.gen(function* () {
        const fixture = yield* nativeFixture();
        const room = yield* readyNative(fixture);
        const first = yield* Effect.forkChild(fixture.owner.stop.pipe(Effect.exit));
        yield* Deferred.await(room.closing);
        const secondEntered = yield* Deferred.make<void>();
        const second = yield* Effect.forkChild(
          Deferred.succeed(secondEntered, undefined).pipe(
            Effect.andThen(fixture.owner.stop.pipe(Effect.exit))
          )
        );
        yield* Deferred.await(secondEntered);
        yield* Effect.yieldNow;
        expect(second.pollUnsafe()).toBeUndefined();
        const replacement = yield* fixture.attach.pipe(Effect.exit);
        expect(Exit.isFailure(replacement)).toBe(true);
        yield* Deferred.succeed(room.released, undefined);
        expect(Exit.isSuccess(yield* Fiber.join(first))).toBe(true);
        expect(Exit.isSuccess(yield* Fiber.join(second))).toBe(true);
        expect(fixture.owner.isReleased()).toBe(true);
        expect(room.live).toBe(false);

        return undefined;
      })
  );

  effectIt.effect(
    'bounded cleanup retains owner, blocks a new generation, and permits awaited recovery',
    () =>
      Effect.gen(function* () {
        const fixture = yield* nativeFixture();
        const room = yield* readyNative(fixture);
        const close = yield* Effect.forkChild(fixture.owner.detach.pipe(Effect.exit));
        yield* Deferred.await(room.closing);
        yield* TestClock.adjust(100);
        const failed = yield* Fiber.join(close);
        expect(Exit.isFailure(failed)).toBe(true);
        if (Exit.isFailure(failed)) {
          const error = failed.cause.reasons.find(Cause.isFailReason)?.error;
          expect(error).toBeInstanceOf(PresenceReleaseFailed);
          expect(error instanceof PresenceReleaseFailed && error.owner).toBe(fixture.owner);
        }
        expect(room.live).toBe(true);
        expect(Exit.isFailure(yield* fixture.attach.pipe(Effect.exit))).toBe(true);
        yield* Deferred.succeed(room.released, undefined);
        yield* fixture.owner.retryCleanup;
        expect(room.live).toBe(false);
        yield* fixture.attach;
        const next = fixture.rooms[1];
        if (!next) return yield* Effect.die('No replacement');
        yield* Deferred.succeed(next.released, undefined);
        yield* fixture.owner.stop;

        return undefined;
      })
  );

  effectIt.effect('retains simultaneous typed and release defect Causes', () =>
    Effect.gen(function* () {
      const fixture = yield* nativeFixture();
      const room = yield* readyNative(fixture);
      const body = new Error('synthetic-body');
      const release = new Error('synthetic-release');
      room.releaseFailure = Cause.combine(Cause.fail(body), Cause.die(release));
      yield* Deferred.succeed(room.released, undefined);
      const stopped = yield* fixture.owner.stop.pipe(Effect.exit);
      expect(Exit.isFailure(stopped)).toBe(true);
      expect(
        fixture.owner.failure().reasons.some((r) => Cause.isFailReason(r) && r.error === body)
      ).toBe(true);
      expect(
        fixture.owner.failure().reasons.some((r) => Cause.isDieReason(r) && r.defect === release)
      ).toBe(true);
      expect(fixture.owner.isReleased()).toBe(false);
      room.releaseFailure = undefined;
      yield* fixture.owner.retryCleanup;
      expect(fixture.owner.isReleased()).toBe(true);

      return undefined;
    })
  );

  effectIt.effect(
    'ignores old generation callbacks and republishes current local state on rejoin',
    () =>
      Effect.gen(function* () {
        const fixture = yield* nativeFixture();
        const room = yield* readyNative(fixture);
        fixture.owner.replica.setMachineOnline(MACHINE_ID, 10);
        yield* Deferred.succeed(room.released, undefined);
        yield* fixture.owner.detach;
        yield* fixture.attach;
        const next = fixture.rooms[1];
        if (!next) return yield* Effect.die('No replacement');
        room.status('joined');
        const before = yield* Effect.forkChild(fixture.owner.waitUntilJoined(1).pipe(Effect.exit));
        yield* TestClock.adjust(1);
        expect(Exit.isFailure(yield* Fiber.join(before))).toBe(true);
        fixture.owner.replica.setSessionPresence(
          {
            sessionId: SESSION_ID,
            machineId: MACHINE_ID,
            status: SessionStatusFactory.initializing(),
          },
          1
        );
        yield* Deferred.succeed(next.bootstrap, undefined);
        yield* fixture.owner.waitUntilJoined(1000);
        yield* TestClock.adjust(LODY_PRESENCE_HEARTBEAT_MS);
        yield* Deferred.succeed(next.ack, undefined);
        // Observing a receiver is stronger than asserting the transport was called.
        yield* Effect.yieldNow;
        const received = parseLodyPresenceStates(next.receiver.getAllStates());
        expect(
          Object.values(received).some((s) => s.kind === 'session' && s.sessionId === SESSION_ID)
        ).toBe(true);
        yield* Deferred.succeed(next.released, undefined);
        yield* fixture.owner.stop;

        return undefined;
      })
  );

  effectIt.effect(
    'healthy reads with a held upload report bounded no-progress health without a reconnect storm',
    () =>
      Effect.gen(function* () {
        const fixture = yield* nativeFixture();
        const room = yield* readyNative(fixture);
        fixture.owner.replica.setMachineOnline(MACHINE_ID, 0);
        yield* TestClock.adjust(LODY_PRESENCE_TTL_MS * 2);
        expect(room.stats.status).toBe('joined');
        expect(room.receiver.getAllStates()).toEqual({});
        expect(fixture.events.filter((e) => e.stage === 'stall').map((e) => e.code)).toEqual([
          'upload_no_progress',
        ]);
        expect(fixture.events.filter((e) => e.stage === 'retry')).toEqual([]);
        expect(fixture.owner.deliveryHealth()).toBeInstanceOf(PresenceDeliveryStalled);
        yield* Deferred.succeed(room.ack, undefined);
        yield* TestClock.adjust(LODY_PRESENCE_HEARTBEAT_MS);
        expect(fixture.owner.deliveryHealth()).toBe('idle');
        expect(
          Object.values(parseLodyPresenceStates(room.receiver.getAllStates())).some(
            (state) => state.kind === 'machine' && state.machineId === MACHINE_ID
          )
        ).toBe(true);
        yield* Deferred.succeed(room.released, undefined);
        yield* fixture.owner.stop;

        return undefined;
      })
  );
});

effectIt.effect(
  'cancellation waits for join finalizers and preserves their late complete Cause',
  () =>
    Effect.gen(function* () {
      const fixture = yield* nativeFixture(100, true);
      yield* fixture.attach;
      const room = fixture.rooms[0];
      if (!room) return yield* Effect.die('No room');
      yield* Deferred.await(room.started);
      const closing = yield* Effect.forkChild(fixture.owner.detach.pipe(Effect.exit));
      yield* Deferred.await(room.closing);
      yield* Deferred.await(room.cancellingJoin);
      yield* Deferred.succeed(room.released, undefined);
      yield* TestClock.adjust(100);
      expect(Exit.isFailure(yield* Fiber.join(closing))).toBe(true);
      expect(Exit.isFailure(yield* fixture.attach.pipe(Effect.exit))).toBe(true);
      const body = new Error('synthetic-late-body');
      const defect = new Error('synthetic-late-release');
      room.releaseFailure = Cause.combine(Cause.fail(body), Cause.die(defect));
      yield* Deferred.succeed(room.joinCleanup, undefined);
      yield* fixture.owner.retryCleanup;
      expect(
        fixture.owner.failure().reasons.some((r) => Cause.isFailReason(r) && r.error === body)
      ).toBe(true);
      expect(
        fixture.owner.failure().reasons.some((r) => Cause.isDieReason(r) && r.defect === defect)
      ).toBe(true);
      yield* fixture.owner.stop;

      return undefined;
    })
);

import { makeApplicationRuntime } from '@lody/shared/node/application-runtime';
import {
  bindWorkspacePresenceApplicationLegacy,
  createCliPresenceRuntimeLegacy,
  WorkspacePresenceLegacyFailure,
} from './presence-legacy';

effectIt.effect(
  'the explicit Legacy consumer uses the application owner and awaits its shared stop',
  () =>
    Effect.gen(function* () {
      const fixture = yield* nativeFixture();
      const application = makeApplicationRuntime(
        WorkspacePresenceOwnersLive.pipe(EffectLayerDependencies(fixture)),
        {
          recover: (cause) => Effect.failCause(cause),
          project: (cause) => new WorkspacePresenceLegacyFailure(cause),
        }
      );
      bindWorkspacePresenceApplicationLegacy(application);
      const consumer = yield* Effect.promise(() =>
        createCliPresenceRuntimeLegacy('workspace-legacy' as WorkspaceId)
      );
      consumer.setMachineOnline(MACHINE_ID);
      yield* Effect.promise(() =>
        consumer.attachStreams({
          streamsBaseUrl: 'https://synthetic.invalid',
          auth: () => Effect.succeed('synthetic-token'),
        })
      );
      const room = fixture.rooms[0];
      if (!room) return yield* Effect.die('No Legacy room');
      yield* Deferred.await(room.started);
      yield* Deferred.succeed(room.bootstrap, undefined);
      expect(yield* Effect.promise(() => consumer.waitUntilJoined(1000))).toBe(true);
      consumer.setMachineOnline(MACHINE_ID);
      yield* TestClock.adjust(LODY_PRESENCE_HEARTBEAT_MS);
      expect(
        Object.values(consumer.getPresenceStates()).find((state) => state.kind === 'machine')
          ?.updatedAt
      ).toBe(LODY_PRESENCE_HEARTBEAT_MS);
      const first = yield* Effect.forkChild(Effect.promise(() => consumer.stop()));
      yield* Deferred.await(room.closing);
      const second = yield* Effect.forkChild(Effect.promise(() => consumer.stop()));
      expect(second.pollUnsafe()).toBeUndefined();
      consumer.setMachineOnline(REMOTE_MACHINE_ID);
      expect(
        Object.values(consumer.getPresenceStates()).some(
          (s) => s.kind === 'machine' && s.machineId === REMOTE_MACHINE_ID
        )
      ).toBe(false);
      yield* Deferred.succeed(room.released, undefined);
      yield* Fiber.join(first);
      yield* Fiber.join(second);
      expect(room.live).toBe(false);
      yield* Effect.promise(() => application.closeLegacy());
      expect(application.isReleased()).toBe(true);

      return undefined;
    })
);

function EffectLayerDependencies(fixture: Effect.Success<ReturnType<typeof nativeFixture>>) {
  const clock = Layer.succeed(Clock.Clock, fixture.clock);
  return (layer: typeof WorkspacePresenceOwnersLive) =>
    Layer.merge(layer.pipe(Layer.provide(Layer.mergeAll(fixture.io, fixture.host, clock))), clock);
}

effectIt.effect('application disposal stops active workspaces before reporting release', () =>
  Effect.gen(function* () {
    const fixture = yield* nativeFixture();
    const application = makeApplicationRuntime(
      WorkspacePresenceOwnersLive.pipe(EffectLayerDependencies(fixture)),
      {
        recover: (cause) => Effect.failCause(cause),
        project: (cause) => new WorkspacePresenceLegacyFailure(cause),
      }
    );
    bindWorkspacePresenceApplicationLegacy(application);
    const consumer = yield* Effect.promise(() =>
      createCliPresenceRuntimeLegacy('workspace-application-close' as WorkspaceId)
    );
    yield* Effect.promise(() =>
      consumer.attachStreams({
        streamsBaseUrl: 'https://synthetic.invalid',
        auth: () => Effect.succeed('synthetic-token'),
      })
    );
    const room = fixture.rooms[0];
    if (!room) return yield* Effect.die('No application room');
    yield* Deferred.await(room.started);
    yield* Deferred.succeed(room.bootstrap, undefined);
    expect(yield* Effect.promise(() => consumer.waitUntilJoined(1000))).toBe(true);
    const closing = yield* Effect.forkChild(Effect.promise(() => application.closeLegacy()));
    yield* Deferred.await(room.closing);
    expect(application.isClosing()).toBe(true);
    expect(application.isReleased()).toBe(false);
    const refused = yield* Effect.tryPromise(() =>
      createCliPresenceRuntimeLegacy('new-workspace' as WorkspaceId)
    ).pipe(Effect.exit);
    expect(Exit.isFailure(refused)).toBe(true);
    yield* Deferred.succeed(room.released, undefined);
    yield* Fiber.join(closing);
    expect(room.live).toBe(false);
    expect(application.isReleased()).toBe(true);
    return undefined;
  })
);

effectIt.effect(
  'failed application disposal keeps workspace recovery owners after the runtime closes',
  () =>
    Effect.gen(function* () {
      const fixture = yield* nativeFixture();
      const application = makeApplicationRuntime(
        WorkspacePresenceOwnersLive.pipe(EffectLayerDependencies(fixture)),
        {
          recover: recoverWorkspacePresenceShutdown,
          project: (cause) => new WorkspacePresenceLegacyFailure(cause),
        }
      );
      bindWorkspacePresenceApplicationLegacy(application);
      const consumer = yield* Effect.promise(() =>
        createCliPresenceRuntimeLegacy('workspace-failed-application-close' as WorkspaceId)
      );
      yield* Effect.promise(() =>
        consumer.attachStreams({
          streamsBaseUrl: 'https://synthetic.invalid',
          auth: () => Effect.succeed('synthetic-token'),
        })
      );
      const room = fixture.rooms[0];
      if (!room) return yield* Effect.die('No recovery room');
      yield* Deferred.await(room.started);
      yield* Deferred.succeed(room.bootstrap, undefined);
      expect(yield* Effect.promise(() => consumer.waitUntilJoined(1000))).toBe(true);
      const releaseFailure = new Error('synthetic-application-release');
      room.releaseFailure = Cause.die(releaseFailure);
      yield* Deferred.succeed(room.released, undefined);
      const failed = yield* Effect.tryPromise(() => application.closeLegacy()).pipe(Effect.exit);
      expect(Exit.isFailure(failed)).toBe(true);
      expect(room.live).toBe(true);
      expect(application.isReleased()).toBe(false);
      const again = yield* Effect.tryPromise(() => application.closeLegacy()).pipe(Effect.exit);
      expect(Exit.isFailure(again)).toBe(true);
      room.releaseFailure = undefined;
      yield* Effect.promise(() => application.closeLegacy());
      expect(room.live).toBe(false);
      expect(application.isReleased()).toBe(true);
      return undefined;
    })
);

effectIt.effect('bootstrap readiness becomes unknown during recovery and flap backoff grows', () =>
  Effect.gen(function* () {
    const fixture = yield* nativeFixture();
    const room = yield* readyNative(fixture);
    fixture.owner.replica.setMachineOnline(MACHINE_ID, 0);
    room.status('disconnected');
    const firstUnknown = yield* Effect.forkChild(
      fixture.owner.waitUntilJoined(1000).pipe(Effect.exit)
    );
    yield* TestClock.adjust(1000);
    expect(Exit.isFailure(yield* Fiber.join(firstUnknown))).toBe(true);
    yield* TestClock.adjust(1000);
    yield* fixture.owner.waitUntilJoined(1000);
    const first = Object.values(fixture.owner.replica.getPresenceStates()).find(
      (s) => s.kind === 'machine'
    );
    expect(first?.updatedAt).toBe(2000);
    room.status('disconnected');
    const secondUnknown = yield* Effect.forkChild(
      fixture.owner.waitUntilJoined(4000).pipe(Effect.exit)
    );
    yield* TestClock.adjust(4000);
    expect(Exit.isFailure(yield* Fiber.join(secondUnknown))).toBe(true);
    yield* TestClock.adjust(1000);
    yield* fixture.owner.waitUntilJoined(1000);
    const latest = Object.values(fixture.owner.replica.getPresenceStates()).find(
      (s) => s.kind === 'machine'
    );
    expect(latest?.updatedAt).toBe(7000);
    yield* Deferred.succeed(room.released, undefined);
    yield* fixture.owner.stop;
    return undefined;
  })
);

effectIt.effect(
  'hung first bootstrap gives unknown readiness and one bounded diagnostic without overlapping joins',
  () =>
    Effect.gen(function* () {
      const fixture = yield* nativeFixture();
      yield* fixture.attach;
      const room = fixture.rooms[0];
      if (!room) return yield* Effect.die('No bootstrap room');
      yield* Deferred.await(room.started);
      const reader = yield* Effect.forkChild(
        fixture.owner.waitUntilJoined(10_000).pipe(Effect.exit)
      );
      yield* TestClock.adjust(10_000);
      const unknown = yield* Fiber.join(reader);
      expect(Exit.isFailure(unknown)).toBe(true);
      expect(
        fixture.owner
          .failure()
          .reasons.some(
            (reason) =>
              Cause.isFailReason(reason) &&
              reason.error instanceof PresenceUnavailable &&
              reason.error.stage === 'bootstrap'
          )
      ).toBe(true);
      yield* TestClock.adjust(20_000);
      expect(
        fixture.events.filter((event) => event.code === 'first_join_no_bootstrap')
      ).toHaveLength(1);
      expect(fixture.rooms).toHaveLength(1);
      expect(room.live).toBe(true);
      yield* Deferred.succeed(room.bootstrap, undefined);
      yield* fixture.owner.waitUntilJoined(1000);
      yield* Deferred.succeed(room.released, undefined);
      yield* fixture.owner.stop;
      return undefined;
    })
);

effectIt.effect('typed transport release failure blocks rejoin even with no pending raw I/O', () =>
  Effect.gen(function* () {
    const fixture = yield* nativeFixture();
    yield* fixture.attach;
    const room = fixture.rooms[0];
    if (!room) return yield* Effect.die('No typed release room');
    yield* Deferred.await(room.started);
    const cause = Cause.fail(new Error('synthetic-release-failure'));
    room.joinFailure = Cause.fail(
      new PresenceReleaseFailed({ cause, owner: fixture.owner, generation: 1 })
    );
    expect(room.stats.releasePending).toBe(0);
    yield* Deferred.succeed(room.bootstrap, undefined);
    const unavailable = yield* fixture.owner.waitUntilJoined(1000).pipe(Effect.exit);
    expect(Exit.isFailure(unavailable)).toBe(true);
    yield* TestClock.adjust(60_000);
    const refused = yield* fixture.attach.pipe(Effect.exit);
    expect(Exit.isFailure(refused)).toBe(true);
    expect(
      fixture.owner
        .failure()
        .reasons.some(
          (reason) => Cause.isFailReason(reason) && reason.error instanceof PresenceReleaseFailed
        )
    ).toBe(true);
    expect(fixture.events.some((event) => event.stage === 'joined')).toBe(false);
    yield* Deferred.succeed(room.released, undefined);
    yield* fixture.owner.stop;
    return undefined;
  })
);

effectIt.effect('failed rejoin retains a release owner and stops retry admission', () =>
  Effect.gen(function* () {
    const fixture = yield* nativeFixture();
    const room = yield* readyNative(fixture);
    room.rejoinFailure = Cause.fail(
      new PresenceReleaseFailed({
        cause: Cause.fail(new Error('synthetic-rejoin-release')),
        owner: fixture.owner,
        generation: 1,
      })
    );
    room.status('disconnected');
    yield* TestClock.adjust(2000);
    const unavailable = yield* fixture.owner.waitUntilJoined(1000).pipe(Effect.exit);
    expect(Exit.isFailure(unavailable)).toBe(true);
    expect(
      fixture.owner
        .failure()
        .reasons.some(
          (reason) => Cause.isFailReason(reason) && reason.error instanceof PresenceReleaseFailed
        )
    ).toBe(true);
    yield* TestClock.adjust(60_000);
    expect(room.stats.status).toBe('disconnected');
    expect(fixture.events.some((event) => event.code === 'rejoin_failed')).toBe(false);
    const refused = yield* fixture.attach.pipe(Effect.exit);
    expect(Exit.isFailure(refused)).toBe(true);
    yield* Deferred.succeed(room.released, undefined);
    yield* fixture.owner.stop;
    return undefined;
  })
);

effectIt.effect(
  'retirement callback failure fences writes, closes I/O and transfers a recoverable full Cause',
  () =>
    Effect.gen(function* () {
      const fixture = yield* nativeFixture();
      const room = yield* readyNative(fixture);
      fixture.owner.replica.setMachineOnline(MACHINE_ID, 0);
      fixture.owner.replica.setSessionPresence(
        {
          sessionId: SESSION_ID,
          machineId: MACHINE_ID,
          status: SessionStatusFactory.initializing(),
        },
        0
      );
      const defect = new Error('synthetic-retirement-callback');
      const unsubscribe = fixture.owner.replica.subscribeLocalOriginPresence(() => {
        throw defect;
      });
      yield* Deferred.succeed(room.released, undefined);
      const failed = yield* fixture.owner.stop.pipe(Effect.exit);
      expect(Exit.isFailure(failed)).toBe(true);
      if (Exit.isFailure(failed)) {
        const error = failed.cause.reasons.find(Cause.isFailReason)?.error;
        expect(error instanceof PresenceReleaseFailed && error.owner).toBe(fixture.owner);
      }
      expect(room.live).toBe(false);
      expect(fixture.owner.isReleased()).toBe(false);
      fixture.owner.replica.setMachineOnline(REMOTE_MACHINE_ID, 1);
      expect(
        Object.values(fixture.owner.replica.getPresenceStates()).some(
          (state) => state.kind === 'machine' && state.machineId === REMOTE_MACHINE_ID
        )
      ).toBe(false);
      unsubscribe();
      yield* fixture.owner.retryCleanup;
      expect(fixture.owner.isReleased()).toBe(true);
      expect(fixture.owner.replica.getPresenceStates()).toEqual({});
      expect(
        fixture.owner
          .failure()
          .reasons.some((reason) => Cause.isDieReason(reason) && reason.defect === defect)
      ).toBe(true);
      return undefined;
    })
);

effectIt.effect(
  'failed heartbeat keeps its Cause and recovery waits for actual lower cleanup',
  () =>
    Effect.gen(function* () {
      const fixture = yield* nativeFixture();
      const room = yield* readyNative(fixture);
      fixture.owner.replica.setMachineOnline(MACHINE_ID, 0);
      const defect = new Error('synthetic-heartbeat-callback');
      const unsubscribe = fixture.owner.replica.subscribeLocalOriginPresence(() => {
        throw defect;
      });
      yield* TestClock.adjust(LODY_PRESENCE_HEARTBEAT_MS);
      unsubscribe();
      yield* Deferred.succeed(room.released, undefined);
      const failed = yield* fixture.owner.stop.pipe(Effect.exit);
      expect(Exit.isFailure(failed)).toBe(true);
      expect(room.live).toBe(false);
      expect(fixture.owner.isReleased()).toBe(false);
      yield* fixture.owner.retryCleanup;
      expect(fixture.owner.isReleased()).toBe(true);
      expect(
        fixture.owner
          .failure()
          .reasons.some((reason) => Cause.isDieReason(reason) && reason.defect === defect)
      ).toBe(true);
      return undefined;
    })
);
