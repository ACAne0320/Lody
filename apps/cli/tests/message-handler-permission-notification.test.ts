import { withHistoryPort } from './history-port-fixture';
import { describe, expect, it, vi } from 'vitest';

import {
  SessionStatusFactory,
  type SessionId,
  type WorkspaceId,
  type SessionMeta,
  type MachineId,
  type LodyPresenceStateMap,
} from '@lody/shared';
import { SessionActivePresenceController } from '../src/lib/loro/session-active-presence';
import type { RequestPermissionRequest } from '@agentclientprotocol/sdk';

import { MessageHandler } from '../src/lib/message-handler';
import type { LoroDocumentManager } from '../src/lib/loro/doc';
import type { SessionManager } from '../src/session/session-manager';
import type { Logger } from '../src/utils/logger';
import type { CloudNotificationsPort } from '@lody/platform';
import { createTestCloudPort } from './test-cloud-port';

type LiveActivitySummary = Omit<
  Parameters<CloudNotificationsPort['syncLiveActivitySummary']>[0],
  'workspaceId' | 'userId'
>;

/**
 * Mark a session as having active presence so permission resolution is allowed
 * to restore `running` (see session-activity-status.ts). Permission requests
 * happen while a visible turn is active.
 */
const injectActivePresence = (handler: MessageHandler, sessionId: SessionId): void => {
  (
    handler as unknown as {
      startSessionActivePresence: (id: SessionId) => void;
    }
  ).startSessionActivePresence(sessionId);
};

const createSilentLogger = (): Logger => ({
  info: () => {},
  warn: () => {},
  error: () => {},
  success: () => {},
  debug: () => {},
  trace: () => {},
  setLevel: () => {},
  child: () => createSilentLogger(),
  close: async () => {},
});

/**
 * Give a fake session doc the session-data surface `subscribeSessionChanges`
 * needs. The fakes drive change notification through their own
 * `mirror.subscribe`; history reads still go through the fake's `getHistory`, so
 * the observe stream is inert.
 */
const withSessionData = <T extends object>(doc: T): T => {
  Object.assign(doc, {
    sessionData: {
      history: {
        count: async () => 0,
        readAt: async () => ({ state: 'missing' as const }),
        readTurn: async () => ({ state: 'missing' as const }),
        readRange: async () => [],
        readDirectory: async () => [],
        observe: () => ({ initial: Promise.resolve([]), unsubscribe: () => {} }),
      },
      commands: {},
      durability: { waitDurable: async () => {} },
    },
  });
  return withHistoryPort(doc);
};

const createNotificationPort = (
  overrides: Partial<CloudNotificationsPort> = {}
): CloudNotificationsPort => ({
  notifySessionCompleted: async () => {},
  notifyPermissionRequested: async () => {},
  recordPermissionRequested: async () => {},
  resolvePermissionRequested: async () => {},
  syncLiveActivitySummary: async () => ({ sent: false }),
  ...overrides,
});

