import type { MessageQueueItem, SessionHistoryInput, SessionMeta } from './schema';
import type { ACPSessionId } from './ai';
import type { SessionTurnInputConfig, AcpConfigOptionValue } from './ai';
import { MemoryBindingSchema } from './memory-provider';
import { normalizeSessionTurnInputConfig } from './message-schemas';
import { normalizeMcpServerIdSelection } from './workspace-mcp';
import {
  buildPendingUserHistoryEntry,
  buildSessionTurnInputConfig,
  normalizeSessionInputBlocks,
  extractPromptPreviewFromInputBlocks,
} from './session-input';

const isConfigOptionValueRecord = (value: unknown): value is Record<string, AcpConfigOptionValue> =>
  !!value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.values(value).every((item) => typeof item === 'string' || typeof item === 'boolean');

/** Authoring and promotion must use the same immutable input, including the resume request. */
export function buildQueuedSessionTurn(
  queuedItem: Pick<
    MessageQueueItem,
    'acpSessionConfig' | 'task' | 'userId' | 'timestamp' | 'executionAuthorization'
  >,
  meta: Pick<SessionMeta, 'cliType' | 'agentType' | 'userId'>,
  queuedTurnId: string
): SessionHistoryInput | null {
  const inputBlocks = normalizeSessionInputBlocks(
    queuedItem.acpSessionConfig?.inputBlocks,
    queuedItem.acpSessionConfig?.prompt ?? queuedItem.task
  );
  const inputConfig: SessionTurnInputConfig = buildSessionTurnInputConfig({
    inputBlocks,
    prompt: queuedItem.acpSessionConfig?.prompt ?? extractPromptPreviewFromInputBlocks(inputBlocks),
    cliType: queuedItem.acpSessionConfig?.cliType ?? meta.cliType,
    agentType: queuedItem.acpSessionConfig?.agentType ?? meta.agentType,
    modeId: queuedItem.acpSessionConfig?.modeId,
    modelId: queuedItem.acpSessionConfig?.modelId,
    configOptionValues: isConfigOptionValueRecord(queuedItem.acpSessionConfig?.configOptionValues)
      ? queuedItem.acpSessionConfig.configOptionValues
      : undefined,
    memory:
      queuedItem.acpSessionConfig?.memory === undefined
        ? undefined
        : MemoryBindingSchema.parse(queuedItem.acpSessionConfig.memory),
    mcpServerIds: normalizeMcpServerIdSelection(queuedItem.acpSessionConfig?.mcpServerIds) ?? [],
    agentRoleId: queuedItem.acpSessionConfig?.agentRoleId,
    agentRoleRevision: queuedItem.acpSessionConfig?.agentRoleRevision,
    agentRoleSnapshot: normalizeSessionTurnInputConfig(queuedItem.acpSessionConfig)
      ?.agentRoleSnapshot,
    issuePRMentions: queuedItem.acpSessionConfig?.issuePRMentions,
    resume: queuedItem.acpSessionConfig?.resume as ACPSessionId | undefined,
  });
  if (queuedItem.executionAuthorization)
    inputConfig.executionAuthorization = queuedItem.executionAuthorization;
  const pendingEntry = buildPendingUserHistoryEntry({
    userId: queuedItem.userId ?? meta.userId,
    inputBlocks,
    timestamp: queuedItem.timestamp,
    inputConfig,
  });
  return pendingEntry ? { ...pendingEntry, id: queuedTurnId } : null;
}
