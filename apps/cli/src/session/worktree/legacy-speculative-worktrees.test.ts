import os from 'node:os';
import path from 'node:path';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MachineId, RepoId, SessionId, WorkspaceId } from '@lody/shared';
import type { Logger } from '@/utils/logger';
import type { WorktreeManager } from './worktree-manager';
import {
  claimLegacySpeculativeWorktree,
  completeLegacySpeculativeWorktreeSetup,
  getLegacySpeculativeWorktreeMarkerPath,
  recoverLegacySpeculativeWorktrees,
} from './legacy-speculative-worktrees';

const WORKSPACE_ID = 'workspace-1' as WorkspaceId;
const MACHINE_ID = 'machine-1' as MachineId;
const CREATED_AT_MS = 1_000_000;
const TARGET = {
  repoId: 'repo-1' as RepoId,
  source: { kind: 'local-shared' as const, originalRootPath: '/tmp/source' },
  baseBranch: 'main',
};

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
  overrides: { ownsWorktree?: boolean; workspaceId?: string; baseBranch?: string } = {}
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
      baseBranch: overrides.baseBranch ?? 'main',
      ownsWorktree: overrides.ownsWorktree ?? true,
      phase: 'speculative',
      createdAtMs: CREATED_AT_MS,
    })
  );
  return markerPath;
}

describe('legacy speculative worktrees', () => {
  let tempHome: string;

  beforeEach(() => {
    tempHome = mkdtempSync(path.join(os.tmpdir(), 'lody-legacy-speculative-worktree-'));
    vi.stubEnv('HOME', tempHome);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(tempHome, { recursive: true, force: true });
  });

  const sweep = (
    host: ReturnType<typeof createWorktreeHost>,
    overrides: Partial<Parameters<typeof recoverLegacySpeculativeWorktrees>[0]> = {}
  ) =>
    recoverLegacySpeculativeWorktrees({
      workspaceId: WORKSPACE_ID,
      machineId: MACHINE_ID,
      logger: createLogger(),
      isDurableSession: async () => false,
      getManager: host.getManager,
      ...overrides,
    });

  const claim = (sessionId: SessionId, host: ReturnType<typeof createWorktreeHost>) =>
    claimLegacySpeculativeWorktree({
      sessionId,
      workspaceId: WORKSPACE_ID,
      machineId: MACHINE_ID,
      target: TARGET,
      logger: createLogger(),
      getManager: host.getManager,
    });

  it('removes an orphan at startup regardless of its age', async () => {
    const sessionId = 'session-abandoned' as SessionId;
    const markerPath = writeLegacyMarker(sessionId);
    const host = createWorktreeHost([sessionId]);

    await sweep(host);

    expect(host.worktrees.has(sessionId)).toBe(false);
    expect(existsSync(markerPath)).toBe(false);
  });

  it('keeps a worktree the preparation adopted rather than created', async () => {
    const sessionId = 'session-adopted' as SessionId;
    const markerPath = writeLegacyMarker(sessionId, { ownsWorktree: false });
    const host = createWorktreeHost([sessionId]);

    await sweep(host);

    expect(host.worktrees.has(sessionId)).toBe(true);
    expect(existsSync(markerPath)).toBe(false);
  });

  it('leaves durable, active and other-workspace markers for their own Session', async () => {
    const durable = 'session-durable' as SessionId;
    const active = 'session-active' as SessionId;
    const foreign = 'session-foreign' as SessionId;
    const markers = [
      writeLegacyMarker(durable),
      writeLegacyMarker(active),
      writeLegacyMarker(foreign, { workspaceId: 'workspace-2' }),
    ];
    const host = createWorktreeHost([durable, active, foreign]);

    await sweep(host, {
      isActiveSession: (candidate) => candidate === active,
      isDurableSession: async (candidate) => candidate === durable,
    });

    expect([...host.worktrees].sort()).toEqual([active, durable, foreign].sort());
    expect(markers.every((markerPath) => existsSync(markerPath))).toBe(true);
  });

  it('does not remove a worktree whose Session starts while the sweep checks durability', async () => {
    const sessionId = 'session-racing' as SessionId;
    const markerPath = writeLegacyMarker(sessionId);
    const host = createWorktreeHost([sessionId]);
    let creating = false;

    await sweep(host, {
      isActiveSession: (candidate) => candidate === sessionId && creating,
      isDurableSession: async () => {
        // The dispatch's create registers while the sweep awaits metadata.
        creating = true;
        return false;
      },
    });

    expect(host.worktrees.has(sessionId)).toBe(true);
    expect(existsSync(markerPath)).toBe(true);
    await expect(claim(sessionId, host)).resolves.toBe('setup-pending');
  });

  it('keeps the marker for a later pass when worktree removal fails', async () => {
    const sessionId = 'session-busy' as SessionId;
    const markerPath = writeLegacyMarker(sessionId);
    const manager = {
      removeWorktree: async () => {
        throw new Error('worktree is locked');
      },
    } as unknown as WorktreeManager;

    await sweep(createWorktreeHost([sessionId]), { getManager: () => manager });

    expect(existsSync(markerPath)).toBe(true);
  });

  it('rebuilds a worktree that was prepared for a different base branch', async () => {
    const sessionId = 'session-rebased' as SessionId;
    const markerPath = writeLegacyMarker(sessionId, { baseBranch: 'dev' });
    const host = createWorktreeHost([sessionId]);

    await expect(claim(sessionId, host)).resolves.toBe('mismatch');

    expect(host.worktrees.has(sessionId)).toBe(false);
    expect(existsSync(markerPath)).toBe(false);
  });

  it('keeps a matching worktree pending setup until setup completes', async () => {
    const sessionId = 'session-matching' as SessionId;
    const markerPath = writeLegacyMarker(sessionId);
    const host = createWorktreeHost([sessionId]);

    await expect(claim(sessionId, host)).resolves.toBe('setup-pending');
    expect(host.worktrees.has(sessionId)).toBe(true);
    // An interrupted setup leaves the claim in place for the next resume.
    await expect(claim(sessionId, host)).resolves.toBe('setup-pending');

    await completeLegacySpeculativeWorktreeSetup({
      sessionId,
      workspaceId: WORKSPACE_ID,
      machineId: MACHINE_ID,
      target: TARGET,
    });

    expect(existsSync(markerPath)).toBe(false);
    await expect(claim(sessionId, host)).resolves.toBe('no-marker');
  });

  it('ignores another workspace marker for the same Session id', async () => {
    const sessionId = 'session-shared-id' as SessionId;
    const markerPath = writeLegacyMarker(sessionId, {
      workspaceId: 'workspace-2',
      baseBranch: 'dev',
    });
    const host = createWorktreeHost([sessionId]);

    await expect(claim(sessionId, host)).resolves.toBe('no-marker');

    expect(host.worktrees.has(sessionId)).toBe(true);
    expect(existsSync(markerPath)).toBe(true);
  });
});
