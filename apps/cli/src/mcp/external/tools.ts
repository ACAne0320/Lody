import { McpServer, type CallToolResult } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { DiscoveryPageShape } from '@/lib/discovery-query';
import { createSessionToolRegistrar, type SessionToolHandlers } from '../session-tool-router';
import { registerDiscoveryTools } from '../discovery-tools';
import type { ResourceDiscovery } from '@/lib/resource-discovery';

const id = z.string().trim().min(1).max(200);
const runConfig = {
  modeId: id.optional(),
  modelId: id.optional(),
  configOptionValues: z
    .record(z.string().max(200), z.union([z.string().max(4000), z.boolean()]))
    .optional(),
};
export const ExternalCreateSchema = z
  .object({
    operationId: id,
    prompt: z
      .string()
      .min(1)
      .max(64 * 1024),
    agentConfigId: id,
    localProjectId: id.optional(),
    ...runConfig,
  })
  .strict();
export const ExternalChatSchema = z
  .object({
    operationId: id,
    sessionId: id,
    prompt: z
      .string()
      .min(1)
      .max(64 * 1024),
    ...runConfig,
  })
  .strict();
export const ExternalListSchema = z.object({ ...DiscoveryPageShape }).strict();
export const ExternalHistorySchema = z
  .object({
    sessionId: id,
    limit: z.number().int().min(1).max(50).default(10),
    cursor: z.string().max(2048).optional(),
  })
  .strict();
export const ExternalStatusSchema = z.object({ sessionIds: z.array(id).min(1).max(100) }).strict();
export const ExternalOperationSchema = z.object({ operationId: id }).strict();

export type ExternalToolServices = {
  discovery: () => Promise<ResourceDiscovery>;
  create: (input: z.output<typeof ExternalCreateSchema>) => Promise<unknown>;
  chat: (input: z.output<typeof ExternalChatSchema>) => Promise<unknown>;
  list: (input: z.output<typeof ExternalListSchema>) => Promise<unknown>;
  history: (input: z.output<typeof ExternalHistorySchema>) => Promise<unknown>;
  status: (input: z.output<typeof ExternalStatusSchema>) => Promise<unknown>;
  operation: (input: z.output<typeof ExternalOperationSchema>) => Promise<unknown>;
};

export function buildExternalMcpServer(
  route: (
    name: string,
    args: unknown,
    execute: () => Promise<CallToolResult>
  ) => Promise<CallToolResult>,
  services?: ExternalToolServices,
  handlers?: SessionToolHandlers
) {
  const server = new McpServer(
    { name: 'lody', version: '0.1.0' },
    {
      instructions:
        'This local endpoint is scoped to one workspace and machine. Discover agentConfigId and localProjectId before creating work. Supply a stable operationId for each create/chat; reuse it and identical arguments on transport retry. An uncertain receipt must be inspected, never automatically resubmitted with a new id. There are no parent-session callbacks; use operation_get, session_status_many and session_history to inspect results.',
    }
  );
  const register = createSessionToolRegistrar(server, route, handlers);
  const requireServices = () => {
    if (!services) throw new Error('External tools must execute in the daemon');
    return services;
  };
  registerDiscoveryTools(register, async (read) => read(await requireServices().discovery()));
  const add = <S extends z.ZodObject>(
    name: string,
    schema: S,
    description: string,
    readOnly: boolean,
    run: (service: ExternalToolServices, args: z.output<S>) => Promise<unknown>
  ) =>
    register(
      name,
      { inputSchema: schema, description, annotations: { readOnlyHint: readOnly } },
      async (args) => {
        try {
          return {
            content: [{ type: 'text', text: JSON.stringify(await run(requireServices(), args)) }],
          };
        } catch (error) {
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: error instanceof Error ? error.message : 'External tool failed',
              },
            ],
          };
        }
      }
    );
  add(
    'lody_session_create',
    ExternalCreateSchema,
    'Create a standalone Session on this machine. operationId is required. Returns fixed target ids and an acceptance receipt, not completion.',
    false,
    (service, args) => service.create(args)
  );
  add(
    'lody_session_chat',
    ExternalChatSchema,
    'Send input to a Session on this machine. operationId is required. Returns an acceptance receipt, not completion.',
    false,
    (service, args) => service.chat(args)
  );
  add(
    'lody_session_list',
    ExternalListSchema,
    'List Session summaries on this machine. Follow nextCursor with identical filters.',
    true,
    (service, args) => service.list(args)
  );
  add(
    'lody_session_history',
    ExternalHistorySchema,
    'Read a bounded page of visible Session history (maximum 128 KiB).',
    true,
    (service, args) => service.history(args)
  );
  add(
    'lody_session_status_many',
    ExternalStatusSchema,
    'Read live status of up to 100 Sessions on this machine.',
    true,
    (service, args) => service.status(args)
  );
  add(
    'lody_operation_get',
    ExternalOperationSchema,
    'Read the receipt for an external request in this workspace. Use its Session/Turn ids to inspect execution results.',
    true,
    (service, args) => service.operation(args)
  );
  return server;
}
