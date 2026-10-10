import { describe, expect, it, vi } from 'vitest';

import type {
  McpServerId,
  SessionId,
  WorkspaceFlockReadableFlock,
  WorkspaceId,
} from '@lody/shared';
import { loadSessionMcpCatalog } from './session-mcp-resolver';

const workspaceId = 'workspace-1' as WorkspaceId;
const sessionId = 'session-1' as SessionId;
const selectedId = 'server-1' as McpServerId;

const flockWithRows = (rows: Array<{ key: readonly unknown[]; value: unknown }>) =>
  ({
    scan: ({ prefix }: { prefix?: readonly unknown[] } = {}) =>
      rows.filter(({ key }) => prefix?.every((part, index) => key[index] === part) ?? true),
  }) satisfies WorkspaceFlockReadableFlock;

const catalogFlock = flockWithRows([
  {
    key: ['mcpServer', selectedId],
    value: {
      id: selectedId,
      name: 'filesystem',
      transport: 'stdio',
      connection: {
        transport: 'stdio',
        command: '${NODE_BIN}',
        args: ['${ENTRYPOINT}'],
      },
      createdAt: 1,
      updatedAt: 1,
    },
  },
]);

describe('loadSessionMcpCatalog', () => {
  it('does not open or sync a document for an empty selection', async () => {
    const openFlockDoc = vi.fn();
    const syncFlockDoc = vi.fn();
    const select = await loadSessionMcpCatalog({
      repo: { openFlockDoc },
      syncFlockDoc,
      workspaceId,
      sessionId,
      selectedIds: [],
      logger: { debug: vi.fn() },
    });
    expect(select(undefined)).toEqual({ servers: [], problems: [] });
    expect(openFlockDoc).not.toHaveBeenCalled();
    expect(syncFlockDoc).not.toHaveBeenCalled();
  });

  it('does not execute selected peer-authored workspace configuration', async () => {
    const openFlockDoc = vi.fn(async () => ({ flock: catalogFlock }));
    const syncFlockDoc = vi.fn(async () => undefined);
    const select = await loadSessionMcpCatalog({
      repo: { openFlockDoc },
      syncFlockDoc,
      workspaceId,
      sessionId,
      selectedIds: [selectedId],
      logger: { debug: vi.fn() },
      env: { NODE_BIN: 'node', ENTRYPOINT: 'server.js' },
    });
    expect(select(undefined)).toEqual({
      servers: [],
      problems: [
        {
          kind: 'catalog_unavailable',
          reason: 'workspace MCP execution requires approval on the target machine',
        },
      ],
    });
    expect(openFlockDoc).not.toHaveBeenCalled();
    expect(syncFlockDoc).not.toHaveBeenCalled();
  });
});
