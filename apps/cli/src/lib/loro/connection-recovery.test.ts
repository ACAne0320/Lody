import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceId } from '@lody/shared';
import { Effect, Scope, Stream, SubscriptionRef } from 'effect';
import { RepoIOError, type RoomStatus } from 'loro-repo/effect';
import { WorkspaceRepoLegacy } from '@lody/shared/workspace-data/repo-legacy';
import type {
  LoroRepo,
  TransportConnectionStatus,
  TransportRoomStatus,
  TransportSubscription,
} from 'loro-repo';

import type { Logger } from '@/utils/logger';
import { LoroConnectionRecoveryController } from './connection-recovery';

const createLogger = (): Logger =>
  ({
    debug: vi.fn(),
    trace: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }) as unknown as Logger;

type FakeMetaSub = TransportSubscription & {
  emitStatus: (status: TransportRoomStatus) => void;
};

const createMetaSub = (initialStatus: TransportRoomStatus = 'joined'): FakeMetaSub => {
  const listeners = new Set<(status: TransportRoomStatus) => void>();
  const sub = {
    status: initialStatus,
    firstSyncedWithRemote: Promise.resolve(),
    waitUntilSynced: vi.fn(async () => {}),
    unsubscribe: vi.fn(),
    rejoin: vi.fn(),
    onStatusChange: (listener: (status: TransportRoomStatus) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emitStatus: (status: TransportRoomStatus) => {
      sub.status = status;
      for (const listener of listeners) listener(status);
    },
    // The production code reads room state through the per-transport
    // 'streams' binding, never the classic surface. A fake without this
    // would silently exercise a different code path than production.
    subscription: (transportId: string) => ({
      transportId,
      get status() {
        return sub.status;
      },
      firstSyncedWithRemote: sub.firstSyncedWithRemote,
      waitUntilSynced: sub.waitUntilSynced,
      rejoin: sub.rejoin,
      onStatusChange: sub.onStatusChange,
    }),
    subscriptions: () => [],
    transportIds: () => ['streams'],
  };
  return sub as unknown as FakeMetaSub;
};

describe('LoroConnectionRecoveryController watchdog room sweep', () => {
  let controller: LoroConnectionRecoveryController | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
  });

  afterEach(async () => {
    await controller?.cleanUp();
    controller = null;
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  const createController = (
    repo: Partial<LoroRepo>,
    metaSub: FakeMetaSub | null,
    options: {
      readonly initialTransportStatus?: TransportConnectionStatus;
      readonly initialMetaSyncCompleted?: boolean;
    } = {}
  ) => {
    const initialMetaSyncCompleted = options.initialMetaSyncCompleted ?? true;
    controller = new LoroConnectionRecoveryController({
      repo: repo as LoroRepo,
      workspaceId: 'ws-recovery-test' as WorkspaceId,
      logger: createLogger(),
      initialMetaSub: metaSub,
      initialTransportStatus: options.initialTransportStatus ?? 'connected',
      initialMetaSyncPromise: Promise.resolve(initialMetaSyncCompleted),
      initialMetaSyncCompleted,
      onMetaRoomReady: vi.fn(),
    });
    return controller;
  };

  it('keeps healthy rooms and presence online across watchdog sweeps of a persistently failed room', async () => {
    // Advance only the controller's interval; native workers use their own scheduler.
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    const repo = await WorkspaceRepoLegacy.create({});
    const owner = await repo.acquireScopeLegacy('watchdog presence fixture');
    const healthy = await repo.runLegacy(SubscriptionRef.make<RoomStatus>('synced'));
    const broken = await repo.runLegacy(SubscriptionRef.make<RoomStatus>('failed'));
    const retryable = await repo.runLegacy(SubscriptionRef.make<RoomStatus>('synced'));
    const resetting = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<void>();
    let presenceOnline = true;
    const published: Uint8Array[] = [];
    let completed = Promise.withResolvers<void>();
    const reconnect = repo.reconnect.bind(repo);
    vi.spyOn(repo, 'reconnect').mockImplementation(async (options) => {
      try {
        return await reconnect(options);
      } finally {
        completed.resolve();
      }
    });
    try {
      await repo.addTransport('streams', {
        kind: 'native-workspace-transport',
        make: (id) =>
          Effect.succeed({
            id,
            authority: 'server',
            connect: Effect.void,
            disconnect: Effect.void,
            reconnect: Effect.gen(function* () {
              presenceOnline = false;
              yield* SubscriptionRef.set(healthy, 'offline');
              resetting.resolve();
              yield* Effect.promise(() => resume.promise);
              presenceOnline = true;
              yield* SubscriptionRef.set(healthy, 'synced');
            }),
            openEphemeral: () =>
              Effect.succeed({
                messages: Stream.never,
                close: Effect.void,
                publish: (message) =>
                  Effect.suspend(() => {
                    if (!presenceOnline)
                      return Effect.fail(new RepoIOError('presence offline', undefined));
                    published.push(message.slice());
                    return Effect.void;
                  }),
              }),
            join: (target, replica) =>
              Effect.gen(function* () {
                return {
                  status:
                    target.kind !== 'doc'
                      ? yield* SubscriptionRef.make<RoomStatus>('synced')
                      : target.id === 'broken'
                        ? broken
                        : target.id === 'retryable'
                          ? retryable
                          : healthy,
                  close: Effect.void,
                  sync: Effect.gen(function* () {
                    if (target.kind === 'doc' && target.id === 'broken')
                      return yield* Effect.fail(
                        new RepoIOError('synthetic permission denied', { status: 403 })
                      );
                    if (
                      target.kind === 'doc' &&
                      target.id === 'retryable' &&
                      replica.kind === 'doc'
                    ) {
                      replica.lease.doc.getText('body').insert(0, 'recovered;');
                      replica.lease.doc.commit();
                      yield* SubscriptionRef.set(retryable, 'synced');
                    }
                    return 'confirmed' as const;
                  }),
                };
              }),
          }),
      });
      const healthyRoom = await repo.joinDocRoom('healthy');
      const brokenRoom = await repo.joinDocRoom('broken');
      const retryableRoom = await repo.joinDocRoom('retryable');
      await repo.runLegacy(healthyRoom.native.awaitSynced('streams'));
      await repo.runLegacy(retryableRoom.native.awaitSynced('streams'));
      await repo.runLegacy(
        brokenRoom.native.status('streams').pipe(
          Stream.filter((status) => status === 'failed'),
          Stream.runHead
        )
      );
      const doc = (await repo.openPersistedDoc('retryable')).doc;
      const presence = await repo.runLegacy(
        repo.native
          .acquirePresence('streams', 'watchdog')
          .pipe(Effect.provideService(Scope.Scope, owner.scope))
      );
      const metaRoom = await repo.joinMetaRoom();
      await repo.runLegacy(metaRoom.native.awaitSynced('streams'));
      controller = new LoroConnectionRecoveryController({
        repo,
        workspaceId: 'ws-recovery-test' as WorkspaceId,
        logger: createLogger(),
        initialMetaSub: metaRoom,
        initialTransportStatus: 'connected',
        initialMetaSyncPromise: Promise.resolve(true),
        initialMetaSyncCompleted: true,
        onMetaRoomReady: vi.fn(),
      });
      for (let round = 1; round <= 3; round++) {
        completed = Promise.withResolvers<void>();
        await repo.runLegacy(SubscriptionRef.set(retryable, 'offline'));
        await repo.runLegacy(
          retryableRoom.native.status('streams').pipe(
            Stream.filter((status) => status === 'offline'),
            Stream.runHead
          )
        );
        await vi.advanceTimersByTimeAsync(30_000);
        await Promise.race([completed.promise, resetting.promise]);
        expect(await repo.runLegacy(healthyRoom.native.statusSnapshot('streams'))).toBe('synced');
        expect(await repo.runLegacy(brokenRoom.native.statusSnapshot('streams'))).toBe('failed');
        expect(await repo.runLegacy(retryableRoom.native.statusSnapshot('streams'))).toBe('synced');
        expect(doc.getText('body').toString()).toBe('recovered;'.repeat(round));
        await repo.runLegacy(presence.set('round', round));
        await repo.runLegacy(presence.sync);
        expect(JSON.parse(new TextDecoder().decode(published.at(-1))).values.round).toBe(round);
      }
    } finally {
      resume.resolve();
      await controller?.cleanUp();
      controller = null;
      await repo.runLegacy(owner.close);
      await repo.destroy();
    }
  });

  it('does not re-fire meta-synced listeners or rejoin meta on a healthy sweep', async () => {
    const reconnect = vi.fn(async () => {});
    const joinMetaRoom = vi.fn();
    const metaSub = createMetaSub('joined');
    const instance = createController({ reconnect, joinMetaRoom }, metaSub);

    const metaSynced = vi.fn();
    instance.onMetaRoomSynced(metaSynced);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(reconnect).toHaveBeenCalledTimes(1);
    // The healthy sweep must stay side-effect free: no meta room rejoin and no
    // meta-synced fan-out (those listeners trigger metadata recovery work).
    expect(joinMetaRoom).not.toHaveBeenCalled();
    expect(metaSynced).not.toHaveBeenCalled();
  });

  it('keeps the full recovery path when the meta room degrades', async () => {
    const reconnect = vi.fn(async () => {});
    const metaSub = createMetaSub('joined');
    const instance = createController({ reconnect, joinMetaRoom: vi.fn() }, metaSub);

    metaSub.emitStatus('error');
    // scheduleReconnect uses jittered exponential backoff starting at ~1s;
    // 5s comfortably covers attempt 0 including jitter.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(reconnect).toHaveBeenCalled();
    expect(instance.isRecovering()).toBe(true);

    metaSub.emitStatus('joined');
    await vi.advanceTimersByTimeAsync(0);
    expect(instance.isRecovering()).toBe(false);
  });

  it('treats an aggregate "connecting" caused by joining rooms as healthy', async () => {
    // `TransportConnectionStatus` aggregates every joined room, so lazily
    // joining a session room flips it to 'connecting' and back. In a workspace
    // with thousands of rooms that happens continuously. Each flip used to
    // count as a recovery episode: it re-emitted meta-synced, whose listeners
    // run O(rooms) recovery scans, which join more rooms, which flip the
    // aggregate again — a self-sustaining loop, ~one full scan every 2-4s.
    const reconnect = vi.fn(async () => {});
    const metaSub = createMetaSub('joined');
    const instance = createController({ reconnect, joinMetaRoom: vi.fn() }, metaSub);
    const metaSynced = vi.fn();
    instance.onMetaRoomSynced(metaSynced);

    expect(instance.getStreamsHealth()).toBe('connected');

    for (let round = 0; round < 10; round++) {
      instance.setTransportStatus('connecting');
      expect(instance.getStreamsHealth()).toBe('joining-rooms');
      expect(instance.isRecovering()).toBe(false);
      instance.setTransportStatus('connected');
      await vi.advanceTimersByTimeAsync(0);
    }

    expect(metaSynced).not.toHaveBeenCalled();
    expect(metaSub.waitUntilSynced).not.toHaveBeenCalled();

    // No reconnect was scheduled either: the backoff timer would have fired
    // well before the 30s watchdog sweep.
    await vi.advanceTimersByTimeAsync(29_000);
    expect(reconnect).not.toHaveBeenCalled();
  });

  it('reports one meta sync once rooms finish rejoining after a real disconnect', async () => {
    const reconnect = vi.fn(async () => {});
    const metaSub = createMetaSub('joined');
    const instance = createController({ reconnect, joinMetaRoom: vi.fn() }, metaSub);
    const metaSynced = vi.fn();
    instance.onMetaRoomSynced(metaSynced);

    instance.setTransportStatus('disconnected');
    expect(instance.getStreamsHealth()).toBe('recovering');
    expect(instance.isRecovering()).toBe(true);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(reconnect).toHaveBeenCalledTimes(1);
    expect(metaSynced).not.toHaveBeenCalled();

    // Rooms are back to merely joining: nothing is disconnected or errored
    // anymore, so this is the end of the recovery episode.
    instance.setTransportStatus('connecting');
    await vi.waitFor(() => expect(metaSynced).toHaveBeenCalledTimes(1));

    instance.setTransportStatus('connected');
    await vi.advanceTimersByTimeAsync(0);
    expect(metaSynced).toHaveBeenCalledTimes(1);
  });

  it('waits for aggregate transport recovery before reporting one meta sync', async () => {
    const reconnect = vi.fn(async () => {});
    const metaSub = createMetaSub('joined');
    const instance = createController({ reconnect, joinMetaRoom: vi.fn() }, metaSub);
    const metaSynced = vi.fn();
    instance.onMetaRoomSynced(metaSynced);

    instance.setTransportStatus('disconnected');

    await vi.advanceTimersByTimeAsync(1_000);
    expect(reconnect).toHaveBeenCalledTimes(1);
    expect(metaSub.waitUntilSynced).not.toHaveBeenCalled();
    expect(metaSynced).not.toHaveBeenCalled();

    // Recovery remains unhealthy, so the next attempt uses exponential
    // backoff instead of being reset by the still-joined meta room.
    await vi.advanceTimersByTimeAsync(1_999);
    expect(reconnect).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(reconnect).toHaveBeenCalledTimes(2);
    expect(metaSynced).not.toHaveBeenCalled();

    instance.setTransportStatus('connected');
    await vi.waitFor(() => expect(metaSynced).toHaveBeenCalledTimes(1));
    expect(metaSub.waitUntilSynced).toHaveBeenCalledTimes(1);

    instance.setTransportStatus('connected');
    await vi.advanceTimersByTimeAsync(0);
    expect(metaSynced).toHaveBeenCalledTimes(1);
  });

  it('reports each real meta-room recovery generation exactly once', async () => {
    const reconnect = vi.fn(async () => {});
    const metaSub = createMetaSub('joined');
    const instance = createController({ reconnect, joinMetaRoom: vi.fn() }, metaSub);
    const metaSynced = vi.fn();
    instance.onMetaRoomSynced(metaSynced);

    metaSub.emitStatus('error');
    metaSub.emitStatus('joined');
    await vi.advanceTimersByTimeAsync(0);

    expect(metaSub.waitUntilSynced).toHaveBeenCalledTimes(1);
    expect(metaSynced).toHaveBeenCalledTimes(1);

    metaSub.emitStatus('joined');
    await vi.advanceTimersByTimeAsync(0);
    expect(metaSynced).toHaveBeenCalledTimes(1);

    metaSub.emitStatus('disconnected');
    metaSub.emitStatus('joined');
    await vi.advanceTimersByTimeAsync(0);
    expect(metaSub.waitUntilSynced).toHaveBeenCalledTimes(2);
    expect(metaSynced).toHaveBeenCalledTimes(2);
  });

  it('throttles the expensive fan-out on a transport-only flap but never the online signal', async () => {
    // The two signals carry different meanings and must not be collapsed again.
    // `meta-room-synced` drives O(rooms) rescans, so a flap that never took the
    // meta room down is rate-limited. `streams-online` releases work parked
    // while offline (a dirty Machine Flock doc arms no timer of its own), so it
    // must fire on every edge.
    const reconnect = vi.fn(async () => {});
    const metaSub = createMetaSub('joined');
    const instance = createController({ reconnect, joinMetaRoom: vi.fn() }, metaSub);
    const metaSynced = vi.fn();
    const streamsOnline = vi.fn();
    instance.onMetaRoomSynced(metaSynced);
    instance.onStreamsOnline(streamsOnline);

    for (let round = 0; round < 5; round++) {
      instance.setTransportStatus('disconnected');
      instance.setTransportStatus('connected');
      await vi.advanceTimersByTimeAsync(0);
    }

    // First recovery is not delayed (cold start); the rest wait out the floor.
    expect(metaSynced).toHaveBeenCalledTimes(1);
    expect(streamsOnline).toHaveBeenCalledTimes(5);

    // Deferred, never dropped: the throttled emit lands once the floor elapses.
    await vi.advanceTimersByTimeAsync(30_000);
    expect(metaSynced).toHaveBeenCalledTimes(2);
  });

  it('does not throttle a fan-out after the meta room actually degraded', async () => {
    // A real meta-room outage may have missed remote metadata, so its rescan
    // must not be held behind the transport-flap floor.
    const reconnect = vi.fn(async () => {});
    const metaSub = createMetaSub('joined');
    const instance = createController({ reconnect, joinMetaRoom: vi.fn() }, metaSub);
    const metaSynced = vi.fn();
    instance.onMetaRoomSynced(metaSynced);

    metaSub.emitStatus('error');
    metaSub.emitStatus('joined');
    await vi.advanceTimersByTimeAsync(0);
    expect(metaSynced).toHaveBeenCalledTimes(1);

    // Immediately again, well inside the 30s floor.
    metaSub.emitStatus('error');
    metaSub.emitStatus('joined');
    await vi.advanceTimersByTimeAsync(0);
    expect(metaSynced).toHaveBeenCalledTimes(2);
  });

  it('reports a newly joined replacement meta room', async () => {
    const replacementMetaSub = createMetaSub('joined');
    const reconnect = vi.fn(async () => {});
    const joinMetaRoom = vi.fn(async () => replacementMetaSub);
    const instance = createController({ reconnect, joinMetaRoom }, null, {
      initialTransportStatus: 'connected',
    });
    const metaSynced = vi.fn();
    instance.onMetaRoomSynced(metaSynced);

    await vi.advanceTimersByTimeAsync(1_000);

    expect(joinMetaRoom).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(metaSynced).toHaveBeenCalledTimes(1));
    expect(replacementMetaSub.waitUntilSynced).toHaveBeenCalledTimes(1);
  });

  it('drops a stale joined event when the meta room degrades before sync handling', async () => {
    const reconnect = vi.fn(async () => {});
    const metaSub = createMetaSub('joined');
    const instance = createController({ reconnect, joinMetaRoom: vi.fn() }, metaSub);
    const metaSynced = vi.fn();
    instance.onMetaRoomSynced(metaSynced);

    metaSub.emitStatus('error');
    metaSub.emitStatus('joined');
    metaSub.emitStatus('error');
    await vi.advanceTimersByTimeAsync(0);

    expect(metaSub.waitUntilSynced).not.toHaveBeenCalled();
    expect(metaSynced).not.toHaveBeenCalled();

    metaSub.emitStatus('joined');
    await vi.advanceTimersByTimeAsync(0);
    expect(metaSynced).toHaveBeenCalledTimes(1);
  });
});
