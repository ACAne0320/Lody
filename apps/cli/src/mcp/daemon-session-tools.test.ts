import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Effect } from 'effect';
import type { Flock } from '@loro-dev/flock-wasm';
import { LoroRepo } from 'loro-repo';
import type {
  TransportAdapter,
  TransportConnectionStatus,
  TransportSubscription,
  TransportSyncResult,
} from 'loro-repo';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getSessionRoomId,
  getMachineFlockDocId,
  getMachineRoomId,
  getMachineFlockAgentConfigs,
  writeAgentConfigToFlock,
  getWorkspaceFlockDocId,
  listWorkspaceAgentRoles,
  readWorkspaceFlockRowsFromFlock,
  readMachineFlockRowsFromFlock,
  writeWorkspaceAgentRoleToFlock,
  type AgentConfigId,
  type AgentRoleId,
  type MachineId,
  type SessionId,
  type WorkspaceId,
} from '@lody/shared';
import { bindTestPresenceApplication } from '../../tests/presence-application-fixture';
import { withWorkspaceManager } from '@/lib/command-runtime';
import * as commandRuntime from '@/lib/command-runtime';
import * as sessionCommands from '@/commands/session';
import { createResourceDiscovery } from '@/lib/resource-discovery-runtime';
import { LocalControlHandler } from '@/lib/local-control-handler';
import { LoroDocumentManager } from '@/lib/loro/doc';
import {
  createLocalSessionCommandEnvironment,
  runWithDaemonWorkspace,
  runWithSessionCommandEnvironment,
  type DaemonWorkspace,
} from '@/lib/session-command-environment';
import type { Logger } from '@/utils/logger';
import { executeDaemonSessionTool } from './daemon-session-tools';
import { buildLodyMcpServer, runWithMcpSessionContext } from './lody-mcp-server';

const createSilentLogger = (): Logger => ({
  info: () => {},
  warn: () => {},
  error: () => {},
  success: () => {},
  debug: () => {},
  trace: () => {},
  setDebug: () => {},
  setLevel: () => {},
  child: () => createSilentLogger(),
  close: async () => {},
});

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

const syncedRoomSubscription = (): TransportSubscription => ({
  unsubscribe: () => {},
  firstSyncedWithRemote: Promise.resolve(),
  waitUntilSynced: async () => {},
  status: 'joined',
  onStatusChange: (listener) => {
    listener('joined');
    return () => {};
  },
});

type MemoryRoom = {
  snapshot?: Awaited<ReturnType<Flock['exportJson']>>;
  peers: Set<{ flock: Flock }>;
};

class MemoryStreamsNetwork {
  private readonly rooms = new Map<string, MemoryRoom>();

  createAdapter(): TransportAdapter {
    return new MemoryStreamsAdapter(this);
  }

  async sync(key: string, flock: Flock): Promise<TransportSyncResult> {
    const room = this.room(key);
    if (room.snapshot === undefined) room.snapshot = flock.exportJson();
    else await flock.importJson(room.snapshot);
    return { ok: true };
  }

  join(key: string, flock: Flock): TransportSubscription {
    const room = this.room(key);
    const peer = { flock };
    room.peers.add(peer);
    const initialSync =
      room.snapshot === undefined
        ? Promise.resolve()
        : Promise.resolve(flock.importJson(room.snapshot));
    const unsubscribe = flock.subscribe((batch: { source?: string }) => {
      if (batch.source !== 'local') return;
      room.snapshot = flock.exportJson();
      for (const other of room.peers) {
        if (other !== peer) void Promise.resolve(other.flock.importJson(room.snapshot));
      }
    });
    return {
      unsubscribe: () => {
        unsubscribe();
        room.peers.delete(peer);
      },
      firstSyncedWithRemote: initialSync,
      waitUntilSynced: async () => {},
      status: 'joined',
      onStatusChange: (listener) => {
        listener('joined');
        return () => {};
      },
    };
  }

  private room(key: string): MemoryRoom {
    let room = this.rooms.get(key);
    if (!room) {
      room = { peers: new Set() };
      this.rooms.set(key, room);
    }
    return room;
  }
}

class MemoryStreamsAdapter implements TransportAdapter {
  private connected = false;

  constructor(private readonly network: MemoryStreamsNetwork) {}

