import {
  buildSessionToolServer,
  runWithMcpSessionContext,
  type McpSessionContext,
} from './lody-mcp-server';
import type { SessionToolHandlers } from './session-tool-router';
import {
  getSessionRoomId,
  isLoroRepoDocDeleted,
  SessionToolResultSchema,
  type SessionMeta,
} from '@lody/shared';
import {
  getDaemonWorkspace,
  getSessionCommandEnvironment,
} from '@/lib/session-command-environment';

// Registration is stateless (tools read scope from ALS), so build the handler table once.
let handlers: SessionToolHandlers | undefined;
const getHandlers = () => {
  if (!handlers) {
    handlers = new Map();
    void buildSessionToolServer(handlers);
  }
  return handlers;
};

/** Only explicitly registered Session/catalog tools cross this IPC boundary. */
export async function executeDaemonSessionTool(
  context: McpSessionContext,
  name: string,
  args: unknown
) {
  const daemon = getDaemonWorkspace();
  if (
    !daemon ||
    context.machineId !== daemon.machineId ||
    context.workspaceId !== daemon.workspaceId
  )
    throw new Error('Session tool scope mismatch');
  // The local platform has one user; cloud tools authorize their own requester.
  if (getSessionCommandEnvironment()) {
    const invocation = daemon.readInvocation(context.sessionId);
    if (!invocation.active || invocation.requesterUserId !== daemon.userId)
      throw new Error('Session tool requires an active local user Turn');
  }
  const row = await daemon.manager.repo.getDocMeta(getSessionRoomId(context.sessionId));
  if (
    !row?.meta ||
    isLoroRepoDocDeleted(row) ||
    (row.meta as SessionMeta).machineId !== daemon.machineId
  )
    throw new Error('Requester Session does not belong to this machine');
  const handler = getHandlers().get(name);
  if (!handler) throw new Error(`Unsupported daemon Session tool: ${name}`);
  const result = await runWithMcpSessionContext(context, () => handler(args));
  return SessionToolResultSchema.parse({ type: 'session/tool-result', ...result });
}
