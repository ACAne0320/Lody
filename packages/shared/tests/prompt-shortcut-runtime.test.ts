import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceRepoLegacy as LoroRepo } from '../src/workspace-data/repo-legacy';
import { PromptShortcutSync } from '../src/prompt-shortcuts/sync';
import { LoroDoc } from 'loro-crdt';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileSystemStorageAdaptor } from 'loro-repo/storage/filesystem';
import { getShortcutBodyStreamId, type ShortcutResource } from '../src/prompt-shortcuts/access';
import {
  projectShortcutIndex,
  type PromptShortcutIndexEntry,
} from '../src/prompt-shortcuts/catalog';
import { PromptShortcutDocument } from '../src/prompt-shortcuts/document';
import { LocalShortcutStore } from '../src/prompt-shortcuts/local-store';
import type { PromptShortcut } from '../src/prompt-shortcuts/model';
import {
  PromptShortcutRuntime,
  type ShortcutPublicationPort,
} from '../src/prompt-shortcuts/runtime';

const workspaceId = 'workspace-a';
const userId = 'user-a';
const directories: string[] = [];
async function createRepo() {
  const baseDir = await mkdtemp(join(tmpdir(), 'lody-shortcut-native-'));
  directories.push(baseDir);
  return LoroRepo.create({ storageAdapter: new FileSystemStorageAdaptor({ baseDir }) });
}

function shortcut(id: string): PromptShortcut {
  return {
    v: 1,
    id,
    workspaceId,
    ownerUserId: userId,
    visibility: 'workspace',
    name: `Shortcut ${id}`,
    slug: id,
    prompt: `Prompt ${id}`,
    mentions: [],
    scope: {},
    revision: `revision-${id}`,
    createdAt: 1,
    updatedAt: 1,
  };
}

function noopPublicationPort(acquire: ShortcutPublicationPort['acquire']): ShortcutPublicationPort {
  return {
    acquire,
    stage: vi.fn(async () => 'active'),
    activate: vi.fn(async () => {}),
    settle: vi.fn(async () => 'active'),
    revoke: vi.fn(async () => {}),
    dispose: vi.fn(async () => {}),
  };
}

async function createRuntime(
  values: readonly PromptShortcut[],
  acquire: ShortcutPublicationPort['acquire']
) {
  const repo = await createRepo();
  const store = await LocalShortcutStore.open({ repo, workspaceId, userId });
  const entries = values.map((value) => projectShortcutIndex(value, `body-${value.id}`));
  await store.cacheDiscovery({
    entries,
    directory: entries.map((entry) => ({
      shortcutId: entry.id,
      bodyDocId: entry.bodyDocId,
      ownerUserId: entry.ownerUserId,
      visibility: entry.visibility,
      revision: entry.revision,
    })),
  });
  const runtime = new PromptShortcutRuntime(store, noopPublicationPort(acquire));
  return {
    entries,
    repo,
    runtime,
    async close() {
      await runtime.dispose();
      await repo.destroy();
    },
  };
}

async function saveBody(repo: LoroRepo, entry: PromptShortcutIndexEntry, value: PromptShortcut) {
  const docId = getShortcutBodyStreamId(entry.bodyDocId);
  const lease = await repo.acquireDoc(docId);
  try {
    new PromptShortcutDocument(lease.doc).save(value, []);
    await repo.persistDocNow(docId, lease.doc);
  } finally {
    await lease.release();
  }
}

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))
  );
  vi.unstubAllGlobals();
});

