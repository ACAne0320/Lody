import os from 'node:os';
import path from 'node:path';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MachineId, SessionId, WorkspaceId } from '@lody/shared';
import type { Logger } from '@/utils/logger';
import type { WorktreeManager } from './worktree-manager';
import {
  getLegacySpeculativeWorktreeMarkerPath,
  recoverLegacySpeculativeWorktrees,
} from './legacy-speculative-worktrees';

const WORKSPACE_ID = 'workspace-1' as WorkspaceId;
const MACHINE_ID = 'machine-1' as MachineId;
const CREATED_AT_MS = 1_000_000;
const STALE_NOW_MS = CREATED_AT_MS + 11 * 60_000;

function createLogger(): Logger {
  return {
    debug: vi.fn(),
    trace: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    setLevel: vi.fn(),
    setDebug: vi.fn(),
    child: vi.fn(),
    close: vi.fn(async () => undefined),
  } as unknown as Logger;
}

/** Worktree directories that exist on the fake host, keyed by session. */
function createWorktreeHost(sessionIds: SessionId[]) {
  const worktrees = new Set<SessionId>(sessionIds);
  const manager = {
    removeWorktree: async (sessionId: SessionId) => {
      worktrees.delete(sessionId);
    },
  } as unknown as WorktreeManager;
  return { worktrees, getManager: () => manager };
}

function writeLegacyMarker(
  sessionId: SessionId,
  overrides: { ownsWorktree?: boolean; workspaceId?: string; createdAtMs?: number } = {}
): string {
  const markerPath = getLegacySpeculativeWorktreeMarkerPath(sessionId);
  mkdirSync(path.dirname(markerPath), { recursive: true });
  writeFileSync(
    markerPath,
    JSON.stringify({
      version: 1,
      preparationId: `prepare-${sessionId}`,
      sessionId,
      workspaceId: overrides.workspaceId ?? WORKSPACE_ID,
      machineId: MACHINE_ID,
      repoId: 'repo-1',
      source: { kind: 'local-shared', originalRootPath: '/tmp/source' },
      baseBranch: 'main',
      ownsWorktree: overrides.ownsWorktree ?? true,
      phase: 'speculative',
      createdAtMs: overrides.createdAtMs ?? CREATED_AT_MS,
    })
  );
  return markerPath;
}

describe('legacy speculative worktree recovery', () => {
  let tempHome: string;

  beforeEach(() => {
    tempHome = mkdtempSync(path.join(os.tmpdir(), 'lody-legacy-speculative-worktree-'));
    vi.stubEnv('HOME', tempHome);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(tempHome, { recursive: true, force: true });
  });

  it('removes the worktree and marker of a stale preparation that never became durable', async () => {
    const sessionId = 'session-abandoned' as SessionId;
    const markerPath = writeLegacyMarker(sessionId);
    const host = createWorktreeHost([sessionId]);

    await recoverLegacySpeculativeWorktrees({
      workspaceId: WORKSPACE_ID,
      machineId: MACHINE_ID,
      logger: createLogger(),
      isDurableSession: async () => false,
      nowMs: STALE_NOW_MS,
      getManager: host.getManager,
    });

    expect(host.worktrees.has(sessionId)).toBe(false);
    expect(existsSync(markerPath)).toBe(false);
  });

  it('keeps the worktree of a durable session and only drops its marker', async () => {
    const sessionId = 'session-durable' as SessionId;
    const markerPath = writeLegacyMarker(sessionId);
    const host = createWorktreeHost([sessionId]);

    await recoverLegacySpeculativeWorktrees({
      workspaceId: WORKSPACE_ID,
      machineId: MACHINE_ID,
      logger: createLogger(),
      isDurableSession: async (candidate) => candidate === sessionId,
      nowMs: STALE_NOW_MS,
      getManager: host.getManager,
    });

    expect(host.worktrees.has(sessionId)).toBe(true);
    expect(existsSync(markerPath)).toBe(false);
  });

  it('keeps a worktree the preparation adopted rather than created', async () => {
    const sessionId = 'session-adopted' as SessionId;
    const markerPath = writeLegacyMarker(sessionId, { ownsWorktree: false });
    const host = createWorktreeHost([sessionId]);

    await recoverLegacySpeculativeWorktrees({
      workspaceId: WORKSPACE_ID,
      machineId: MACHINE_ID,
      logger: createLogger(),
      isDurableSession: async () => false,
      nowMs: STALE_NOW_MS,
      getManager: host.getManager,
    });

    expect(host.worktrees.has(sessionId)).toBe(true);
    expect(existsSync(markerPath)).toBe(false);
  });

  it('leaves recent, active and other-workspace markers alone', async () => {
    const recent = 'session-recent' as SessionId;
    const active = 'session-active' as SessionId;
    const foreign = 'session-foreign' as SessionId;
    const markers = [
      writeLegacyMarker(recent, { createdAtMs: STALE_NOW_MS - 60_000 }),
      writeLegacyMarker(active),
      writeLegacyMarker(foreign, { workspaceId: 'workspace-2' }),
    ];
    const host = createWorktreeHost([recent, active, foreign]);

    await recoverLegacySpeculativeWorktrees({
      workspaceId: WORKSPACE_ID,
      machineId: MACHINE_ID,
      logger: createLogger(),
      isActiveSession: (candidate) => candidate === active,
      isDurableSession: async () => false,
      nowMs: STALE_NOW_MS,
      getManager: host.getManager,
    });

    expect([...host.worktrees].sort()).toEqual([active, foreign, recent].sort());
    expect(markers.every((markerPath) => existsSync(markerPath))).toBe(true);
  });

  it('keeps the marker for a later pass when worktree removal fails', async () => {
    const sessionId = 'session-busy' as SessionId;
    const markerPath = writeLegacyMarker(sessionId);
    const manager = {
      removeWorktree: async () => {
        throw new Error('worktree is locked');
      },
    } as unknown as WorktreeManager;

    await recoverLegacySpeculativeWorktrees({
      workspaceId: WORKSPACE_ID,
      machineId: MACHINE_ID,
      logger: createLogger(),
      isDurableSession: async () => false,
      nowMs: STALE_NOW_MS,
      getManager: () => manager,
    });

    expect(existsSync(markerPath)).toBe(true);
  });
});
