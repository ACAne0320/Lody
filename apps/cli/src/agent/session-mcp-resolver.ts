import type {
  McpServerId,
  ResolveSessionMcpServersInput,
  ResolveSessionMcpServersResult,
  SessionId,
  WorkspaceFlockReadableFlock,
  WorkspaceId,
} from '@lody/shared';

/**
 * Applies the agent's advertised capabilities to an already-loaded catalog.
 * Pure, so it can run at the exact point ACP startup needs the server list.
 */
export type SessionMcpCatalogSelector = (
  agentCapabilities: ResolveSessionMcpServersInput['agentCapabilities']
) => ResolveSessionMcpServersResult;

export type LoadSessionMcpCatalogInput = {
  repo: {
    openFlockDoc(docId: string): Promise<{ flock: WorkspaceFlockReadableFlock }>;
  };
  syncFlockDoc?: (docId: string, options: { timeoutMs: number }) => Promise<void>;
  workspaceId: WorkspaceId;
  sessionId: SessionId;
  selectedIds: readonly McpServerId[];
  logger: { debug(message: string): void };
  env?: Readonly<Record<string, string | undefined>>;
};

const EMPTY_SELECTION: SessionMcpCatalogSelector = () => ({ servers: [], problems: [] });
const UNTRUSTED_WORKSPACE_CATALOG: SessionMcpCatalogSelector = () => ({
  servers: [],
  problems: [
    {
      kind: 'catalog_unavailable',
      reason: 'workspace MCP execution requires approval on the target machine',
    },
  ],
});

/**
 * Loads the workspace MCP catalog for an ACP session start.
 *
 * Workspace rows are replicated peer-authored data, not target-machine
 * execution consent. Until a machine-local, content-pinned approval store is
 * available, fail closed without reading or resolving the catalog. In
 * particular, never interpolate the daemon environment or forward a stdio
 * command from this document to an ACP provider.
 */
export const loadSessionMcpCatalog = (
  input: LoadSessionMcpCatalogInput
): Promise<SessionMcpCatalogSelector> => {
  if (input.selectedIds.length === 0) {
    return Promise.resolve(EMPTY_SELECTION);
  }
  return Promise.resolve(UNTRUSTED_WORKSPACE_CATALOG);
};