describe('MessageHandler permission notifications', () => {
  it('records Inbox before a successful Live Activity without fallback push', async () => {
    const logger = createSilentLogger();

    const sessionId = 's-1' as SessionId;
    const workspaceId = 'ws-1' as WorkspaceId;

    // Track subscription callbacks so we can trigger them
    const subscriptionCallbacks: Array<() => void> = [];

    let history: unknown[] = [
      {
        id: 'u-1',
        role: 'user',
        timestamp: new Date().toISOString(),
        read: true,
        userId: 'active-user',
        items: [{ type: 'text', text: 'hello' }],
        fileDiff: [],
        finished: true,
      },
      {
        id: 'turn-1',
        role: 'assistant',
        timestamp: new Date().toISOString(),
        read: undefined,
        userId: undefined,
        items: [],
        fileDiff: [],
      },
    ];
    const sessionDoc = withHistoryPort({
      updateHistory: vi.fn(async (updater: (prev: unknown[]) => unknown[]) => {
        history = updater(history);
      }),
      waitUntilSynced: vi.fn(async () => true),
      setLastMessageAt: vi.fn(async () => {}),
      setStatus: vi.fn(async () => {}),
      getMetaState: vi.fn(async () => ({
        title: 'My Session',
        userId: 'meta-user',
        cliType: 'claude',
      })),
      getHistory: vi.fn(() => history),
      mirror: {
        subscribe: vi.fn((callback: () => void) => {
          subscriptionCallbacks.push(callback);
          return () => {
            const idx = subscriptionCallbacks.indexOf(callback);
            if (idx >= 0) subscriptionCallbacks.splice(idx, 1);
          };
        }),
        getState: () => ({ history }),
      },
    });
    withSessionData(sessionDoc);

    const workspaceDocument = {
      sessions: new Map<SessionId, unknown>(),
      repo: {
        watch: vi.fn(() => ({ unsubscribe: vi.fn() })),
        getDocMeta: vi.fn(async () => ({ meta: { needToArchiveSessions: {} } })),
      },
      getOrCreateSessionDoc: vi.fn(async () => sessionDoc),
      isTransportConnected: vi.fn(() => true),
      publishSessionPresence: vi.fn(),
      clearSessionPresence: vi.fn(),
    };

    const sessionManager = {
      on: vi.fn(),
      setRequestPermissionHandler: vi.fn(),
      hasSession: vi.fn(() => false),
      terminateSession: vi.fn(),
      archiveSession: vi.fn(),
      cleanUp: vi.fn(),
      setSessionError: vi.fn(),
    };
    const notifyPermissionRequested = vi.fn(async () => {});
    const recordPermissionRequested = vi.fn(async () => {});
    const resolvePermissionRequested = vi.fn(async () => {});
    const syncLiveActivitySummary = vi.fn(async () => ({ sent: true as const, ended: false }));

    const handler = new MessageHandler(
      sessionManager as unknown as SessionManager,
      workspaceDocument as unknown as LoroDocumentManager,
      logger,
      {
        token: 't',
        workspaceId,
        workspaceSlug: 'ws-slug',
        userId: 'device-owner',
        machineId: 'm-1',
        machineName: 'machine',
        cliVersion: '0.0.0',
        cloudPort: createTestCloudPort({
          notifications: createNotificationPort({
            notifyPermissionRequested,
            recordPermissionRequested,
            resolvePermissionRequested,
            syncLiveActivitySummary,
          }),
        }),
      }
    );

    const request: RequestPermissionRequest = {
      sessionId,
      options: [{ kind: 'allow_once', name: 'Allow once', optionId: 'opt1' }],
      toolCall: { toolCallId: 'tc1', title: 'Read file', status: 'in_progress', kind: 'read' },
    };

    const host = handler as unknown as {
      handleAgentPermissionRequest: (
        sessionId: SessionId,
        requestId: string,
        request: RequestPermissionRequest
      ) => Promise<unknown>;
    };

    injectActivePresence(handler, sessionId);
    const permissionPromise = host.handleAgentPermissionRequest(sessionId, 'req1', request);
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Simulate the outcome being written to LoroDoc by the Web client
    // Find the tool_call entry and add the outcome
    history = history.map((entry) => {
      const e = entry as { items?: unknown[] };
      if (e.items) {
        return {
          ...e,
          items: e.items.map((item) => {
            const i = item as { type?: string; permissionRequest?: { requestId?: string } };
            if (i.type === 'tool_call' && i.permissionRequest?.requestId === 'req1') {
              return {
                ...i,
                permissionRequest: {
                  ...i.permissionRequest,
                  outcome: { outcome: 'cancelled' },
                },
              };
            }
            return item;
          }),
        };
      }
      return entry;
    });

    // Trigger the subscription callbacks to simulate LoroDoc change detection
    for (const cb of subscriptionCallbacks) {
      cb();
    }

    await permissionPromise;

    // The durable "waiting on you" marker rides the same meta write as the
    // status, so needs-you survives the heartbeat repairing status to idle.
    expect(sessionDoc.setStatus).toHaveBeenNthCalledWith(
      1,
      SessionStatusFactory.requestPermission(),
      expect.objectContaining({ awaitingUserSince: expect.any(Number) })
    );
    expect(sessionDoc.setStatus).toHaveBeenLastCalledWith(SessionStatusFactory.running());
    expect(sessionDoc.waitUntilSynced).toHaveBeenCalledTimes(1);
    expect(syncLiveActivitySummary).toHaveBeenCalled();
    const waitCallOrder = sessionDoc.waitUntilSynced.mock.invocationCallOrder[0];
    const liveActivityCallOrder = syncLiveActivitySummary.mock.invocationCallOrder[0];
    if (waitCallOrder === undefined || liveActivityCallOrder === undefined) {
      throw new Error('Expected waitUntilSynced and syncLiveActivitySummary to be called');
    }
    expect(waitCallOrder).toBeLessThan(liveActivityCallOrder);
    expect(notifyPermissionRequested).not.toHaveBeenCalled();
    expect(recordPermissionRequested).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId,
        sessionTitle: 'My Session',
        workspaceSlug: 'ws-slug',
        userId: 'active-user',
        requestId: 'req1',
        toolCallId: 'tc1',
        toolTitle: 'Read file',
        toolKind: 'read',
      })
    );
    expect(resolvePermissionRequested).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId,
        userId: 'active-user',
        requestId: 'req1',
        toolCallId: 'tc1',
      })
    );
  });

  it('uses the AskUserQuestion title for question request notifications', async () => {
    const logger = createSilentLogger();

    const sessionId = 's-question' as SessionId;
    const workspaceId = 'ws-1' as WorkspaceId;
    const subscriptionCallbacks: Array<() => void> = [];

    let history: unknown[] = [
      {
        id: 'u-1',
        role: 'user',
        timestamp: new Date().toISOString(),
        read: true,
        userId: 'active-user',
        items: [{ type: 'text', text: 'hello' }],
        fileDiff: [],
        finished: true,
      },
      {
        id: 'turn-1',
        role: 'assistant',
        timestamp: new Date().toISOString(),
        read: undefined,
        userId: undefined,
        items: [],
        fileDiff: [],
      },
    ];
    const sessionDoc = withHistoryPort({
      updateHistory: vi.fn(async (updater: (prev: unknown[]) => unknown[]) => {
        history = updater(history);
      }),
      waitUntilSynced: vi.fn(async () => true),
      setLastMessageAt: vi.fn(async () => {}),
      setStatus: vi.fn(async () => {}),
      getMetaState: vi.fn(async () => ({
        title: 'My Session',
        userId: 'meta-user',
        cliType: 'claude',
      })),
      getHistory: vi.fn(() => history),
      mirror: {
        subscribe: vi.fn((callback: () => void) => {
          subscriptionCallbacks.push(callback);
          return () => {
            const idx = subscriptionCallbacks.indexOf(callback);
            if (idx >= 0) subscriptionCallbacks.splice(idx, 1);
          };
        }),
        getState: () => ({ history }),
      },
    });
    withSessionData(sessionDoc);

    const workspaceDocument = {
      sessions: new Map<SessionId, unknown>(),
      repo: {
        watch: vi.fn(() => ({ unsubscribe: vi.fn() })),
        getDocMeta: vi.fn(async () => ({ meta: { needToArchiveSessions: {} } })),
      },
      getOrCreateSessionDoc: vi.fn(async () => sessionDoc),
      isTransportConnected: vi.fn(() => true),
      publishSessionPresence: vi.fn(),
      clearSessionPresence: vi.fn(),
    };

    const sessionManager = {
      on: vi.fn(),
      setRequestPermissionHandler: vi.fn(),
      hasSession: vi.fn(() => false),
      terminateSession: vi.fn(),
      archiveSession: vi.fn(),
      cleanUp: vi.fn(),
      setSessionError: vi.fn(),
    };
    const notifyPermissionRequested = vi.fn(async () => {});
    const recordPermissionRequested = vi.fn(async () => {});
    const resolvePermissionRequested = vi.fn(async () => {});

    const handler = new MessageHandler(
      sessionManager as unknown as SessionManager,
      workspaceDocument as unknown as LoroDocumentManager,
      logger,
      {
        token: 't',
        workspaceId,
        workspaceSlug: 'ws-slug',
        userId: 'device-owner',
        machineId: 'm-1',
        machineName: 'machine',
        cliVersion: '0.0.0',
        cloudPort: createTestCloudPort({
          notifications: createNotificationPort({
            notifyPermissionRequested,
            recordPermissionRequested,
            resolvePermissionRequested,
          }),
        }),
      }
    );

    const request: RequestPermissionRequest = {
      sessionId,
      options: [
        { optionId: 'answer', name: 'Submit answers', kind: 'allow_once' },
        { optionId: 'cancel', name: 'Cancel', kind: 'reject_once' },
      ],
      toolCall: {
        toolCallId: 'tc-question',
        title: 'AskUserQuestion',
        status: 'in_progress',
        kind: 'think',
      },
      _meta: {
        claudeCode: {
          requestType: 'askUserQuestion',
          askUserQuestion: {
            version: 1,
            allowCustomAnswer: true,
            questions: [
              {
                question: 'Which database should we use?',
                header: 'Database',
                options: [{ label: 'Postgres', description: 'Use PostgreSQL' }],
                multiSelect: false,
              },
            ],
          },
        },
      },
    } as RequestPermissionRequest;

    const host = handler as unknown as {
      handleAgentPermissionRequest: (
        sessionId: SessionId,
        requestId: string,
        request: RequestPermissionRequest
      ) => Promise<unknown>;
    };

    const permissionPromise = host.handleAgentPermissionRequest(sessionId, 'req-question', request);
    await new Promise((resolve) => setTimeout(resolve, 0));

    history = history.map((entry) => {
      const e = entry as { items?: unknown[] };
      if (!e.items) return entry;
      return {
        ...e,
        items: e.items.map((item) => {
          const i = item as { type?: string; permissionRequest?: { requestId?: string } };
          if (i.type === 'tool_call' && i.permissionRequest?.requestId === 'req-question') {
            return {
              ...i,
              permissionRequest: {
                ...i.permissionRequest,
                outcome: { outcome: 'cancelled' },
              },
            };
          }
          return item;
        }),
      };
    });

    for (const cb of subscriptionCallbacks) {
      cb();
    }

    await permissionPromise;

    // The durable "waiting on you" marker rides the same meta write as the
    // status, so needs-you survives the heartbeat repairing status to idle.
    expect(sessionDoc.setStatus).toHaveBeenNthCalledWith(
      1,
      SessionStatusFactory.requestPermission(),
      expect.objectContaining({ awaitingUserSince: expect.any(Number) })
    );
    expect(notifyPermissionRequested).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId,
        sessionTitle: 'My Session',
        requestId: 'req-question',
        toolCallId: 'tc-question',
        toolTitle: 'Which database should we use?',
        requestKind: 'ask_user_question',
      })
    );
    expect(recordPermissionRequested).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId,
        requestId: 'req-question',
        toolCallId: 'tc-question',
      })
    );
    expect(resolvePermissionRequested).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId,
        requestId: 'req-question',
        toolCallId: 'tc-question',
      })
    );
  });

  it('does not restore running when session already transitioned to idle', async () => {
    const logger = createSilentLogger();

    const sessionId = 's-2' as SessionId;
    const workspaceId = 'ws-1' as WorkspaceId;
    const subscriptionCallbacks: Array<() => void> = [];

    let history: unknown[] = [
      {
        id: 'u-1',
        role: 'user',
        timestamp: new Date().toISOString(),
        read: true,
        userId: 'active-user',
        items: [{ type: 'text', text: 'hello' }],
        fileDiff: [],
        finished: true,
      },
      {
        id: 'turn-1',
        role: 'assistant',
        timestamp: new Date().toISOString(),
        read: undefined,
        userId: undefined,
        items: [],
        fileDiff: [],
      },
    ];

    const sessionDoc = withHistoryPort({
      currentStatus: SessionStatusFactory.requestPermission(),
      updateHistory: vi.fn(async (updater: (prev: unknown[]) => unknown[]) => {
        history = updater(history);
      }),
      waitUntilSynced: vi.fn(async () => true),
      setLastMessageAt: vi.fn(async () => {}),
      setStatus: vi.fn(async function (this: { currentStatus: unknown }, status: unknown) {
        this.currentStatus = status;
      }),
      getStatus: vi.fn(async function (this: { currentStatus: unknown }) {
        return this.currentStatus;
      }),
      getMetaState: vi.fn(async () => ({
        title: 'My Session',
        userId: 'meta-user',
        cliType: 'claude',
      })),
      getHistory: vi.fn(() => history),
      mirror: {
        subscribe: vi.fn((callback: () => void) => {
          subscriptionCallbacks.push(callback);
          return () => {
            const idx = subscriptionCallbacks.indexOf(callback);
            if (idx >= 0) subscriptionCallbacks.splice(idx, 1);
          };
        }),
        getState: () => ({ history }),
      },
    });
    withSessionData(sessionDoc);

    const workspaceDocument = {
      sessions: new Map<SessionId, unknown>(),
      repo: {
        watch: vi.fn(() => ({ unsubscribe: vi.fn() })),
        getDocMeta: vi.fn(async () => ({ meta: { needToArchiveSessions: {} } })),
      },
      getOrCreateSessionDoc: vi.fn(async () => sessionDoc),
      isTransportConnected: vi.fn(() => true),
      publishSessionPresence: vi.fn(),
      clearSessionPresence: vi.fn(),
    };

    const sessionManager = {
      on: vi.fn(),
      setRequestPermissionHandler: vi.fn(),
      hasSession: vi.fn(() => false),
      terminateSession: vi.fn(),
      archiveSession: vi.fn(),
      cleanUp: vi.fn(),
      setSessionError: vi.fn(),
    };

    const handler = new MessageHandler(
      sessionManager as unknown as SessionManager,
      workspaceDocument as unknown as LoroDocumentManager,
      logger,
      {
        token: 't',
        workspaceId,
        workspaceSlug: 'ws-slug',
        userId: 'device-owner',
        machineId: 'm-1',
        machineName: 'machine',
        cliVersion: '0.0.0',
        cloudPort: createTestCloudPort(),
      }
    );

    const request: RequestPermissionRequest = {
      sessionId,
      options: [{ kind: 'allow_once', name: 'Allow once', optionId: 'opt1' }],
      toolCall: { toolCallId: 'tc1', title: 'Read file', status: 'in_progress', kind: 'read' },
    };

    const host = handler as unknown as {
      handleAgentPermissionRequest: (
        sessionId: SessionId,
        requestId: string,
        request: RequestPermissionRequest
      ) => Promise<unknown>;
    };

    injectActivePresence(handler, sessionId);
    const permissionPromise = host.handleAgentPermissionRequest(sessionId, 'req1', request);
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Simulate external transition to idle before permission outcome arrives.
    sessionDoc.currentStatus = SessionStatusFactory.idle();

    history = history.map((entry) => {
      const e = entry as { items?: unknown[] };
      if (e.items) {
        return {
          ...e,
          items: e.items.map((item) => {
            const i = item as { type?: string; permissionRequest?: { requestId?: string } };
            if (i.type === 'tool_call' && i.permissionRequest?.requestId === 'req1') {
              return {
                ...i,
                permissionRequest: {
                  ...i.permissionRequest,
                  outcome: { outcome: 'cancelled' },
                },
              };
            }
            return item;
          }),
        };
      }
      return entry;
    });

    for (const cb of subscriptionCallbacks) {
      cb();
    }

    await permissionPromise;

    expect(sessionDoc.getStatus).toHaveBeenCalled();
    expect(sessionDoc.setStatus).not.toHaveBeenCalledWith(SessionStatusFactory.running());
  });

  it('cancels permission request instead of waiting when it cannot be persisted', async () => {
    const logger = createSilentLogger();

    const sessionId = 's-3' as SessionId;
    const workspaceId = 'ws-1' as WorkspaceId;

    let history: unknown[] = [
      {
        id: 'u-1',
        role: 'user',
        timestamp: new Date().toISOString(),
        read: true,
        userId: 'active-user',
        items: [{ type: 'text', text: 'hello' }],
        fileDiff: [],
        finished: true,
      },
    ];

    const sessionDoc = withHistoryPort({
      updateHistory: vi.fn(async (updater: (prev: unknown[]) => unknown[]) => {
        history = updater(history);
      }),
      waitUntilSynced: vi.fn(async () => true),
      setLastMessageAt: vi.fn(async () => {}),
      setStatus: vi.fn(async () => {}),
      getMetaState: vi.fn(async () => ({
        title: 'My Session',
        userId: 'meta-user',
        cliType: 'claude',
      })),
      getHistory: vi.fn(() => history),
      mirror: {
        subscribe: vi.fn(() => () => {}),
        getState: () => ({ history }),
      },
    });
    withSessionData(sessionDoc);

    const workspaceDocument = {
      sessions: new Map<SessionId, unknown>(),
      repo: {
        watch: vi.fn(() => ({ unsubscribe: vi.fn() })),
        getDocMeta: vi.fn(async () => ({ meta: { needToArchiveSessions: {} } })),
      },
      getOrCreateSessionDoc: vi.fn(async () => sessionDoc),
      isTransportConnected: vi.fn(() => true),
    };

    const sessionManager = {
      on: vi.fn(),
      setRequestPermissionHandler: vi.fn(),
      hasSession: vi.fn(() => false),
      terminateSession: vi.fn(),
      archiveSession: vi.fn(),
      cleanUp: vi.fn(),
      setSessionError: vi.fn(),
    };
    const notifyPermissionRequested = vi.fn(async () => {});

    const handler = new MessageHandler(
      sessionManager as unknown as SessionManager,
      workspaceDocument as unknown as LoroDocumentManager,
      logger,
      {
        token: 't',
        workspaceId,
        workspaceSlug: 'ws-slug',
        userId: 'device-owner',
        machineId: 'm-1',
        machineName: 'machine',
        cliVersion: '0.0.0',
        cloudPort: createTestCloudPort({
          notifications: createNotificationPort({ notifyPermissionRequested }),
        }),
      }
    );

    const request: RequestPermissionRequest = {
      sessionId,
      options: [{ kind: 'allow_once', name: 'Allow once', optionId: 'opt1' }],
      toolCall: { toolCallId: 'tc1', title: 'Read file', status: 'in_progress', kind: 'read' },
    };

    const host = handler as unknown as {
      handleAgentPermissionRequest: (
        sessionId: SessionId,
        requestId: string,
        request: RequestPermissionRequest
      ) => Promise<unknown>;
    };

    await expect(host.handleAgentPermissionRequest(sessionId, 'req1', request)).resolves.toEqual({
      outcome: { outcome: 'cancelled' },
    });
    expect(sessionDoc.setStatus).not.toHaveBeenCalled();
    expect(notifyPermissionRequested).not.toHaveBeenCalled();
    expect(sessionDoc.mirror.subscribe).not.toHaveBeenCalled();
  });
});

