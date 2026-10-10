import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { Identity } from '@loro-dev/roost';
import { fromApplicationJson } from '@loro-dev/roost/lody-history';
import { createRoostHistoryReader } from '@lody/shared/session-data';
import { createRoostReadPort } from '../src/session/roost-history-port';

describe('local Roost owner adapter', () => {
  it('keeps the SDK Worker in its package when a composing build bundles dependencies', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lody-roost-bundle space-'));
    try {
      const sdkDirectory = dirname(fileURLToPath(import.meta.resolve('@loro-dev/roost-node')));
      const scopeDirectory = join(directory, 'node_modules', '@loro-dev');
      await mkdir(scopeDirectory, { recursive: true });
      await symlink(
        sdkDirectory,
        join(scopeDirectory, 'roost-node'),
        process.platform === 'win32' ? 'junction' : 'dir'
      );
      const loaderPath = fileURLToPath(
        new URL('../src/session/roost-native-runtime.ts', import.meta.url)
      );
      const entry = join(directory, 'probe.mjs');
      await build({
        stdin: {
          contents: `
import assert from 'node:assert/strict';
import { createPrivateKey, createPublicKey } from 'node:crypto';
import { join } from 'node:path';
import { createRoostNativeClient } from ${JSON.stringify(loaderPath)};
const seed = new Uint8Array(32).fill(17);
const key = createPrivateKey({
  key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]),
  format: 'der', type: 'pkcs8',
});
const owner = createPublicKey(key).export({format:'der', type:'spki'}).subarray(-32);
const options = {
  dbPath: join(import.meta.dirname, 'history.db'), seed, allowedOwners: [owner],
  clockMs: 1700000000000n, maxQueuedRequests: 8, maxQueuedBytes: 4096,
};
let client;
try {
  client = await createRoostNativeClient(options);
  await client.ready;
  const stream = client.stream('bundled-owner');
  const content = '{"text":"bundled Lody Roost history"}';
  const id = (await stream.create([], content)).updates[0].turnId;
  await stream.seal(id, 1n);
  await client.close();
  assert.deepEqual(await client.exited, { code: 0, signal: null });
  client = await createRoostNativeClient(options);
  await client.ready;
  const read = await client.stream('bundled-owner').readTurn(id);
  assert.equal(read.kind, 'found');
  assert.equal(read.turn.contentJson, content);
  assert.equal(read.turn.hashVerified, true);
  assert.equal(read.turn.nextSeq, 2n);
  console.log('bundled-owner-reopened');
} finally {
  await client?.close();
}
`,
          resolveDir: fileURLToPath(new URL('../', import.meta.url)),
          loader: 'ts',
        },
        outfile: entry,
        bundle: true,
        platform: 'node',
        format: 'esm',
        target: 'node22',
      });
      const { stdout } = await promisify(execFile)(process.execPath, [entry], { timeout: 30_000 });
      expect(stdout.trim()).toBe('bundled-owner-reopened');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('projects physical successor segments into one logical Lody turn', async () => {
    const [{ RoostNativeClient }, { NodeLodyHistory }] = await Promise.all([
      import('@loro-dev/roost-node'),
      import('@loro-dev/roost/lody-history'),
    ]);
    const directory = await mkdtemp(join(tmpdir(), 'lody-roost-local-'));
    const seed = new Uint8Array(32).fill(7);
    const identity = Identity.fromSeed(seed);
    const client = new RoostNativeClient({
      dbPath: join(directory, 'history.db'),
      seed,
      allowedOwners: [identity.owner()],
      clockMs: 1_700_000_000_000n,
      maxQueuedRequests: 16,
      maxQueuedBytes: 8 * 1024 * 1024,
    });

    try {
      await client.ready;
      const history = new NodeLodyHistory(client.stream('lody-adapter'), identity.owner());
      const accept = (businessId: string, segmentId: string, content: unknown) =>
        history.accept({
          kind: 'message' as const,
          businessId,
          segmentId,
          parents: [],
          content: fromApplicationJson(content),
        });

      await accept('user-1', '0', {
        role: 'user',
        timestamp: '2026-10-03T00:00:00.000Z',
        items: [{ type: 'text', text: 'hello' }],
      });
      await accept('assistant-1', 'primary', {
        role: 'assistant',
        timestamp: '2026-10-03T00:00:01.000Z',
        userTurnId: 'user-1',
        items: [{ type: 'text', text: 'first' }],
        finished: false,
      });
      await accept('assistant-1', 'late-output', {
        items: [{ type: 'text', text: 'late' }],
        finished: true,
      });

      const physical = await history.readProjectedMessages();
      const reader = createRoostHistoryReader(
        createRoostReadPort(history, () => ({
          initial: history.readProjectedMessages(),
          unsubscribe: () => {},
        }))
      );
      const logical = await reader.readAll();

      expect(physical).toHaveLength(3);
      expect(logical).toHaveLength(2);
      expect(logical[1]).toMatchObject({
        id: 'assistant-1',
        role: 'assistant',
        finished: true,
      });
      expect(logical[1]?.items).toEqual([
        { type: 'text', text: 'first' },
        { type: 'text', text: 'late' },
      ]);
    } finally {
      await client.close();
      await rm(directory, { recursive: true, force: true });
    }
  }, 30000);
});