  async connect(): Promise<void> {
    this.connected = true;
  }
  async close(): Promise<void> {
    this.connected = false;
  }
  isConnected(): boolean {
    return this.connected;
  }
  getStatus(): TransportConnectionStatus {
    return this.connected ? 'connected' : 'disconnected';
  }
  onStatusChange(): () => void {
    return () => {};
  }
  async syncMeta(flock: Flock): Promise<TransportSyncResult> {
    return this.network.sync('meta', flock);
  }
  joinMetaRoom(flock: Flock): TransportSubscription {
    return this.network.join('meta', flock);
  }
  async syncDoc(): Promise<TransportSyncResult> {
    return { ok: true };
  }
  joinDocRoom(): TransportSubscription {
    return syncedRoomSubscription();
  }
  async syncFlockDoc(flockDocId: string, flock: Flock): Promise<TransportSyncResult> {
    return this.network.sync(`flock:${flockDocId}`, flock);
  }
  joinFlockDocRoom(flockDocId: string, flock: Flock): TransportSubscription {
    return this.network.join(`flock:${flockDocId}`, flock);
  }
  async forgetFlockDoc(): Promise<void> {}
}

const workspaceId = 'synthetic-cloud-workspace' as WorkspaceId;
const machineId = 'synthetic-daemon-machine' as MachineId;
const ownerUserId = 'synthetic-owner';