describe('PromptShortcutSync native SDK ownership', () => {
  it('imports a read-only body without echo uploads and retains it for another borrower', async () => {
    const repo = await createRepo();
    const author = new LoroDoc();
    author.getText('body').insert(0, 'shared shortcut');
    author.commit();
    const snapshot = author.export({ mode: 'snapshot' });
    const writes: string[] = [];
    vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input);
      const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
      if (method !== 'GET' && method !== 'HEAD') writes.push(method);
      const headers = { 'Stream-Next-Offset': '100', 'Stream-Up-To-Date': 'true' };
      if (url.pathname.endsWith('/bootstrap'))
        return new Response(
          Buffer.concat([
            Buffer.from('--shortcut\r\nContent-Type: application/octet-stream\r\n\r\n'),
            snapshot,
            Buffer.from('\r\n--shortcut--\r\n'),
          ]),
          {
            headers: {
              ...headers,
              'Content-Type': 'multipart/mixed; boundary=shortcut',
              'Stream-Snapshot-Offset': '100',
            },
          }
        );
      return new Response(null, { headers });
    });
    const streamId = getShortcutBodyStreamId('native-read');
    const sync = new PromptShortcutSync({
      repo,
      now: () => 0,
      grant: async () => ({
        token: 'synthetic-grant',
        expiresIn: 3600,
        gatewayBaseUrl: 'https://shortcut.invalid',
        streamId,
      }),
    });
    cleanups.push(async () => {
      await sync.dispose();
      await repo.destroy();
      author.free();
    });
    const resource = { kind: 'body', bodyDocId: 'native-read' } as const;
    const first = await sync.acquire(resource, false);
    const second = await sync.acquire(resource, false);
    await first.sync();
    const borrower = await repo.acquireDoc(streamId);
    expect(borrower.doc.getText('body').toString()).toBe('shared shortcut');
    await first.release();
    await second.sync();
    expect(borrower.doc.getText('body').toString()).toBe('shared shortcut');
    expect(writes).toEqual([]);
    await second.release();
    await borrower.release();
  });

  it('rejects a grant for a different body before opening a replica or making HTTP requests', async () => {
    const repo = await createRepo();
    const sync = new PromptShortcutSync({
      repo,
      now: () => 0,
      grant: async () => ({
        token: 'synthetic-grant',
        expiresIn: 60,
        gatewayBaseUrl: 'https://shortcut.invalid',
        streamId: 'wrong-body',
      }),
    });
    cleanups.push(async () => {
      await sync.dispose();
      await repo.destroy();
    });
    await expect(sync.acquire({ kind: 'body', bodyDocId: 'wanted' }, false)).rejects.toMatchObject({
      code: 'forbidden',
    });
    expect(await repo.listDoc()).toEqual([]);
  });
});

