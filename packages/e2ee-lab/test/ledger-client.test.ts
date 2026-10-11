import { writeFileSync } from 'node:fs';
import { runOwnedChild } from './native-child';
import Database from 'better-sqlite3';
import { join } from 'node:path';
import { Effect, Result } from 'effect';
import { StreamsClient } from '@loro-dev/streams-client';
import { frameLedgerRecord } from '@lody/e2ee-core/ledger/feed';
import { describe, expect, it } from 'vitest';
import { makeLabLedgerClient } from '../src/platform/ledger-client';
import { fixture, options } from './ledger-fixture';
const ok = Result.getOrThrow;
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
      const stdout = await Effect.runPromise(
        runOwnedChild(['--import', 'tsx', 'test/ledger-reopen.mts', config])
      );
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
  it('collects complete record pages before one durable commit and keeps the initial cursor on a later-page failure', async () => {
    const f = await fixture();
    try {
      const actual = await f.sdk.read({ offset: '-1' });
      if (!actual.ok) throw new Error('real Riverrun history unavailable');
      const firstSize = 4 + f.genesis.length;
      for (const failSecond of [false, true]) {
        const stream = {
          read: async (request: { offset: string; signal: AbortSignal }) => {
            if (request.offset === '-1')
              return {
                ok: true as const,
                result: {
                  ...actual.result,
                  requestOffset: request.offset,
                  nextOffset: 'fixture/partial',
                  upToDate: false,
                  payload: {
                    ...actual.result.payload,
                    body: actual.result.payload.body.slice(0, firstSize),
                  },
                },
              };
            if (failSecond) return { ok: false as const, result: 'injected later-page disruption' };
            return {
              ok: true as const,
              result: {
                ...actual.result,
                requestOffset: request.offset,
                payload: {
                  ...actual.result.payload,
                  body: actual.result.payload.body.slice(firstSize),
                },
              },
            };
          },
        };
        await Effect.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              const client = yield* makeLabLedgerClient({
                ...options(f, 'create'),
                path: join(f.dir, failSecond ? 'failed-page.sqlite' : 'complete-page.sqlite'),
                stream,
              });
              const outcome = yield* Effect.result(client.read(f.checkpoint));
              const current = yield* client.current();
              if (failSecond) {
                expect(Result.isFailure(outcome)).toBe(true);
                expect(current.offset).toBe('-1');
                expect(current.view.length).toBe(1);
              } else {
                expect(Result.isSuccess(outcome)).toBe(true);
                expect(current.offset).toBe(actual.result.nextOffset);
                expect(current.view.head.equals(f.view.head)).toBe(true);
              }
            })
          )
        );
      }
    } finally {
      await f.close();
    }
  });
  it('applies finite read budgets per invocation rather than as a lifetime limit', async () => {
    const f = await fixture();
    try {
      const actual = await f.sdk.read({ offset: '-1' });
      if (!actual.ok) throw new Error('real Riverrun history unavailable');
      // Explicit mock transport boundary after one real SDK response. Real signed
      // history, verifier and SQLite remain; no elapsed-time or scheduler assumption.
      const stream = {
        read: async (request: { offset: string; signal: AbortSignal }) => ({
          ok: true as const,
          result: {
            ...actual.result,
            requestOffset: request.offset,
            payload: {
              ...actual.result.payload,
              body: request.offset === '-1' ? actual.result.payload.body : new Uint8Array(0),
            },
          },
        }),
      };
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const client = yield* makeLabLedgerClient({ ...options(f, 'create'), stream });
            for (let index = 0; index < 4097; index++) yield* client.read(f.checkpoint);
            const current = yield* client.current();
            expect(current.offset).toBe(actual.result.nextOffset);
            expect(current.view.head.equals(f.view.head)).toBe(true);
          })
        )
      );
    } finally {
      await f.close();
    }
  });
});
