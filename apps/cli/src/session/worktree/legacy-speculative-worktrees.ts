import { createHash } from 'node:crypto';
import path from 'node:path';
import { readFile, readdir, rm } from 'node:fs/promises';
import { z } from 'zod';
import type { MachineId, RepoId, SessionId, WorkspaceId } from '@lody/shared';
import type { Logger } from '@/utils/logger';
import {
  getWorktreeManager,
  type WorktreeManager,
  type WorktreeManagerConfig,
  type WorktreeManagerSource,
} from './worktree-manager';
import { formatErrorMessage } from '@/utils/format-error';
import { getLodyDataDir } from '@lody/shared/node/installation-profile';

/**
 * Cleanup for worktrees left behind by draft session preparation, which daemons
 * before its removal materialized while the user was still typing. Nothing
 * writes these markers any more. A marker survives only when such a daemon
 * stopped before disposing its preparation, and worktree GC never removes the
 * directory because its Session was never published. Delete this module once
 * no supported daemon can have written a marker.
 */
const LEGACY_MARKER_STALE_MS = 10 * 60_000;

const WorktreeManagerSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('github'), repoUrl: z.string().optional() }).strict(),
  z
    .object({
      kind: z.literal('local-shared'),
      sourceGitDir: z.string().optional(),
      originalRootPath: z.string(),
    })
    .strict(),
]);

const LegacySpeculativeWorktreeMarkerSchema = z
  .object({
    version: z.literal(1),
    preparationId: z.string().min(1),
    sessionId: z.string().min(1),
    workspaceId: z.string().min(1),
    machineId: z.string().min(1),
    repoId: z.string().min(1),
    source: WorktreeManagerSourceSchema,
    baseBranch: z.string().optional(),
    ownsWorktree: z.boolean(),
    phase: z.enum(['speculative', 'durable-pending-setup']),
    createdAtMs: z.number().finite(),
  })
  .strict();

type LegacySpeculativeWorktreeMarker = z.infer<typeof LegacySpeculativeWorktreeMarkerSchema>;

export function getLegacySpeculativeWorktreeMarkerRoot(): string {
  return path.join(getLodyDataDir(), 'session-preparations', 'worktrees');
}

export function getLegacySpeculativeWorktreeMarkerPath(sessionId: SessionId): string {
  const key = createHash('sha256').update(sessionId).digest('hex');
  return path.join(getLegacySpeculativeWorktreeMarkerRoot(), `${key}.json`);
}

async function readMarkerFile(markerPath: string): Promise<LegacySpeculativeWorktreeMarker | null> {
  try {
    const parsed = LegacySpeculativeWorktreeMarkerSchema.safeParse(
      JSON.parse(await readFile(markerPath, 'utf8')) as unknown
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Removes this workspace's stale legacy markers. A marker whose Session became
 * durable only loses the marker: that Session owns the directory now. Any other
 * stale marker also loses the worktree it created.
 */
export async function recoverLegacySpeculativeWorktrees(args: {
  workspaceId: WorkspaceId;
  machineId: MachineId;
  logger: Logger;
  isDurableSession: (sessionId: SessionId) => Promise<boolean>;
  isActiveSession?: (sessionId: SessionId) => boolean;
  nowMs?: number;
  getManager?: (config: WorktreeManagerConfig) => WorktreeManager;
}): Promise<void> {
  const nowMs = args.nowMs ?? Date.now();
  const root = getLegacySpeculativeWorktreeMarkerRoot();
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    const markerPath = path.join(root, entry);
    try {
      const marker = await readMarkerFile(markerPath);
      if (
        !marker ||
        marker.workspaceId !== args.workspaceId ||
        marker.machineId !== args.machineId ||
        nowMs - marker.createdAtMs < LEGACY_MARKER_STALE_MS
      ) {
        continue;
      }
      const sessionId = marker.sessionId as SessionId;
      if (args.isActiveSession?.(sessionId)) continue;
      if (marker.ownsWorktree && !(await args.isDurableSession(sessionId))) {
        const manager = (args.getManager ?? getWorktreeManager)({
          repoId: marker.repoId as RepoId,
          source: marker.source as WorktreeManagerSource,
          logger: args.logger,
        });
        await manager.removeWorktree(
          sessionId,
          true,
          undefined,
          marker.baseBranch ? { baseBranchName: marker.baseBranch } : undefined
        );
      }
      await rm(markerPath, { force: true });
    } catch (error) {
      args.logger.debug(
        `Failed to recover legacy speculative worktree marker ${entry}: ${formatErrorMessage(error)}`
      );
    }
  }
}
