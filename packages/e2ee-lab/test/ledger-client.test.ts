import { createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import Database from 'better-sqlite3';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect, Result } from 'effect';
import { startDevServer } from '@loro-dev/sqlite-riverrun';
import { StreamsClient } from '@loro-dev/streams-client';
import { Bytes, encodeCbor, type CborValue } from '@lody/e2ee-core';
import { hashRecordBytes, verifyLedger } from '@lody/e2ee-core/ledger';
import { frameLedgerRecord } from '@lody/e2ee-core/ledger/feed';
import { describe, expect, it } from 'vitest';
import { makeLabLedgerClient } from '../src/platform/ledger-client';

const ok = Result.getOrThrow;
/** Synthetic account and signing seed, real Ed25519 and public protocol codec. */
function history() {
  const key = createPrivateKey({
    key: Buffer.concat([
      Buffer.from('302e020100300506032b657004220420', 'hex'),
      Buffer.alloc(32, 51),
    ]),
    format: 'der',
    type: 'pkcs8',
  });
  const publicKey = new Uint8Array(
    createPublicKey(key).export({ format: 'der', type: 'spki' }).subarray(-32)
  );
  const signed = (body: readonly CborValue[]) =>
    ok(
      encodeCbor([
        body,
        new Uint8Array(
          sign(null, Buffer.concat([Buffer.from('lody-e2ee/sig/v1\0'), ok(encodeCbor(body))]), key)
        ),
      ])
    );
  const genesis = signed([
    1,
    publicKey,
    new Uint8Array(32).fill(52),
    new Uint8Array(16).fill(53),
    new Uint8Array(32).fill(54),
    new Uint8Array(32).fill(55),
  ]);
  const anchor = ok(Bytes.genesisHash(hashRecordBytes(genesis).toBytes()));
  const rotate = signed([
    hashRecordBytes(genesis).toBytes(),
    publicKey,
    [7, 1, new Uint8Array(32).fill(56), new Uint8Array(72).fill(57)],
  ]);
  const records = [genesis, rotate];
  const checkpoint = { head: hashRecordBytes(rotate), length: 2 };
  const view = ok(verifyLedger({ anchor, records, checkpoint }));
  return { genesis, anchor, rotate, records, checkpoint, view };
}
async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'public-e2ee-lab-ledger-'));
  const server = await startDevServer({
    host: '127.0.0.1',
    port: 0,
    dbPath: join(dir, 'remote.sqlite'),
    protocol: 'http1',
  });
  const f = history();
  try {
    expect((await fetch(`${server.baseUrl}/ds/synthetic`, { method: 'PUT' })).ok).toBe(true);
    const sdk = new StreamsClient({
      url: `${server.baseUrl}/ds/synthetic/control`,
      retry: { maxAttempts: 1 },
    });
    expect((await sdk.create({ contentType: 'application/octet-stream' })).ok).toBe(true);
    for (const record of f.records)
      expect(
        (
          await sdk.append({
            part: { contentType: 'application/octet-stream', body: ok(frameLedgerRecord(record)) },
          })
        ).ok
      ).toBe(true);
    return {
      ...f,
      dir,
      server,
      sdk,
      path: join(dir, 'client.sqlite'),
      close: async () => {
        await server.close();
        rmSync(dir, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}
function options(f: Awaited<ReturnType<typeof fixture>>, mode: 'create' | 'open', stream = f.sdk) {
  return {
    path: f.path,
    mode,
    genesis: f.anchor,
    genesisRecord: f.genesis,
    expected: mode === 'create' ? { head: hashRecordBytes(f.genesis), length: 1 } : f.checkpoint,
    budget: { maxRecords: 100, maxBytes: 1024 * 1024 },
    stream,
  };
}
describe('real Riverrun, released SDK and public ledger feed', () => {
  it('rejects duplicate committed record at a later offset and preserves the durable file after reopen', async () => {
    const f = await fixture();
    try {
      let originalOffset = '';
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const client = yield* makeLabLedgerClient(options(f, 'create'));
            const accepted = yield* client.read(f.checkpoint);
            originalOffset = accepted.offset;
            expect(accepted.view.head.equals(f.view.head)).toBe(true);
            // Malicious transport can append valid old bytes; the client must not skip hashes.
          })
        )
      );
      expect(
        (
          await f.sdk.append({
            part: {
              contentType: 'application/octet-stream',
              body: ok(frameLedgerRecord(f.rotate)),
            },
          })
        ).ok
      ).toBe(true);
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const client = yield* makeLabLedgerClient(options(f, 'open'));
            const result = yield* Effect.result(client.read(f.checkpoint));
            expect(Result.isFailure(result)).toBe(true);
            const unchanged = yield* client.current();
            expect(unchanged.offset).toBe(originalOffset);
            expect(unchanged.view.length).toBe(2);
            expect(unchanged.view.head.equals(f.view.head)).toBe(true);
          })
        )
      );
      const config = join(f.dir, 'synthetic-child.json');
      writeFileSync(
        config,
        JSON.stringify({
          path: f.path,
          url: `${f.server.baseUrl}/ds/synthetic/control`,
          genesis: Buffer.from(f.genesis).toString('hex'),
          anchor: Buffer.from(f.anchor.toBytes()).toString('hex'),
          head: Buffer.from(f.checkpoint.head.toBytes()).toString('hex'),
          length: 2,
          offset: originalOffset,
        }),
        { mode: 0o600 }
      );
      const child = spawn(process.execPath, ['--import', 'tsx', 'test/ledger-reopen.mts', config], {
        cwd: process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '',
        stderr = '';
      child.stdout.on('data', (data) => {
        stdout += data;
      });
      child.stderr.on('data', (data) => {
        stderr += data;
      });
      const code = await new Promise<number | null>((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', resolve);
      });
      expect(code, stderr).toBe(0);
      expect(JSON.parse(stdout)).toEqual({ offset: originalOffset, length: 2, rejected: true });
    } finally {
      await f.close();
    }
  });
  it('rejects a rollback response at the current request position instead of rewinding the saved cursor', async () => {
    const f = await fixture();
    try {
      let originalOffset = '';
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const client = yield* makeLabLedgerClient(options(f, 'create'));
            originalOffset = (yield* client.read(f.checkpoint)).offset;
          })
        )
      );
      const short = new StreamsClient({
        url: `${f.server.baseUrl}/ds/synthetic/old`,
        retry: { maxAttempts: 1 },
      });
      expect((await short.create({ contentType: 'application/octet-stream' })).ok).toBe(true);
      expect(
        (
          await short.append({
            part: {
              contentType: 'application/octet-stream',
              body: ok(frameLedgerRecord(f.genesis)),
            },
          })
        ).ok
      ).toBe(true);
      // Real SDK reads an actual shorter Riverrun stream. The malicious boundary
      // lies only about which stream served the requested offset, as in the old Lab test.
      const stream = {
        read: async (input: { offset: string; signal: AbortSignal }) => {
          const result = await short.read({ offset: '-1', signal: input.signal });
          return result.ok
            ? { ...result, result: { ...result.result, requestOffset: input.offset } }
            : result;
        },
      };
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const client = yield* makeLabLedgerClient({ ...options(f, 'open'), stream });
            expect(Result.isFailure(yield* Effect.result(client.read(f.checkpoint)))).toBe(true);
            const current = yield* client.current();
            expect(current.offset).toBe(originalOffset);
            expect(current.view.head.equals(f.view.head)).toBe(true);
          })
        )
      );
    } finally {
      await f.close();
    }
  });
  it('keeps history and cursor unchanged when the real SQLite metadata update is ignored', async () => {
    const f = await fixture();
    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const client = yield* makeLabLedgerClient(options(f, 'create'));
            const db = new Database(f.path);
            try {
              db.exec(
                'CREATE TRIGGER deny_cursor BEFORE UPDATE ON ledger_feed_meta BEGIN SELECT RAISE(IGNORE); END'
              );
              expect(Result.isFailure(yield* Effect.result(client.read(f.checkpoint)))).toBe(true);
              expect((yield* client.current()).offset).toBe('-1');
              expect(db.prepare('SELECT count,offset FROM ledger_feed_meta').get()).toEqual({
                count: 1,
                offset: '-1',
              });
              expect(db.prepare('SELECT COUNT(*) AS n FROM ledger_feed_records').get()).toEqual({
                n: 1,
              });
              db.exec('DROP TRIGGER deny_cursor');
              expect((yield* client.read(f.checkpoint)).view.length).toBe(2);
            } finally {
              db.close();
            }
          })
        )
      );
    } finally {
      await f.close();
    }
  });
});
