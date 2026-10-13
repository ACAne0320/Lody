import {
  SessionHistoryInputConfigSchema,
  MessageContentSchema,
  normalizeLegacyAcpSessionConfig,
} from './message-schemas';

/** Canonical, content-bound authorization. Never include the proof in its own digest. */
export function canonicalExecutionJson(value: unknown): string {
  const visit = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(visit);
    if (item !== null && typeof item === 'object') {
      return Object.fromEntries(
        Object.entries(item)
          .filter(([, fieldValue]) => fieldValue !== undefined)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, fieldValue]) => [key, visit(fieldValue)])
      );
    }
    return item;
  };
  return JSON.stringify(visit(value));
}

export async function executionDigest(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalExecutionJson(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export type MachineExecutionIntent = {
  workspaceId: string;
  machineId: string;
  purpose: 'turn' | 'rpc' | 'provider' | 'mcp';
  digest: string;
};

export type MachineExecutionVerification = {
  requesterUserId: string;
  sharedWithTeam: boolean;
};

export function executionTurnPayload(
  meta: Record<string, unknown>,
  turn: { id: string; userId?: string; items?: unknown; inputConfig?: Record<string, unknown> }
): unknown {
  // Use the history write boundary's schemas so mirror container IDs and
  // legacy normalization do not change an otherwise identical signed turn.
  const normalized =
    turn.inputConfig === undefined
      ? {}
      : SessionHistoryInputConfigSchema.parse(normalizeLegacyAcpSessionConfig(turn.inputConfig));
  const { executionAuthorization: _proof, ...inputConfig } = normalized;
  const items =
    turn.items === undefined ? undefined : MessageContentSchema.array().parse(turn.items);
  return {
    session: Object.fromEntries(
      [
        'id',
        'machineId',
        'userId',
        'project',
        'agentConfigId',
        'agentType',
        'cliType',
        'parentSessionId',
        'externalHistory',
      ].map((key) => [key, meta[key]])
    ),
    turn: { id: turn.id, userId: turn.userId, items, inputConfig },
  };
}

/** The bearer is transported only to the authenticated backend, never to Streams. */
export async function requestMachineExecutionAuthority<T>(args: {
  baseUrl: string;
  credential: string;
  action: 'authorize' | 'verify';
  intent: MachineExecutionIntent;
  requestToken?: string;
  delegatedRequesterUserId?: string;
}): Promise<T> {
  const response = await fetch(
    `${args.baseUrl.replace(/\/+$/, '')}/api/machine-execution/${args.action}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${args.credential}` },
      body: JSON.stringify({
        ...args.intent,
        ...(args.delegatedRequesterUserId
          ? { delegatedRequesterUserId: args.delegatedRequesterUserId }
          : {}),
        ...(args.requestToken ? { requestToken: args.requestToken } : {}),
      }),
      signal: AbortSignal.timeout(30_000),
    }
  );
  if (!response.ok) throw new Error(`Machine execution authorization failed (${response.status})`);
  return (await response.json()) as T;
}