describe('daemon-hosted Session tools in the cloud composition', () => {
  let tempDir: string;
  let originalEnv: NodeJS.ProcessEnv;
  let presenceApplication: ReturnType<typeof bindTestPresenceApplication>;
  let manager: LoroDocumentManager;
  let sessionId: SessionId;
  let daemon: DaemonWorkspace;

  beforeEach(async () => {
    presenceApplication = bindTestPresenceApplication(createSilentLogger());
    originalEnv = { ...process.env };
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lody-daemon-tools-'));
    process.env.LODY_DATA_DIR = path.join(tempDir, '.lody');
    delete process.env.LODY_PLATFORM;
    manager = await LoroDocumentManager.create(workspaceId, ownerUserId, createSilentLogger(), {
      keepWorkspaceCatalogJoined: true,
    });
    await manager.registerMachine(machineId, {
      id: machineId,
      name: 'Daemon',
      ownerUserId,
    });
    sessionId = await manager.createSession(machineId, 'custom', 'claude');
    await manager.repo.flush();
    daemon = {
      workspaceId,
      userId: ownerUserId,
      machineId,
      manager,
      // A collaborator drives this Session on the owner's shared machine.
      readInvocation: (id) => ({
        type: 'session/active-invocation-context',
        active: true,
        sessionId: id,
        requesterUserId: 'synthetic-collaborator',
        sourceTurnId: 'synthetic-turn',
        inputConfig: { cliType: 'custom', agentType: 'claude' },
      }),
    };
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await manager.cleanUp({ fast: true });
    await presenceApplication.closeLegacy();
    process.env = originalEnv;
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  const context = () => ({
    machineId,
    workspaceId,
    sessionId,
    localControlSocketPath: undefined,
    workdir: tempDir,
  });

  const createAuth = () => ({
    token: 'synthetic-token',
    userId: ownerUserId,
    userName: 'Owner',
    userEmail: 'owner@example.test',
    machineId,
    machineName: 'Daemon',
  });

  async function seedRoles() {
    const agentConfigId = await manager.createAgentConfig('custom', 'claude', machineId, 'Agent');
    const handle = await manager.repo.openFlockDoc(getWorkspaceFlockDocId(workspaceId));
    for (const userId of [ownerUserId, 'synthetic-collaborator']) {
      writeWorkspaceAgentRoleToFlock(handle.flock, {
        v: 1,
        id: userId as AgentRoleId,
        ownerUserId: userId,
        visibility: 'private',
        name: userId,
        promptPrefix: 'Review carefully.',
        machineId,
        agentConfigId,
        runConfig: {},
        revision: 1,
        createdAt: 1,
        updatedAt: 1,
      });
    }
    await manager.repo.flush();
    return agentConfigId;
  }

  it.each(['metadata', 'flock'] as const)(
    'reads daemon catalogs for the active user when %s synchronization fails',
    async (failure) => {
      const agentConfigId = await seedRoles();
      vi.spyOn(commandRuntime, 'getAuthContextOrThrow').mockImplementation(createAuth);
      vi.spyOn(commandRuntime, 'resolveWorkspaceOrThrow').mockResolvedValue({
        id: workspaceId,
        name: 'Synthetic',
        slug: 'synthetic',
        role: 'owner',
      });
      vi.spyOn(sessionCommands, 'readSessionMachineAccess').mockImplementation(async (args) => ({
        ...(args.delegatedRequester?.userId === 'synthetic-collaborator'
          ? { allowed: true as const }
          : { allowed: false as const, reason: 'not_visible' as const }),
      }));
      vi.spyOn(manager, 'syncMetaOrThrow').mockImplementation(async () => {
        if (failure === 'metadata')
          throw new Error(
            'Workspace metadata sync failed (resource.discovery): Repository adapter operation failed'
          );
      });
      vi.spyOn(manager, 'syncFlockDocOrThrow').mockRejectedValue(
        new Error('Flock sync unavailable')
      );
      for (const [name, args, expected] of [
        ['lody_agent_role_list', {}, { items: [{ id: 'synthetic-collaborator', machineId }] }],
        [
          'lody_agent_role_get',
          { id: 'synthetic-collaborator' },
          { item: { promptPrefix: 'Review carefully.' } },
        ],
        ['lody_agent_config_list', {}, { items: [{ id: agentConfigId }] }],
      ] as const) {
        const result = await runWithDaemonWorkspace(daemon, () =>
          executeDaemonSessionTool(context(), name, args)
        );
        expect(result.isError, JSON.stringify(result)).not.toBe(true);
        expect(JSON.parse(result.content[0]?.text ?? '{}')).toMatchObject(expected);
      }
    }
  );

  it('keeps standalone discovery sync failures explicit and offline reads available', async () => {
    await seedRoles();
    vi.spyOn(manager, 'syncMetaOrThrow').mockRejectedValue(new Error('Metadata unavailable'));
    const args = { manager, auth: createAuth(), workspaceId };
    await expect(createResourceDiscovery(args)).rejects.toThrow('Use --offline');
    vi.spyOn(manager, 'syncMetaOrThrow').mockResolvedValue();
    vi.spyOn(manager, 'syncFlockDocOrThrow').mockRejectedValue(new Error('Flock unavailable'));
    await expect((await createResourceDiscovery(args)).list('agent_role')).rejects.toThrow(
      'Flock unavailable'
    );
    // With no machine access, the readable Role still remains listed as unavailable.
    vi.spyOn(sessionCommands, 'readSessionMachineAccess').mockResolvedValue({
      allowed: false,
      reason: 'not_visible',
    });
    const offline = await createResourceDiscovery({ ...args, offline: true });
    expect((await offline.list('agent_role')).items).toMatchObject([{ id: ownerUserId }]);
  });

  it('reads the local daemon catalog without forcing synchronization', async () => {
    await seedRoles();
    vi.spyOn(manager, 'syncMetaOrThrow').mockRejectedValue(new Error('Metadata unavailable'));
    vi.spyOn(manager, 'syncFlockDocOrThrow').mockRejectedValue(new Error('Flock unavailable'));
    const environment = createLocalSessionCommandEnvironment({
      manager,
      workspaceId,
      machineId,
      machineName: 'Daemon',
      userId: ownerUserId,
      host: {
        readInvocation: daemon.readInvocation,
        readLiveStatus: async () => {
          throw new Error('Unexpected live status');
        },
        cancelSession: async () => {
          throw new Error('Unexpected cancellation');
        },
        dispatchSession: async () => {
          throw new Error('Unexpected dispatch');
        },
      },
    });
    await runWithSessionCommandEnvironment(environment, async () => {
      const discovery = await createResourceDiscovery({
        manager,
        workspaceId,
        auth: environment.auth,
      });
      expect((await discovery.list('agent_role')).items).toMatchObject([
        { id: ownerUserId, machineId },
      ]);
    });
  });

  it('executes a Session tool for another requester against the daemon replica', async () => {
    const result = await runWithDaemonWorkspace(daemon, () =>
      executeDaemonSessionTool(context(), 'lody_operation_list', {})
    );
    expect(result.isError).not.toBe(true);
    expect(JSON.parse(result.content[0]?.text ?? '{}')).toMatchObject({ items: [] });
  });

  it('returns syncing uncertainty before the daemon catalog baseline and reads from its cache after', async () => {
    await manager.cleanUp({ fast: true });
    manager = await LoroDocumentManager.create(workspaceId, ownerUserId, createSilentLogger(), {
      keepWorkspaceCatalogJoined: true,
      streamsTokens: {
        createTokenProvider: () => Effect.die(new Error('No real cloud token in this fixture')),
        createTokenProviderLegacy: () => {
          throw new Error('No real cloud token in this fixture');
        },
      },
    });
    daemon = { ...daemon, manager };
    const remoteMachineId = 'cold-machine' as MachineId;
    const id = getMachineFlockDocId(workspaceId, remoteMachineId);
    await manager.repo.upsertDocMeta(getMachineRoomId(remoteMachineId), {
      id: remoteMachineId,
      name: 'Remote',
      ownerUserId,
    });
    const roleDoc = await manager.repo.openFlockDoc(getWorkspaceFlockDocId(workspaceId));
    writeWorkspaceAgentRoleToFlock(roleDoc.flock, {
      v: 1,
      id: 'cold-role' as AgentRoleId,
      name: 'Cold',
      ownerUserId: 'synthetic-collaborator',
      visibility: 'private',
      machineId: remoteMachineId,
      agentConfigId: 'cold-config' as AgentConfigId,
      runConfig: { modelId: 'remote-model' },
      revision: 1,
      createdAt: 1,
      updatedAt: 1,
    });
    const network = new MemoryStreamsNetwork();
    const publisher = await LoroRepo.create({});
    try {
      const remote = await publisher.openFlockDoc(id);
      writeAgentConfigToFlock(remote.flock, {
        id: 'cold-config' as AgentConfigId,
        machineId: remoteMachineId,
        name: 'Remote',
        description: undefined,
        cliType: 'custom',
        agentType: 'claude' as const,
        env: {},
      });
      await publisher.joinFlockDocRoom(id);
      await publisher.addTransport('streams', network.createAdapter());
      await publisher.sync({ scope: 'doc', flockDocIds: [id] });

      vi.spyOn(sessionCommands, 'readSessionMachineAccess').mockResolvedValue({ allowed: true });
      const args = {
        manager,
        auth: createAuth(),
        workspaceId,
        delegatedRequester: { userId: 'synthetic-collaborator' },
        initialCatalogWaitMs: 0,
      };
      const discovery = await runWithDaemonWorkspace(daemon, () => createResourceDiscovery(args));
      expect(await discovery.list('agent_role')).toMatchObject({
        sync: { state: 'syncing', retryable: true },
        items: [{ availability: { state: 'unknown', reason: 'catalog_syncing' } }],
      });
      await expect(discovery.get('agent_config', 'cold-config')).rejects.toThrow('CATALOG_SYNCING');

      await manager.repo.addTransport('streams', network.createAdapter());
      expect(await manager.catalogBaselineReady(id, 100)).toBe(true);
      // A new request reads the same daemon replica; no forced catch-up is needed.
      vi.spyOn(manager, 'syncMetaOrThrow').mockRejectedValue(new Error('No request sync'));
      vi.spyOn(manager, 'syncFlockDocOrThrow').mockRejectedValue(new Error('No request sync'));
      const ready = await runWithDaemonWorkspace(daemon, () => createResourceDiscovery(args));
      expect(await ready.get('agent_config', 'cold-config')).toMatchObject({
        item: { id: 'cold-config', name: 'Remote' },
      });
    } finally {
      await publisher.destroy();
    }
  });

  it('validates Role creation against a cold remote config before publishing the review card', async () => {
    const remoteMachineId = 'remote-role-target' as MachineId;
    const id = getMachineFlockDocId(workspaceId, remoteMachineId);
    const network = new MemoryStreamsNetwork();
    const publisher = await LoroRepo.create({});
    try {
      const room = await publisher.openFlockDoc(id);
      writeAgentConfigToFlock(room.flock, {
        id: 'remote-role-config' as AgentConfigId,
        machineId: remoteMachineId,
        name: 'Remote',
        description: undefined,
        cliType: 'custom',
        agentType: 'claude' as const,
        env: {},
      });
      await publisher.joinFlockDocRoom(id);
      await publisher.addTransport('memory', network.createAdapter());
      await publisher.sync({ scope: 'doc', flockDocIds: [id] });
      await manager.repo.addTransport('memory', network.createAdapter());
      await manager.repo.upsertDocMeta(getMachineRoomId(remoteMachineId), {
        id: remoteMachineId,
        name: 'Remote',
        ownerUserId,
      });
      const session = await manager.getOrCreateSessionDoc(sessionId, { historyBackend: 'loro' });
      vi.spyOn(session, 'waitUntilSynced').mockResolvedValue(true);
      vi.spyOn(commandRuntime, 'getAuthContextOrThrow').mockImplementation(createAuth);
      vi.spyOn(commandRuntime, 'resolveWorkspaceOrThrow').mockResolvedValue({
        id: workspaceId,
        name: 'Synthetic',
        slug: 'synthetic',
        role: 'owner',
      });
      vi.spyOn(sessionCommands, 'readSessionMachineAccess').mockResolvedValue({ allowed: true });
      const result = await runWithDaemonWorkspace(daemon, () =>
        executeDaemonSessionTool(context(), 'lody_agent_role_create', {
          requestId: 'cold-target',
          name: 'Remote Role',
          machineId: remoteMachineId,
          agentConfigId: 'remote-role-config',
        })
      );
      expect(result.isError, JSON.stringify(result)).not.toBe(true);
      expect(JSON.parse(result.content[0]?.text ?? '{}')).toMatchObject({ pending: true });
      const originalSync = manager.syncFlockDocOrThrow.bind(manager);
      const originalFailure = new Error('Synthetic remote catalog outage');
      vi.spyOn(manager, 'syncFlockDocOrThrow').mockImplementation((docId, options) =>
        docId === id ? Promise.reject(originalFailure) : originalSync(docId, options)
      );
      const retry = await runWithDaemonWorkspace(daemon, () =>
        executeDaemonSessionTool(context(), 'lody_agent_role_create', {
          requestId: 'cold-retry',
          name: 'Retry Role',
          machineId: remoteMachineId,
          agentConfigId: 'remote-role-config',
        })
      );
      expect(retry.isError).toBe(true);
      expect(JSON.parse(retry.content[0]?.text ?? '{}')).toMatchObject({
        ok: false,
        error: { code: 'SYNC_UNAVAILABLE', retryable: true },
      });
    } finally {
      await publisher.destroy();
    }
  });

  it('hydrates and keeps daemon catalogs current without a discovery sync', async () => {
    const network = new MemoryStreamsNetwork();
    const publisher = await LoroRepo.create({});
    const docId = getWorkspaceFlockDocId(workspaceId);
    const remoteRoom = await publisher.openFlockDoc(docId);
    await publisher.joinFlockDocRoom(docId);
    const local = await manager.repo.openFlockDoc(docId);
    const roleReceived = deferred();
    const roleUpdated = deferred();
    const reattached = deferred();
    const detachRole = local.flock.subscribe(() => {
      const role = listWorkspaceAgentRoles(readWorkspaceFlockRowsFromFlock(local.flock)).find(
        (row) => row.id === 'remote-role'
      );
      if (role?.revision === 1) roleReceived.resolve();
      if (role?.revision === 2) roleUpdated.resolve();
      if (role?.revision === 3) reattached.resolve();
    });
    const detachCallbacks = [detachRole];
    try {
      writeWorkspaceAgentRoleToFlock(remoteRoom.flock, {
        v: 1,
        id: 'remote-role' as AgentRoleId,
        ownerUserId: 'synthetic-collaborator',
        visibility: 'private',
        name: 'Remote Role',
        machineId,
        agentConfigId: 'remote-config' as AgentConfigId,
        runConfig: {},
        revision: 1,
        createdAt: 1,
        updatedAt: 1,
      });
      await publisher.addTransport('memory', network.createAdapter());
      await publisher.sync({ scope: 'doc', flockDocIds: [docId] });
      await manager.repo.addTransport('memory', network.createAdapter());
      await roleReceived.promise;

      const remoteMachineId = 'remote-machine' as MachineId;
      const machineDocId = getMachineFlockDocId(workspaceId, remoteMachineId);
      const remoteMachine = await publisher.openFlockDoc(machineDocId);
      const remoteConfig = {
        id: 'remote-agent' as AgentConfigId,
        machineId: remoteMachineId,
        name: 'Remote Agent',
        description: undefined,
        cliType: 'custom' as const,
        agentType: 'claude' as const,
        env: {},
      };
      writeAgentConfigToFlock(remoteMachine.flock, remoteConfig);
      await publisher.joinFlockDocRoom(machineDocId);
      await publisher.sync({ scope: 'doc', flockDocIds: [machineDocId] });
      await manager.repo.upsertDocMeta(getMachineRoomId(remoteMachineId), {
        id: remoteMachineId,
        name: 'Remote Machine',
        ownerUserId,
      });
      vi.spyOn(manager, 'syncMetaOrThrow').mockRejectedValue(new Error('No request sync'));
      vi.spyOn(manager, 'syncFlockDocOrThrow').mockRejectedValue(new Error('No request sync'));
      vi.spyOn(commandRuntime, 'getAuthContextOrThrow').mockImplementation(createAuth);
      vi.spyOn(commandRuntime, 'resolveWorkspaceOrThrow').mockResolvedValue({
        id: workspaceId,
        name: 'Synthetic',
        slug: 'synthetic',
        role: 'owner',
      });
      vi.spyOn(sessionCommands, 'readSessionMachineAccess').mockResolvedValue({ allowed: true });
      const localMachine = await manager.repo.openFlockDoc(machineDocId);
      const configReceived = deferred();
      const configUpdated = deferred();
      const detachMachine = localMachine.flock.subscribe(() => {
        const config = getMachineFlockAgentConfigs(
          readMachineFlockRowsFromFlock(localMachine.flock)
        )[remoteConfig.id];
        if (config?.name === 'Remote Agent') configReceived.resolve();
        if (config?.name === 'Updated Agent') configUpdated.resolve();
      });
      detachCallbacks.push(detachMachine);
      const list = () =>
        runWithDaemonWorkspace(daemon, () =>
          executeDaemonSessionTool(context(), 'lody_agent_role_list', {})
        );
      expect(JSON.parse((await list()).content[0]?.text ?? '{}').items).toMatchObject([
        { id: 'remote-role', revision: 1 },
      ]);
      const configs = () =>
        runWithDaemonWorkspace(daemon, () =>
          executeDaemonSessionTool(context(), 'lody_agent_config_list', {
            machineId: remoteMachineId,
          })
        );
      // The first config read admits a daemon room reader, independent of this request.
      await configs();
      await configReceived.promise;
      expect(JSON.parse((await configs()).content[0]?.text ?? '{}').items).toMatchObject([
        { id: remoteConfig.id, name: 'Remote Agent' },
      ]);

      writeAgentConfigToFlock(remoteMachine.flock, { ...remoteConfig, name: 'Updated Agent' });
      const role = listWorkspaceAgentRoles(readWorkspaceFlockRowsFromFlock(remoteRoom.flock))[0];
      if (!role) throw new Error('Missing Role');
      writeWorkspaceAgentRoleToFlock(remoteRoom.flock, {
        ...role,
        revision: 2,
        name: 'Updated Role',
        updatedAt: 2,
      });
      await Promise.all([roleUpdated.promise, configUpdated.promise]);
      expect(JSON.parse((await list()).content[0]?.text ?? '{}').items).toMatchObject([
        { id: 'remote-role', name: 'Updated Role', revision: 2 },
      ]);
      expect(JSON.parse((await configs()).content[0]?.text ?? '{}').items).toMatchObject([
        { id: remoteConfig.id, name: 'Updated Agent' },
      ]);
      await manager.repo.removeTransport('memory');
      writeWorkspaceAgentRoleToFlock(remoteRoom.flock, {
        ...role,
        revision: 3,
        name: 'Reattached Role',
        updatedAt: 3,
      });
      // The detached daemon keeps its last confirmed cache until the same room rejoins.
      expect(JSON.parse((await list()).content[0]?.text ?? '{}').items).toMatchObject([
        { id: 'remote-role', revision: 2 },
      ]);
      await manager.repo.addTransport('memory', network.createAdapter());
      await reattached.promise;
      expect(JSON.parse((await list()).content[0]?.text ?? '{}').items).toMatchObject([
        { id: 'remote-role', name: 'Reattached Role', revision: 3 },
      ]);
    } finally {
      for (const unsubscribe of detachCallbacks) unsubscribe();
      await publisher.destroy();
    }
  });

  it('routes an MCP process Session tool to the daemon instead of executing it locally', async () => {
    const handled: string[] = [];
    const control = new LocalControlHandler({
      machineId,
      logger: createSilentLogger(),
      dispatchSession: async () => {
        throw new Error('Unexpected session control');
      },
      dispatchProject: async () => {
        throw new Error('Unexpected project control');
      },
      dispatchMachineRpc: async (request) => {
        if (request.method !== 'session/call-tool') throw new Error('Unexpected RPC');
        handled.push(request.params.name);
        return {
          ok: true,
          result: await runWithDaemonWorkspace(daemon, () =>
            executeDaemonSessionTool(
              { ...context(), sessionId: request.params.sessionId },
              request.params.name,
              request.params.arguments
            )
          ),
        };
      },
    });
    const socketPath =
      process.platform === 'win32'
        ? `\\\\.\\pipe\\lody-daemon-tools-${process.pid}`
        : path.join(tempDir, 'control.sock');
    const socketServer = http.createServer((request, response) => {
      void (async () => {
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(Buffer.from(chunk));
        const result = await control.handle({
          path: request.url ?? '',
          rawBody: Buffer.concat(chunks).toString('utf8'),
          requestId: 1,
        });
        response
          .writeHead(result.status, { 'Content-Type': 'application/json' })
          .end(JSON.stringify(result.payload));
      })();
    });
    await new Promise<void>((resolve, reject) => {
      socketServer.once('error', reject);
      socketServer.listen(socketPath, resolve);
    });
    const mcpServer = buildLodyMcpServer();
    const client = new Client({ name: 'daemon-tools-test', version: '1' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    try {
      await mcpServer.connect(serverTransport);
      await client.connect(clientTransport);
      const result = await runWithMcpSessionContext(
        { ...context(), localControlSocketPath: socketPath },
        () => client.callTool({ name: 'lody_operation_list', arguments: {} })
      );
      expect(result.isError, JSON.stringify(result)).not.toBe(true);
      expect(handled).toEqual(['lody_operation_list']);
    } finally {
      await client.close();
      await mcpServer.close();
      await new Promise<void>((resolve, reject) =>
        socketServer.close((error) => (error ? reject(error) : resolve()))
      );
    }
  });

  it('lends the daemon replica to nested commands and refuses another workspace', async () => {
    const auth = {
      token: 'synthetic-token',
      userId: ownerUserId,
      userName: 'Owner',
      userEmail: 'owner@example.test',
      machineId,
      machineName: 'Daemon',
    };
    const workspace = { id: workspaceId, name: 'Synthetic', slug: 'synthetic', role: 'owner' };
    await runWithDaemonWorkspace(daemon, async () => {
      expect(await withWorkspaceManager(auth, workspace, 'test', async (owner) => owner)).toBe(
        manager
      );
      await expect(
        withWorkspaceManager(auth, { ...workspace, id: 'other-workspace' }, 'test', async () => 1)
      ).rejects.toThrow('Daemon command workspace mismatch');
      await expect(
        withWorkspaceManager({ ...auth, userId: 'other-user' }, workspace, 'test', async () => 1)
      ).rejects.toThrow('restart the daemon');
    });
    // The borrowing command never cleans up the daemon's replica.
    expect((await manager.repo.getDocMeta(getSessionRoomId(sessionId)))?.meta).toMatchObject({
      machineId,
    });
  });

  it('rejects calls outside the daemon workspace scope', async () => {
    await expect(executeDaemonSessionTool(context(), 'lody_operation_list', {})).rejects.toThrow(
      'Session tool scope mismatch'
    );
    await expect(
      runWithDaemonWorkspace(daemon, () =>
        executeDaemonSessionTool(
          { ...context(), workspaceId: 'other-workspace' },
          'lody_operation_list',
          {}
        )
      )
    ).rejects.toThrow('Session tool scope mismatch');
    await expect(
      runWithDaemonWorkspace(daemon, () =>
        executeDaemonSessionTool(
          { ...context(), sessionId: 'missing-session' as SessionId },
          'lody_operation_list',
          {}
        )
      )
    ).rejects.toThrow('Requester Session does not belong to this machine');
    // A process outliving its Turn cannot keep using the Session's tools.
    await expect(
      runWithDaemonWorkspace(
        {
          ...daemon,
          readInvocation: (id) => ({
            type: 'session/active-invocation-context',
            sessionId: id,
            active: false,
          }),
        },
        () => executeDaemonSessionTool(context(), 'lody_operation_list', {})
      )
    ).rejects.toThrow('Session tool requires an active Turn');
  });
});
