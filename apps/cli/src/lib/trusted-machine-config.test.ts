import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MachineExecutionReceipts,
  TrustedMachineConfigStore,
  TrustedNativeSessions,
  TrustedMcpConfigStore,
  LocalExecutionAuthority,
} from './trusted-machine-config';
const roots: string[] = [];
async function root() {
  const path = await mkdtemp(join(tmpdir(), 'execution-authority-'));
  roots.push(path);
  return path;
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

it('keeps the accepted MCP executable after peer replacement, deletion, rollback and restart', async () => {
  const { LoroDocumentManager } = await import('./loro/doc');
  const { executionDigest, resolveSessionMcpServers, mcpExecutionAuthorizationPayload } =
    await import('@lody/shared');
  const path = await root();
  let shared = false;
  const manager = Object.assign(Object.create(LoroDocumentManager.prototype), {
    workspaceId: 'workspace',
    userId: 'owner',
    executionMachineId: 'machine',
    trustedMcpConfigs: new TrustedMcpConfigStore(path),
    executionAccess: {
      executionPolicy: async () => ({ sharedWithTeam: shared }),
      verifyExecution: async (scope: { digest: string }, proof: string) => {
        if (proof !== `owner:${scope.digest}`) throw new Error('Invalid author');
        return { requesterUserId: 'owner' };
      },
    },
  }) as import('./loro/doc').LoroDocumentManager;
  const entry = {
    id: 'mcp' as import('@lody/shared').McpServerId,
    name: 'Docs',
    transport: 'stdio' as const,
    connection: { transport: 'stdio' as const, command: '/approved', args: ['--docs'] },
    createdAt: 1,
    updatedAt: 1,
    executionRevision: 1,
    createdBy: 'owner',
    enabledByDefault: true,
  };
  const signed = {
    ...entry,
    executionAuthorization: `owner:${await executionDigest(mcpExecutionAuthorizationPayload(entry))}`,
  };
  const resolve = (candidate: import('@lody/shared').WorkspaceMcpServerMeta | undefined) =>
    manager.getTrustedMcpConfig(entry.id, candidate);
  expect(await resolve(entry)).toBeNull(); // Metadata alone cannot establish trust.
  expect((await resolve(signed))?.connection).toEqual(entry.connection);
  const malicious = {
    ...signed,
    updatedAt: 2,
    executionRevision: 2,
    connection: { transport: 'stdio' as const, command: '/peer-payload' },
  };
  expect((await resolve(malicious))?.connection).toEqual(entry.connection);
  expect((await resolve(undefined))?.connection).toEqual(entry.connection);
  const next = {
    ...entry,
    updatedAt: 3,
    executionRevision: 3,
    connection: { ...entry.connection, command: '/owner-update' },
  };
  const accepted = await resolve({
    ...next,
    executionAuthorization: `owner:${await executionDigest(mcpExecutionAuthorizationPayload(next))}`,
  });
  expect(accepted?.connection).toEqual(next.connection);
  expect((await resolve(signed))?.connection).toEqual(next.connection);
  const persisted = await new TrustedMcpConfigStore(path).read('workspace', 'owner', 'mcp');
  expect(
    resolveSessionMcpServers({
      catalog: { mcp: persisted! },
      selectedIds: ['mcp'],
      agentCapabilities: {},
      env: {},
    }).servers
  ).toEqual([{ name: 'Docs', command: '/owner-update', args: ['--docs'], env: [] }]);
  expect(await new TrustedMcpConfigStore(path).read('other', 'owner', 'mcp')).toBeNull();
  shared = true;
  expect((await resolve(malicious))?.connection).toEqual(malicious.connection);
});

describe('host-local execution authority', () => {
  it('mints owner-bound proofs only through the matching local machine endpoint', async () => {
    const { MessageHandler } = await import('./message-handler');
    const authority = new LocalExecutionAuthority(await root());
    const handler = Object.assign(Object.create(MessageHandler.prototype), {
      workspaceId: 'workspace',
      machineId: 'machine',
      userId: 'owner',
      localExecutionAuthority: authority,
    }) as import('./message-handler').MessageHandler;
    const request = {
      workspaceId: 'workspace',
      machineId: 'machine',
      method: 'machine/authorize-execution' as const,
      params: { purpose: 'turn' as const, digest: 'a'.repeat(64) },
    };
    const response = await handler.handleLocalMachineRpc(request);
    expect(response.ok).toBe(true);
    if (
      !response.ok ||
      !('type' in response.result) ||
      response.result.type !== 'machine/execution-authorization'
    )
      throw new Error('Missing proof');
    expect(response.result.requesterUserId).toBe('owner');
    expect(
      await authority.verify(
        { workspaceId: 'workspace', machineId: 'machine', ...request.params },
        'owner',
        response.result.requestToken
      )
    ).toBe(true);
    expect((await handler.handleLocalMachineRpc({ ...request, workspaceId: 'other' })).ok).toBe(
      false
    );
    expect((await handler.handleLocalMachineRpc({ ...request, machineId: 'other' })).ok).toBe(
      false
    );
  });
  it('authorizes local owner work offline and binds content, identity and destination across restarts', async () => {
    const path = await root();
    const intent = {
      workspaceId: 'workspace',
      machineId: 'machine',
      purpose: 'turn' as const,
      digest: 'a'.repeat(64),
    };
    const tokens = await Promise.all([
      new LocalExecutionAuthority(path).authorize(intent, 'owner'),
      new LocalExecutionAuthority(path).authorize(intent, 'owner'),
    ]);
    expect(tokens[0]).toBe(tokens[1]);
    const verifier = new LocalExecutionAuthority(path);
    expect(await verifier.verify(intent, 'owner', tokens[0]!)).toBe(true);
    expect(await verifier.verify(intent, 'peer', tokens[0]!)).toBe(false);
    for (const patch of [
      { workspaceId: 'other' },
      { machineId: 'other' },
      { digest: 'b'.repeat(64) },
      { purpose: 'provider' as const },
    ])
      expect(await verifier.verify({ ...intent, ...patch }, 'owner', tokens[0]!)).toBe(false);
    expect(
      await new LocalExecutionAuthority(await root()).verify(intent, 'owner', tokens[0]!)
    ).toBe(false);
  });
  it('admits a turn once across concurrent deliveries and daemon restarts', async () => {
    const path = await root();
    const scope = ['workspace', 'machine', 'turn', 'session', 'turn-id'];
    const outcomes = await Promise.allSettled([
      new MachineExecutionReceipts(path).claim(scope),
      new MachineExecutionReceipts(path).claim(scope),
    ]);
    expect(outcomes.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
    await expect(new MachineExecutionReceipts(path).claim(scope)).rejects.toThrow(
      'already admitted'
    );
    await expect(
      new MachineExecutionReceipts(path).claim([...scope, 'new-request'])
    ).resolves.toBeUndefined();
  });
  it('isolates trusted commands and native sessions by workspace and machine', async () => {
    const path = await root();
    const store = new TrustedMachineConfigStore(path);
    const config = {
      id: 'provider',
      machineId: 'machine',
      name: 'Approved',
      cliType: 'custom',
      agentType: 'custom',
      env: {},
      customAcp: { command: '/trusted/server', args: [] },
    } as never;
    await store.write('workspace', 'machine', config);
    expect(
      await new TrustedMachineConfigStore(path).read('workspace', 'machine', 'provider')
    ).toEqual(config);
    expect(await store.read('other', 'machine', 'provider')).toBeNull();
    expect(await store.read('workspace', 'other', 'provider')).toBeNull();
    await expect(store.write('workspace', 'other', config)).rejects.toThrow('machine mismatch');
    const native = new TrustedNativeSessions(await root());
    expect(await native.read(['workspace', 'machine', 'session'])).toBeUndefined();
    await native.write(['workspace', 'machine', 'session'], 'trusted-native');
    expect(await native.read(['workspace', 'machine', 'session'])).toBe('trusted-native');
    expect(await native.read(['workspace', 'machine', 'other'])).toBeUndefined();
  });
});

it('uses owner-approved executable content on private machines and mutable catalog only on shared machines', async () => {
  const { LoroDocumentManager } = await import('./loro/doc');
  const { executionDigest } = await import('@lody/shared');
  const store = new TrustedMachineConfigStore(await root());
  let shared = false;
  let row = {
    id: 'provider',
    machineId: 'machine',
    name: 'Tool',
    cliType: 'custom',
    agentType: 'custom-tool',
    env: {},
    customAcp: { command: '/approved', args: [] },
  } as import('@lody/shared').AgentConfigMeta;
  const manager = Object.assign(Object.create(LoroDocumentManager.prototype), {
    workspaceId: 'workspace',
    userId: 'owner',
    executionMachineId: 'machine',
    trustedMachineConfigs: store,
    getAgentConfigById: async () => row,
    executionAccess: {
      executionPolicy: async () => ({ sharedWithTeam: shared }),
      verifyExecution: async (intent: { digest: string }, proof: string) => {
        if (proof !== `owner:${intent.digest}`) throw new Error('Invalid signature');
        return { requesterUserId: 'owner' };
      },
    },
  }) as import('./loro/doc').LoroDocumentManager;
  const resolve = () =>
    manager.getAgentConfigForMachineLaunch('provider' as never, 'machine' as never);
  await expect(manager.assertHistoryReplayAllowed()).rejects.toThrow('Automatic replay');
  expect(await resolve()).toBeNull();
  row = { ...row, executionAuthorization: `owner:${await executionDigest(row)}` };
  expect((await resolve())?.customAcp?.command).toBe('/approved');
  row = { ...row, customAcp: { command: '/peer-payload', args: ['secret'] } };
  expect((await resolve())?.customAcp?.command).toBe('/approved');
  shared = true;
  await expect(manager.assertHistoryReplayAllowed()).resolves.toBeUndefined();
  expect((await resolve())?.customAcp?.command).toBe('/peer-payload');
  shared = false;
  const { executionAuthorization: _proof, ...updated } = {
    ...row,
    customAcp: { command: '/owner-update', args: [] },
  };
  row = { ...updated, executionAuthorization: `owner:${await executionDigest(updated)}` };
  expect((await resolve())?.customAcp?.command).toBe('/owner-update');
});
