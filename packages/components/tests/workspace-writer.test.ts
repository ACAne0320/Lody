import { describe, expect, it, vi } from 'vitest';
import { Flock } from '@loro-dev/flock-wasm';
import { LoroDoc } from 'loro-crdt';
import {
  createPreviewVisualComment,
  createPreviewVisualCommentDoc,
  createSessionMirror,
  type SessionHistory,
  type MinimalVisualAnnotationAnchor,
  type PreviewVisualCommentDocInput,
} from '@lody/shared';
import { createLoroSessionData } from '@lody/shared/session-data';
import { createDirectWorkspaceWriter } from '../src/providers/workspace-writer-impl';
import { persistReconciledAgentRole } from '../src/lib/agent-role-schema-reconciliation';
import {
  AGENT_ROLE_VERSION,
  workspaceFlockKeys,
  type AgentRole,
  type AcpCapabilityCacheEntry,
} from '@lody/shared';

const anchor: MinimalVisualAnnotationAnchor = {
  version: 1,
  page: {
    url: 'http://localhost:5173',
    pathname: '/',
    viewport: { width: 800, height: 600, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
  },
  click: {
    clientX: 10,
    clientY: 20,
    pageX: 10,
    pageY: 20,
    viewportXRatio: 0.1,
    viewportYRatio: 0.2,
  },
  target: {
    tag: 'button',
    attributes: {},
    rect: { x: 0, y: 0, width: 100, height: 30 },
    rectRatio: { x: 0, y: 0, width: 0.1, height: 0.05 },
    selector: 'button',
  },
  context: { ancestors: [] },
};

describe('createDirectWorkspaceWriter', () => {
  it('does not authorize inherited Provider launch fields during migration or setup retry', async () => {
    const flock = new Flock('provider-authoring');
    const writer = createDirectWorkspaceWriter({
      repo: { openFlockDoc: async () => ({ flock }) } as never,
      authorizeProvider: async (value) => ({
        ...(value as object),
        executionAuthorization: 'owner-approved',
      }),
      acquireSessionStore: async () => {
        throw new Error('unused');
      },
      releaseSessionStoreRef: () => {},
      acquirePreviewVisualCommentStore: async () => {
        throw new Error('unused');
      },
      releasePreviewVisualCommentStoreRef: () => {},
    });
    const peer = { id: 'provider', customAcp: { command: '/peer-command' } };
    // Automatic legacy migration copies the catalog without granting authority.
    await writer.flockRowPut('machine', ['agentConfig', 'provider'], peer);
    expect(flock.get(['agentConfig', 'provider'])).toEqual(peer);
    // Partial provider migrations also must not authorize inherited launch fields.
    await writer.flockRowUpdate('machine', ['agentConfig', 'provider'], (current) => ({
      ...(current as object),
      agentType: 'pi',
    }));
    expect(flock.get(['agentConfig', 'provider'])).toEqual({ ...peer, agentType: 'pi' });
    await writer.flockRowPutIfAbsent('machine', ['agentConfig', 'another'], peer);
    expect(flock.get(['agentConfig', 'another'])).toEqual(peer);
    const retry = { config: peer, attempt: 2, status: 'queued' };
    await writer.flockRowPut('machine', ['providerSetup', 'provider'], retry);
    expect(flock.get(['providerSetup', 'provider'])).toEqual(retry);
    const edited = { ...peer, customAcp: { command: '/owner-command' } };
    await writer.flockRowPut('machine', ['agentConfig', 'provider'], edited, {
      authorizeProvider: true,
    });
    expect(flock.get(['agentConfig', 'provider'])).toEqual({
      ...edited,
      executionAuthorization: 'owner-approved',
    });
    await writer.flockRowPut(
      'machine',
      ['providerSetup', 'provider'],
      { config: edited },
      { authorizeProvider: true }
    );
    expect(flock.get(['providerSetup', 'provider'])).toEqual({
      config: { ...edited, executionAuthorization: 'owner-approved' },
    });
  });
  it('does not authorize peer executable fields when changing MCP defaults', async () => {
    const flock = new Flock('mcp-authoring');
    const writer = createDirectWorkspaceWriter({
      repo: { openFlockDoc: async () => ({ flock }) } as never,
      authorizeMcp: async (value) => ({
        ...(value as object),
        executionAuthorization: 'owner-approved',
      }),
      acquireSessionStore: async () => {
        throw new Error('unused');
      },
      releaseSessionStoreRef: () => {},
      acquirePreviewVisualCommentStore: async () => {
        throw new Error('unused');
      },
      releasePreviewVisualCommentStoreRef: () => {},
    });
    const peer = {
      id: 'mcp',
      connection: { transport: 'stdio', command: '/peer-command' },
      enabledByDefault: false,
    };
    await writer.flockRowPut('catalog', ['mcpServer', 'mcp'], { ...peer, enabledByDefault: true });
    expect(flock.get(['mcpServer', 'mcp'])).toEqual({ ...peer, enabledByDefault: true });
    const edited = { ...peer, connection: { transport: 'stdio', command: '/owner-command' } };
    await writer.flockRowPut('catalog', ['mcpServer', 'mcp'], edited, { authorizeMcp: true });
    expect(flock.get(['mcpServer', 'mcp'])).toEqual({
      ...edited,
      executionAuthorization: 'owner-approved',
    });
  });
  it.each(['unchanged', 'edited', 'deleted', 'cancelled', 'other-owner', 'write-failure'] as const)(
    'reconciles the durable role without overwriting intervening changes: %s',
    async (scenario) => {
      const flock = new Flock('role-reconciliation');
      const role: AgentRole = {
        v: AGENT_ROLE_VERSION,
        id: 'role' as never,
        machineId: 'machine' as never,
        agentConfigId: 'config' as never,
        ownerUserId: 'owner',
        visibility: 'private',
        name: 'Reviewer',
        runConfig: { configOptionValues: { retired: 'value' } },
        revision: 1,
        createdAt: 1,
        updatedAt: 1,
      };
      const key = workspaceFlockKeys.agentRole(role.id);
      flock.set(key, role as never);
      flock.commit();
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const repo = {
        openFlockDoc: async () => {
          await gate;
          if (scenario === 'write-failure') throw new Error('storage unavailable');
          return { flock, syncOnce: async () => {} };
        },
      };
      const writer = createDirectWorkspaceWriter({ repo } as never);
      const runtime = { repo, writer, workspaceId: 'workspace' } as never;
      const capability: AcpCapabilityCacheEntry = {
        cliType: 'builtin',
        agentType: 'codex',
        provenance: 'runtime',
        fetchedAt: 2,
        modes: [],
        models: [],
        configOptions: [],
      };
      const pending = persistReconciledAgentRole(
        runtime,
        role,
        capability,
        scenario === 'other-owner' ? 'someone-else' : 'owner',
        3,
        () => scenario !== 'cancelled'
      );
      if (scenario === 'edited')
        flock.set(key, { ...role, name: 'New name', revision: 2 } as never);
      if (scenario === 'deleted') flock.delete(key);
      flock.commit();
      const before = flock.get(key);
      release();
      if (scenario === 'write-failure')
        await expect(pending).rejects.toThrow('storage unavailable');
      else await pending;
      if (scenario === 'unchanged') {
        expect(flock.get(key)).toEqual({
          ...role,
          runConfig: { configOptionValues: {} },
          revision: 2,
          updatedAt: 3,
        });
        await persistReconciledAgentRole(runtime, role, capability, 'owner', 4, () => true);
        expect(flock.get(key)).toMatchObject({ revision: 2, updatedAt: 3 });
      } else expect(flock.get(key)).toEqual(before);
    }
  );
  it('routes renderer history writes through the real shared boundary', async () => {
    const doc = new LoroDoc();
    const mirror = createSessionMirror({
      doc,
      initialState: { session: { id: 'session-1' as never }, history: [] },
    });
    const writer = createDirectWorkspaceWriter({
      repo: {} as never,
      acquireSessionStore: async () =>
        ({
          ...mirror,
          sessionData: createLoroSessionData({
            sessionId: 'session-1' as never,
            doc,
            writer: mirror.historyWriter,
          }),
        }) as never,
      releaseSessionStoreRef: () => {},
      acquirePreviewVisualCommentStore: async () => {
        throw new Error('not used');
      },
      releasePreviewVisualCommentStoreRef: () => {},
    });
    const entry: SessionHistory = {
      id: 'turn',
      role: 'user',
      timestamp: 'synthetic',
      items: [{ type: 'text', text: 'hello' }],
      fileDiff: [],
    };
    const version = doc.version().toJSON();
    await expect(
      writer.appendSessionTurn('session-1', {
        ...entry,
        items: [{ type: 'text' }],
      } as SessionHistory)
    ).rejects.toThrow('Invalid history write');
    expect(doc.version().toJSON()).toEqual(version);
    await writer.appendSessionTurn('session-1', entry);
    await writer.updateSessionHistory('session-1', 'turn', {
      ...entry,
      items: [{ type: 'text', text: 'updated' }],
    });
    expect(doc.toJSON().history[0].items).toEqual([{ type: 'text', text: 'updated' }]);
    mirror.dispose();
  });

  it('puts a Flock row only when the key is absent in the same synchronous transaction', async () => {
    const flock = new Flock('workspace-writer-test');
    const writer = createDirectWorkspaceWriter({
      repo: {
        openFlockDoc: vi.fn(async () => ({ flock })),
      } as never,
      acquireSessionStore: vi.fn(async () => {
        throw new Error('not used');
      }),
      releaseSessionStoreRef: vi.fn(),
      acquirePreviewVisualCommentStore: vi.fn(async () => {
        throw new Error('not used');
      }),
      releasePreviewVisualCommentStoreRef: vi.fn(),
    });

    const results = await Promise.all([
      writer.flockRowPutIfAbsent('flock-1', ['localProject', 'project-1'], { name: 'first' }),
      writer.flockRowPutIfAbsent('flock-1', ['localProject', 'project-1'], { name: 'second' }),
    ]);
    expect(results).toEqual([
      { inserted: true, value: { name: 'first' } },
      { inserted: false, value: { name: 'first' } },
    ]);
    expect(flock.get(['localProject', 'project-1'])).toEqual({ name: 'first' });
  });

  it('applies the shared preview-comment mutation to the renderer store', async () => {
    const state = createPreviewVisualCommentDoc(
      'session-1' as never
    ) as PreviewVisualCommentDocInput;
    const setState = vi.fn((updater: (draft: PreviewVisualCommentDocInput) => void) => {
      updater(state);
    });
    const writer = createDirectWorkspaceWriter({
      repo: {} as never,
      acquireSessionStore: vi.fn(async () => {
        throw new Error('not used');
      }),
      releaseSessionStoreRef: vi.fn(),
      acquirePreviewVisualCommentStore: vi.fn(async () => ({ setState }) as never),
      releasePreviewVisualCommentStoreRef: vi.fn(),
    });
    const comment = createPreviewVisualComment({
      id: 'comment-1',
      turnId: 'turn-1',
      body: 'Persist me',
      anchor,
      authorId: 'user-1',
      createdAt: 1_000,
    });

    await writer.mutatePreviewVisualComments('session-1' as never, { kind: 'create', comment });
    expect(state.turns['turn-1']).toMatchObject({
      comments: [expect.objectContaining({ id: 'comment-1', body: 'Persist me' })],
    });
  });

  it('rejects when the underlying store write fails so send paths surface the error', async () => {
    const writer = createDirectWorkspaceWriter({
      repo: {} as never,
      acquireSessionStore: vi.fn(async () => {
        throw new Error('store unavailable');
      }),
      releaseSessionStoreRef: vi.fn(),
      acquirePreviewVisualCommentStore: vi.fn(async () => {
        throw new Error('not used');
      }),
      releasePreviewVisualCommentStoreRef: vi.fn(),
    });

    await expect(
      writer.appendSessionTurn('session-1', {
        id: 'turn-1',
        role: 'user',
        timestamp: '2026-01-01',
        items: [{ type: 'text', text: 'hello' }],
        fileDiff: [],
      })
    ).rejects.toThrow('store unavailable');
  });
});
it('persists machine memory associations through the real Flock writer without touching provider identities', async () => {
  const { linkMemoryAssociation, editMemoryAssociation, unlinkMemoryAssociation } =
    await import('../src/lib/memory-association-write');
  const {
    getMachineFlockMemories,
    readMachineFlockRowsFromFlock,
    getMachineFlockDocId,
    isMemoryIdentityMissing,
  } = await import('@lody/shared');
  const flocks = new Map<string, Flock>();
  const repo = {
    openFlockDoc: async (id: string) => {
      let flock = flocks.get(id);
      if (!flock) {
        flock = new Flock(id);
        flocks.set(id, flock);
      }
      return {
        flock,
        syncOnce: async () => {
          throw new Error('offline upload');
        },
      };
    },
  };
  const writer = createDirectWorkspaceWriter({ repo } as never);
  const runtime = { repo, writer, workspaceId: 'workspace' } as never;
  const entry = {
    machineId: 'machine-a',
    providerId: 'nowledge-mem',
    memoryId: 'reviewer',
    name: 'Reviewer',
    description: 'Code review lessons',
  };
  await linkMemoryAssociation(runtime, entry);
  const read = async (machine: string) =>
    getMachineFlockMemories(
      readMachineFlockRowsFromFlock(
        (await repo.openFlockDoc(getMachineFlockDocId('workspace' as never, machine as never)))
          .flock
      ),
      machine as never
    );
  expect(await read('machine-a')).toEqual([entry]);
  expect(await read('machine-b')).toEqual([]);
  await editMemoryAssociation(runtime, { ...entry, name: 'My reviewer' });
  await linkMemoryAssociation(runtime, entry);
  expect(await read('machine-a')).toEqual([{ ...entry, name: 'My reviewer' }]);
  expect(
    isMemoryIdentityMissing(entry, { type: 'machine/memory', status: 'ready', memories: [] })
  ).toBe(true);
  expect(
    isMemoryIdentityMissing(entry, { type: 'machine/memory', status: 'error', memories: [] })
  ).toBe(false);
  await linkMemoryAssociation(runtime, { ...entry, machineId: 'machine-b' });
  await unlinkMemoryAssociation(runtime, 'machine-a' as never, entry);
  expect(await read('machine-a')).toEqual([]);
  expect(await read('machine-b')).toEqual([{ ...entry, machineId: 'machine-b' }]);
  await expect(editMemoryAssociation(runtime, entry)).rejects.toThrow('no longer exists');
  expect(await read('machine-a')).toEqual([]);
});

it('preserves owner authorization through queue edits, mirror IDs and history promotion', async () => {
  const { buildQueuedSessionTurn, executionDigest, executionTurnPayload } =
    await import('@lody/shared');
  const doc = new LoroDoc();
  const meta = {
    id: 'session',
    machineId: 'machine',
    userId: 'owner',
    cliType: 'builtin',
    agentType: 'codex',
  } as import('@lody/shared').SessionMeta;
  const mirror = createSessionMirror({
    doc,
    initialState: { session: { id: 'session' as never }, history: [], mq: [] },
  });
  const data = createLoroSessionData({
    sessionId: 'session' as never,
    doc,
    writer: mirror.historyWriter,
  });
  const writer = createDirectWorkspaceWriter({
    repo: { getDocMeta: async () => ({ meta }), upsertDocMeta: async () => {} } as never,
    acquireSessionStore: async () => ({ ...mirror, sessionData: data }) as never,
    releaseSessionStoreRef: () => {},
    acquirePreviewVisualCommentStore: async () => {
      throw new Error('unused');
    },
    releasePreviewVisualCommentStoreRef: () => {},
    authorizeTurn: async (sessionMeta, entry) => ({
      ...entry,
      inputConfig: {
        ...entry.inputConfig,
        executionAuthorization: await executionDigest(executionTurnPayload(sessionMeta, entry)),
      },
    }),
  });
  await writer.enqueueSessionMessage('session', {
    task: 'review',
    userId: 'owner',
    userTurnId: 'turn',
    timestamp: 'synthetic',
    project: undefined,
    acpSessionConfig: {
      prompt: 'review',
      cliType: 'builtin',
      agentType: 'codex',
      issuePRMentions: [
        { type: 'pr', number: 1, title: 'Review', url: 'https://example.test/pr/1' },
      ],
    },
  } as never);
  let queued = mirror.getState().mq![0]!;
  await writer.updateSessionMessage('session', queued.$cid!, { task: 'updated', isEditing: false });
  queued = mirror.getState().mq![0]!;
  const promoted = buildQueuedSessionTurn(queued, meta, 'turn')!;
  // Promotion goes through the production history writer, which removes mirror IDs.
  await data.commands.appendTurn(promoted);
  const stored = doc.toJSON().history[0];
  expect(stored.inputConfig.executionAuthorization).toBe(
    await executionDigest(executionTurnPayload(meta, stored))
  );
  expect(stored.inputConfig.issuePRMentions).toEqual([
    { type: 'pr', number: 1, title: 'Review', url: 'https://example.test/pr/1' },
  ]);
  for (const changed of [
    { ...stored, userId: 'peer' },
    { ...stored, inputConfig: { ...stored.inputConfig, prompt: 'run a different command' } },
    { ...stored, inputConfig: { ...stored.inputConfig, mcpServerIds: ['peer-mcp'] } },
  ])
    expect(await executionDigest(executionTurnPayload(meta, changed))).not.toBe(
      stored.inputConfig.executionAuthorization
    );
  expect(
    await executionDigest(executionTurnPayload({ ...meta, machineId: 'other' }, stored))
  ).not.toBe(stored.inputConfig.executionAuthorization);
  mirror.dispose();
});