describe('PromptShortcutRuntime body warming', () => {
  it('coalesces a foreground read with the same in-flight body fetch', async () => {
    const value = shortcut('review');
    const gate = Promise.withResolvers<void>();
    let fixture!: Awaited<ReturnType<typeof createRuntime>>;
    const acquire = vi.fn(async () => ({
      sync: async () => {
        await gate.promise;
        await saveBody(fixture.repo, fixture.entries[0]!, value);
      },
      join: async () => {},
      release: async () => {},
    }));
    fixture = await createRuntime([value], acquire);
    cleanups.push(fixture.close);

    const warm = fixture.runtime.prefetch(fixture.entries);
    await vi.waitFor(() => expect(acquire).toHaveBeenCalledTimes(1));
    const foreground = fixture.runtime.read(fixture.entries[0]!);
    gate.resolve();

    await expect(Promise.all([warm, foreground])).resolves.toEqual([undefined, value]);
    expect(acquire).toHaveBeenCalledTimes(1);
    await expect(fixture.runtime.read(fixture.entries[0]!)).resolves.toEqual(value);
    expect(acquire).toHaveBeenCalledTimes(1);
  });

  it('warms current bodies serially and continues after a failed body', async () => {
    const values = [shortcut('first'), shortcut('second'), shortcut('third')];
    let fixture!: Awaited<ReturnType<typeof createRuntime>>;
    let active = 0;
    let maxActive = 0;
    let firstFailures = 1;
    const acquired: string[] = [];
    const acquire = vi.fn(async (resource: ShortcutResource) => {
      if (resource.kind !== 'body') throw new Error('Unexpected index acquisition');
      acquired.push(resource.bodyDocId);
      return {
        sync: async () => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          try {
            await Promise.resolve();
            if (resource.bodyDocId === 'body-first' && firstFailures > 0) {
              firstFailures -= 1;
              throw new Error('offline');
            }
            const index = fixture.entries.find((entry) => entry.bodyDocId === resource.bodyDocId)!;
            const value = values.find((item) => item.id === index.id)!;
            await saveBody(fixture.repo, index, value);
          } finally {
            active -= 1;
          }
        },
        join: async () => {},
        release: async () => {},
      };
    });
    fixture = await createRuntime(values, acquire);
    cleanups.push(fixture.close);

    await expect(fixture.runtime.prefetch(fixture.entries)).resolves.toBeUndefined();
    expect(acquired).toEqual(['body-first', 'body-second', 'body-third']);
    expect(maxActive).toBe(1);

    await fixture.runtime.prefetch(fixture.entries);
    expect(acquired).toEqual(['body-first', 'body-second', 'body-third', 'body-first']);
    await fixture.runtime.prefetch(fixture.entries);
    expect(acquired).toHaveLength(4);
  });

  it('serializes overlapping prefetch batches', async () => {
    const values = [shortcut('old'), shortcut('new')];
    const firstGate = Promise.withResolvers<void>();
    let fixture!: Awaited<ReturnType<typeof createRuntime>>;
    let active = 0;
    let maxActive = 0;
    const acquired: string[] = [];
    const acquire = vi.fn(async (resource: ShortcutResource) => {
      if (resource.kind !== 'body') throw new Error('Unexpected index acquisition');
      acquired.push(resource.bodyDocId);
      return {
        sync: async () => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          try {
            if (resource.bodyDocId === 'body-old') await firstGate.promise;
            const index = fixture.entries.find((entry) => entry.bodyDocId === resource.bodyDocId)!;
            const value = values.find((item) => item.id === index.id)!;
            await saveBody(fixture.repo, index, value);
          } finally {
            active -= 1;
          }
        },
        join: async () => {},
        release: async () => {},
      };
    });
    fixture = await createRuntime(values, acquire);
    cleanups.push(fixture.close);

    const first = fixture.runtime.prefetch([fixture.entries[0]!]);
    await vi.waitFor(() => expect(acquired).toEqual(['body-old']));
    const second = fixture.runtime.prefetch([fixture.entries[1]!]);
    try {
      await Promise.resolve();
      expect(acquired).toEqual(['body-old']);
    } finally {
      firstGate.resolve();
    }

    await Promise.all([first, second]);
    expect(acquired).toEqual(['body-old', 'body-new']);
    expect(maxActive).toBe(1);
  });

  it('stops queued bodies when the prefetch scope is cancelled', async () => {
    const values = [shortcut('active'), shortcut('queued')];
    const activeGate = Promise.withResolvers<void>();
    let fixture!: Awaited<ReturnType<typeof createRuntime>>;
    const acquired: string[] = [];
    const acquire = vi.fn(async (resource: ShortcutResource) => {
      if (resource.kind !== 'body') throw new Error('Unexpected index acquisition');
      acquired.push(resource.bodyDocId);
      return {
        sync: async () => {
          if (resource.bodyDocId === 'body-active') await activeGate.promise;
          const index = fixture.entries.find((entry) => entry.bodyDocId === resource.bodyDocId)!;
          const value = values.find((item) => item.id === index.id)!;
          await saveBody(fixture.repo, index, value);
        },
        join: async () => {},
        release: async () => {},
      };
    });
    fixture = await createRuntime(values, acquire);
    cleanups.push(fixture.close);
    const controller = new AbortController();

    const warming = fixture.runtime.prefetch(fixture.entries, { signal: controller.signal });
    await vi.waitFor(() => expect(acquired).toEqual(['body-active']));
    controller.abort();
    activeGate.resolve();
    await warming;

    expect(acquired).toEqual(['body-active']);
  });
});
