import {
  getSessionRoomId,
  isLoroRepoDocDeleted,
  SessionToolResultSchema,
  type SessionId,
  type SessionMeta,
  type WorkspaceId,
} from '@lody/shared';
import {
  getAuthContextOrThrow,
  listAliveSessionMetas,
  resolveWorkspaceOrThrow,
} from '@/lib/command-runtime';
import { getDaemonWorkspace } from '@/lib/session-command-environment';
import { createResourceDiscovery } from '@/lib/resource-discovery-runtime';
import { discoveryPage, matchesDiscoveryQuery } from '@/lib/discovery-query';
import {
  createSessionResult,
  readSessionLiveStatusesMany,
  sendSessionChatResult,
  validateSessionCreateOptions,
  type CreateOptions,
  type ResolvedTurnDispatchConfig,
} from '@/commands/session';
import { createSessionBackend } from '@/session/session-backend';
import { authenticateExternalAccess } from './access';
import { ExternalRequests, publicExternalReceipt } from './requests';
import { buildExternalMcpServer, type ExternalToolServices } from './tools';
import { buildSessionHistoryForReader } from '../session-history-handler';
import type { SessionToolHandlers } from '../session-tool-router';

export async function executeExternalDaemonTool(token: string, name: string, args: unknown) {
  // Recheck at the authoring boundary: disabling or rotating access also fences
  // requests forwarded by a host which authenticated just before revocation.
  const access = await authenticateExternalAccess(token);
  const daemon = getDaemonWorkspace();
  if (
    !access ||
    !daemon ||
    access.workspaceId !== daemon.workspaceId ||
    access.machineId !== daemon.machineId ||
    access.userId !== daemon.userId
  )
    throw new Error('External MCP access denied');
  const auth = getAuthContextOrThrow('external-mcp');
  if (auth.userId !== access.userId || auth.machineId !== access.machineId)
    throw new Error('External MCP account changed; enable access again');
  const workspace = await resolveWorkspaceOrThrow(auth, access.workspaceId);
  const manager = daemon.manager;
  const requests = new ExternalRequests();
  const session = async (id: string): Promise<SessionMeta> => {
    const row = await manager.repo.getDocMeta(getSessionRoomId(id as SessionId));
    const meta = row?.meta as SessionMeta | undefined;
    // First release grants only this user's Sessions on this machine.
    if (
      !row ||
      isLoroRepoDocDeleted(row) ||
      !meta ||
      meta.userId !== access.userId ||
      meta.machineId !== access.machineId
    )
      throw new Error('Session not found');
    return meta;
  };
  const services: ExternalToolServices = {
    discovery: () =>
      createResourceDiscovery({
        manager,
        auth,
        workspaceId: workspace.id as WorkspaceId,
      }),
    list: async (input) => {
      const rows = (await listAliveSessionMetas(manager))
        .map((row) => row.meta)
        .filter(
          (item) =>
            item.userId === access.userId &&
            item.machineId === access.machineId &&
            matchesDiscoveryQuery(input.query, item.id, item.title ?? undefined)
        )
        .map((item) => ({
          id: item.id,
          title: item.title,
          machineId: item.machineId,
          agentConfigId: item.agentConfigId,
          createdAt: item.createdAt,
          lastMessageAt: item.lastMessageAt,
        }));
      return discoveryPage(
        rows,
        input,
        JSON.stringify(['external-sessions', access.userId, access.workspaceId, access.machineId]),
        (item) => item.id
      );
    },
    history: async (input) => {
      const meta = await session(input.sessionId);
      const doc = await manager.getOrCreateSessionDoc(meta.id);
      const backend = await createSessionBackend(doc, meta);
      return buildSessionHistoryForReader({
        sessionId: meta.id,
        history: backend.history,
        limit: input.limit,
        cursor: input.cursor,
        maxBytes: 128 * 1024,
      });
    },
    status: async (input) => {
      const sessions = await Promise.all(input.sessionIds.map(session));
      const statuses = await readSessionLiveStatusesMany({
        auth,
        workspaceId: workspace.id as WorkspaceId,
        sessions,
      });
      return { items: [...statuses.values()] };
    },
    create: async (input) => {
      const options: CreateOptions = {
        machine: access.machineId,
        agentConfig: input.agentConfigId,
        localProject: input.localProjectId,
        currentSessionId: null,
      };
      let dispatch: ResolvedTurnDispatchConfig = {
        modeId: input.modeId,
        modelId: input.modelId,
        configOptionValues: input.configOptionValues,
      };
      // Reject invalid targets/configuration before recording a write claim.
      const receipt = await requests.run(
        access,
        input.operationId,
        { name: 'create', input },
        undefined,
        async (fixed) => {
          await createSessionResult(
            auth,
            workspace,
            manager,
            input.prompt,
            {
              ...options,
              sessionId: fixed.sessionId as SessionId,
              userTurnId: fixed.userTurnId,
            },
            dispatch
          );
          await manager.repo.flush();
        },
        async () => {
          dispatch = await validateSessionCreateOptions({
            auth,
            workspace,
            manager,
            options,
            dispatchConfig: dispatch,
          });
        }
      );
      return publicExternalReceipt(receipt);
    },
    chat: async (input) => {
      const target = await session(input.sessionId);
      const receipt = await requests.run(
        access,
        input.operationId,
        { name: 'chat', input },
        target.id,
        async (fixed) => {
          await sendSessionChatResult(
            auth,
            workspace,
            manager,
            target.id,
            input.prompt,
            {
              modeId: input.modeId,
              modelId: input.modelId,
              configOptionValues: input.configOptionValues,
            },
            undefined,
            undefined,
            { userTurnId: fixed.userTurnId, chainDepth: 0 }
          );
          await manager.repo.flush();
        }
      );
      return publicExternalReceipt(receipt);
    },
    operation: async (input) => {
      const receipt = await requests.get(access, input.operationId);
      if (!receipt) throw new Error('Operation not found');
      return publicExternalReceipt(receipt);
    },
  };
  const handlers: SessionToolHandlers = new Map();
  const server = buildExternalMcpServer((_name, _args, execute) => execute(), services, handlers);
  try {
    const handler = handlers.get(name);
    if (!handler) throw new Error('Unsupported external MCP tool');
    return SessionToolResultSchema.parse({ type: 'session/tool-result', ...(await handler(args)) });
  } finally {
    await server.close();
  }
}