describe('MessageHandler Live Activity lifetime', () => {
  it('keeps a long prompt and permission pause active, then ends at prompt completion', async () => {
    vi.useFakeTimers();
    const started = Date.parse('2026-10-11T00:00:00Z');
    vi.setSystemTime(started);
    const session: SessionMeta = {
      id: 'long-task' as SessionId,
      machineId: 'machine-1' as MachineId,
      userId: 'user-1',
      cliType: 'builtin',
      agentType: 'codex',
      createdAt: new Date(started).toISOString(),
      status: { type: 'running' },
      lastRunningSeen: started,
    };
    let peers: LodyPresenceStateMap | null = {};
    const sessions = new Map([[session.id, { getMetaState: async () => session }]]);
    const document = {
      sessions,
      publishSessionPresence: () => {},
      clearSessionPresence: () => {},
      getPresenceStates: () => peers,
    } as unknown as LoroDocumentManager;
    const presence = new SessionActivePresenceController(
      document,
      session.machineId,
      createSilentLogger()
    );
    const handler = Object.assign(Object.create(MessageHandler.prototype), {
      workspaceDocument: document,
      sessionActivePresence: presence,
      machineId: session.machineId,
      workspaceId: 'workspace-1',
    }) as {
      buildLiveActivitySummary(
        userId: string,
        options?: { permissionAlert?: boolean }
      ): Promise<LiveActivitySummary>;
    };
    try {
      presence.start(session.id, 'thinking');
      for (const elapsed of [180_000, 31 * 60_000]) {
        vi.setSystemTime(started + elapsed);
        const summary = await handler.buildLiveActivitySummary('user-1');
        expect(summary.statusCounts.running).toBe(1);
        expect(summary.items.map((item) => item.id)).toEqual([session.id]);
        expect(session.lastRunningSeen).toBe(started);
      }
      // Completion of another task triggers a summary without ending this long prompt.
      const finished: SessionMeta = {
        ...session,
        id: 'finished-task' as SessionId,
        status: { type: 'idle' },
        lastMessageAt: Date.now(),
      };
      sessions.set(finished.id, { getMetaState: async () => finished });
      const overlapping = await handler.buildLiveActivitySummary('user-1');
      expect(overlapping.statusCounts).toEqual({
        running: 1,
        permission: 0,
        question: 0,
        unread: 1,
      });
      sessions.delete(finished.id);
      presence.setPhase(session.id, 'requestPermission');
      const waiting = await handler.buildLiveActivitySummary('user-1', { permissionAlert: true });
      expect(waiting.statusCounts.permission).toBe(1);
      expect(waiting.permissionAlert?.title).toBe('Permission Required');
      presence.setPhase(session.id, 'finalizing');
      session.status = { type: 'idle' };
      session.lastMessageAt = Date.now();
      const completed = await handler.buildLiveActivitySummary('user-1');
      expect(completed.statusCounts).toEqual({ running: 0, permission: 0, question: 0, unread: 1 });
      presence.clear(session.id);
      session.status = { type: 'running' };
      session.lastMessageAt = undefined;
      expect((await handler.buildLiveActivitySummary('user-1')).totalCount).toBe(0);

      // Peers use fresh workspace presence; old metadata never revives them.
      session.machineId = 'peer-machine' as MachineId;
      expect((await handler.buildLiveActivitySummary('user-1')).totalCount).toBe(0);
      peers = {
        peer: {
          kind: 'session',
          sessionId: session.id,
          machineId: session.machineId,
          instanceId: 'peer-instance',
          status: { type: 'running' },
          updatedAt: Date.now(),
        },
      };
      expect((await handler.buildLiveActivitySummary('user-1')).statusCounts.running).toBe(1);
      vi.setSystemTime(Date.now() + 90_000);
      expect((await handler.buildLiveActivitySummary('user-1')).totalCount).toBe(0);
      peers = null;
      await expect(handler.buildLiveActivitySummary('user-1')).rejects.toThrow(
        'presence unavailable'
      );
    } finally {
      presence.clearAll();
      vi.useRealTimers();
    }
  });
});
