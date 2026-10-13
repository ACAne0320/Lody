import {
  getWorkspaceFlockDocId,
  getWorkspaceMcpCatalog,
  readWorkspaceFlockRowsFromFlock,
  resolveSessionMcpServers,
  type McpServerId,
  type ResolveSessionMcpServersResult,
  type ResolveSessionMcpServersInput,
  type SessionId,
  type WorkspaceFlockReadableFlock,
  type WorkspaceId,
  type WorkspaceMcpServerMeta,
} from '@lody/shared';
import { formatErrorMessage } from '@/utils/format-error';

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
  resolveTrustedEntry?: (
    id: McpServerId,
    candidate: WorkspaceMcpServerMeta | undefined
  ) => Promise<WorkspaceMcpServerMeta | null>;
};

const CATALOG_SYNC_TIMEOUT_MS = 5_000;

const EMPTY_SELECTION: SessionMcpCatalogSelector = () => ({ servers: [], problems: [] });

/**
 * Loads the workspace MCP catalog for an ACP session start.
 *
 * Deliberately split from selection: the only thing selection needs from the
 * agent is its advertised `http` capability, so this — a remote catalog sync
 * plus a document read — can overlap process spawn and the ACP handshake
 * instead of adding a round trip between `initialize` and `newSession`.
 *
 * Best effort. Configuration failures come back as problems on the selector so
 * the agent still starts with its built-in MCP.
 */
export const loadSessionMcpCatalog = async (
  input: LoadSessionMcpCatalogInput
): Promise<SessionMcpCatalogSelector> => {
  const { logger, selectedIds, sessionId } = input;
  if (selectedIds.length === 0) {
    return EMPTY_SELECTION;
  }

  const docId = getWorkspaceFlockDocId(input.workspaceId);
  if (input.syncFlockDoc) {
    try {
      await input.syncFlockDoc(docId, { timeoutMs: CATALOG_SYNC_TIMEOUT_MS });
    } catch (error) {
      logger.debug(
        `[${sessionId}] Workspace MCP catalog refresh failed; using local rows: ${formatErrorMessage(error)}`
      );
    }
  }

  let catalog: Record<string, WorkspaceMcpServerMeta> = {};
  let catalogFailure: string | undefined;
  try {
    const handle = await input.repo.openFlockDoc(docId);
    catalog = getWorkspaceMcpCatalog(readWorkspaceFlockRowsFromFlock(handle.flock));
  } catch (error) {
    catalogFailure = formatErrorMessage(error);
    logger.debug(`[${sessionId}] Workspace MCP catalog read failed: ${catalogFailure}`);
    if (!input.resolveTrustedEntry) {
      const reason = catalogFailure;
      return () => ({ servers: [], problems: [{ kind: 'catalog_unavailable', reason }] });
    }
  }

  try {
    if (input.resolveTrustedEntry) {
      const accepted: Record<string, WorkspaceMcpServerMeta> = {};
      for (const id of selectedIds) {
        const entry = await input.resolveTrustedEntry(id, catalog[id]);
        if (entry) accepted[id] = entry;
      }
      catalog = accepted;
    }
    const env = input.env ?? process.env;
    return (agentCapabilities) => {
      const result = resolveSessionMcpServers({ catalog, selectedIds, agentCapabilities, env });
      if (catalogFailure && selectedIds.some((id) => !catalog[id])) {
        result.problems.push({ kind: 'catalog_unavailable', reason: catalogFailure });
      }
      return result;
    };
  } catch (error) {
    const reason = formatErrorMessage(error);
    logger.debug(`[${sessionId}] Workspace MCP catalog read failed: ${reason}`);
    return () => ({ servers: [], problems: [{ kind: 'catalog_unavailable', reason }] });
  }
};
