import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Effect, ManagedRuntime } from 'effect';
import {
  CatalogPermissionError,
  MEMBER_ACCESS_SNAPSHOT_TTL_MS,
  makeLocalWorkspaceCatalog,
  type LocalWorkspaceCatalogService,
  type LocalWorkspaceCatalogSnapshot,
} from '../src/lib/local-workspace-catalog';
import { fileLockLayer } from '../src/utils/file-lock';
import {
  decideSessionAccessFromCatalog,
  makeSessionAccessPolicy,
} from '../src/session/session-access-policy';

const NOW_MS = Date.parse('2026-10-15T16:00:00.000Z');

const snapshot = (
  workspace: LocalWorkspaceCatalogSnapshot['workspaces'][number]
): LocalWorkspaceCatalogSnapshot => ({
  version: 1,
  identity: { userId: 'user-1' },
  machine: { machineId: 'machine-1' },
  workspaces: [workspace],
  sessions: [],
});

const activeWorkspace = (
  accessSnapshot?: LocalWorkspaceCatalogSnapshot['workspaces'][number]['accessSnapshot']
): LocalWorkspaceCatalogSnapshot['workspaces'][number] => ({
  workspaceId: 'workspace-1',
  name: 'Workspace',
  slug: 'workspace',
  role: 'owner',
  state: 'active',
  cachedAt: 1,
  ...(accessSnapshot ? { accessSnapshot } : {}),
});

describe('Session access policy (optimistic-allow cache)', () => {
  it('allows an owner-cached requester with an owner allow snapshot', () => {
    expect(
      decideSessionAccessFromCatalog(
        snapshot(
          activeWorkspace({
            ownerUserId: 'user-1',
            verifiedAt: '2026-07-02T00:00:00.000Z',
          })
        ),
        {
          workspaceId: 'workspace-1',
          currentUserId: 'user-1',
          requesterUserId: 'user-1',
        },
        NOW_MS
      )
    ).toEqual({ outcome: 'allow', source: 'owner-cached' });
  });

  it('does not use an owner snapshot for another requester', () => {
    expect(
      decideSessionAccessFromCatalog(
        snapshot(
          activeWorkspace({
            ownerUserId: 'user-1',
            verifiedAt: '2026-07-02T00:00:00.000Z',
          })
        ),
        {
          workspaceId: 'workspace-1',
          currentUserId: 'user-1',
          requesterUserId: 'user-2',
        },
        NOW_MS
      )
    ).toEqual({ outcome: 'remote' });
  });

  it('ignores snapshots from a different cached identity', () => {
    const input = snapshot(
      activeWorkspace({
        ownerUserId: 'user-1',
        verifiedAt: '2026-07-02T00:00:00.000Z',
      })
    );
    input.identity = { userId: 'user-old' };

    expect(
      decideSessionAccessFromCatalog(
        input,
        {
          workspaceId: 'workspace-1',
          currentUserId: 'user-1',
          requesterUserId: 'user-1',
        },
        NOW_MS
      )
    ).toEqual({ outcome: 'remote' });
  });

  it('falls through to remote when the cached owner is a different user', () => {
    expect(
      decideSessionAccessFromCatalog(
        snapshot(
          activeWorkspace({
            ownerUserId: 'user-other',
            verifiedAt: '2026-07-02T00:00:00.000Z',
          })
        ),
        {
          workspaceId: 'workspace-1',
          currentUserId: 'user-1',
          requesterUserId: 'user-1',
        },
        NOW_MS
      )
    ).toEqual({ outcome: 'remote' });
  });

  it('falls through to remote when there is no access snapshot (post-clear / never verified)', () => {
    // This is the wedge fix: a transient backend deny CLEARS the snapshot rather
    // than caching a durable "denied", so the workspace goes back to a fresh
    // remote check instead of being permanently blocked.
    expect(
      decideSessionAccessFromCatalog(
        snapshot(activeWorkspace()),
        {
          workspaceId: 'workspace-1',
          currentUserId: 'user-1',
          requesterUserId: 'user-1',
        },
        NOW_MS
      )
    ).toEqual({ outcome: 'remote' });
  });

  it('ignores remote_missing state recorded under a different cached identity', () => {
    const input = snapshot({
      ...activeWorkspace(),
      state: 'remote_missing',
      remoteMissingAt: 2,
    });
    input.identity = { userId: 'user-old' };

    expect(
      decideSessionAccessFromCatalog(
        input,
        {
          workspaceId: 'workspace-1',
          currentUserId: 'user-1',
          requesterUserId: 'user-1',
        },
        NOW_MS
      )
    ).toEqual({ outcome: 'remote' });
  });

  it('denies remote_missing workspaces before remote verification', () => {
    expect(
      decideSessionAccessFromCatalog(
        snapshot({
          ...activeWorkspace(),
          state: 'remote_missing',
          remoteMissingAt: 2,
        }),
        {
          workspaceId: 'workspace-1',
          currentUserId: 'user-1',
          requesterUserId: 'user-1',
        },
        NOW_MS
      )
    ).toEqual({ outcome: 'deny', reason: 'not_visible', source: 'remote_missing' });
  });

  it('degrades a catalog read failure to the remote check instead of erroring (F6)', async () => {
    // Missing/corrupt catalogs self-recover inside read(); a permission error
    // (e.g. EACCES on ~/.lody) does not. The policy must degrade to
    // `{ outcome: 'remote' }` — the no-catalog behavior — rather than fail the
    // dispatch check and strand the turn pending forever.
    const catalog: LocalWorkspaceCatalogService = {
      read: () =>
        Effect.fail(
          new CatalogPermissionError({ path: '/home/user/.lody/workspace-catalog.json' })
        ),
      listActiveWorkspaces: () => Effect.die('not used'),
      cacheRemoteWorkspaces: () => Effect.die('not used'),
      recordWorkspaceAccessSnapshot: () => Effect.die('not used'),
      recordMemberAccessSnapshot: () => Effect.die('not used'),
      upsertSession: () => Effect.die('not used'),
    };
    const policy = makeSessionAccessPolicy(catalog);

    await expect(
      Effect.runPromise(
        policy.decide({
          workspaceId: 'workspace-1',
          currentUserId: 'user-1',
          requesterUserId: 'user-1',
        })
      )
    ).resolves.toEqual({ outcome: 'remote' });
  });

  it('trusts a confirmed member allow for one hour, per requester and local project', async () => {
    const runtime = ManagedRuntime.make(fileLockLayer);
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lody-member-access-'));
    let now = NOW_MS;
    try {
      const catalog = makeLocalWorkspaceCatalog({
        filePath: path.join(dir, 'workspace-catalog.json'),
        lockName: `member-access-${path.basename(dir)}`,
        now: () => now,
      });
      const policy = makeSessionAccessPolicy(catalog, () => now);
      const decide = (requesterUserId: string, localProjectId?: string) =>
        Effect.runPromise(
          policy.decide({
            workspaceId: 'workspace-1',
            currentUserId: 'user-owner',
            requesterUserId,
            ...(localProjectId ? { localProjectId } : {}),
          })
        );
      const remoteRefresh = () =>
        runtime.runPromise(
          catalog.cacheRemoteWorkspaces({
            identity: { userId: 'user-owner' },
            machine: { machineId: 'machine-1' },
            workspaces: [{ id: 'workspace-1', name: 'Alpha', slug: 'alpha', role: 'member' }],
          })
        );
      await remoteRefresh();
      expect(await decide('user-member', 'project-a')).toEqual({ outcome: 'remote' });

      await runtime.runPromise(
        catalog.recordMemberAccessSnapshot({
          workspaceId: 'workspace-1',
          requesterUserId: 'user-member',
          localProjectId: 'project-a',
          verifiedAt: new Date(now).toISOString(),
        })
      );
      // A workspace refresh must not drop the member cache.
      await remoteRefresh();

      expect(await decide('user-member', 'project-a')).toEqual({
        outcome: 'allow',
        source: 'member-cached',
      });
      // Project sharing is part of the verdict, and the entry is per requester.
      expect(await decide('user-member', 'project-b')).toEqual({ outcome: 'remote' });
      expect(await decide('user-member')).toEqual({ outcome: 'remote' });
      expect(await decide('user-other', 'project-a')).toEqual({ outcome: 'remote' });

      now = NOW_MS + MEMBER_ACCESS_SNAPSHOT_TTL_MS - 1;
      expect(await decide('user-member', 'project-a')).toEqual({
        outcome: 'allow',
        source: 'member-cached',
      });
      now = NOW_MS + MEMBER_ACCESS_SNAPSHOT_TTL_MS;
      expect(await decide('user-member', 'project-a')).toEqual({ outcome: 'remote' });
      // A clock that moved backwards does not extend trust either.
      now = NOW_MS - 1;
      expect(await decide('user-member', 'project-a')).toEqual({ outcome: 'remote' });
    } finally {
      await runtime.dispose();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('clears a member allow on a definitive deny and prunes expired entries on write', async () => {
    const runtime = ManagedRuntime.make(fileLockLayer);
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lody-member-access-'));
    let now = NOW_MS;
    try {
      const catalog = makeLocalWorkspaceCatalog({
        filePath: path.join(dir, 'workspace-catalog.json'),
        lockName: `member-access-${path.basename(dir)}`,
        now: () => now,
      });
      const record = (requesterUserId: string, verifiedAt: string | null) =>
        runtime.runPromise(
          catalog.recordMemberAccessSnapshot({
            workspaceId: 'workspace-1',
            requesterUserId,
            verifiedAt,
          })
        );
      const members = async () =>
        (await runtime.runPromise(catalog.read())).workspaces[0]?.memberAccessSnapshots;
      await runtime.runPromise(
        catalog.cacheRemoteWorkspaces({
          identity: { userId: 'user-owner' },
          machine: { machineId: 'machine-1' },
          workspaces: [{ id: 'workspace-1', name: 'Alpha', slug: 'alpha', role: 'member' }],
        })
      );

      await record('user-a', new Date(now).toISOString());
      await record('user-b', new Date(now).toISOString());
      await record('user-a', null);
      expect((await members())?.map((entry) => entry.requesterUserId)).toEqual(['user-b']);

      now = NOW_MS + MEMBER_ACCESS_SNAPSHOT_TTL_MS;
      await record('user-c', new Date(now).toISOString());
      expect((await members())?.map((entry) => entry.requesterUserId)).toEqual(['user-c']);

      await record('user-c', null);
      expect(await members()).toBeUndefined();
    } finally {
      await runtime.dispose();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
