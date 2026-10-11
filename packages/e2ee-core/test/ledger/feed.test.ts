import { Effect, Result, Fiber, Exit, Scope } from 'effect';
import { makeLedgerStreamReader } from '@lody/e2ee-core/ledger/feed';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { makeSqliteLedgerFeed } from '@lody/e2ee-core/ledger/feed/sqlite';
import { describe, expect, it } from 'vitest';
import { verifyLedger, hashRecordBytes } from '@lody/e2ee-core/ledger';
import { envelopeFixture } from '../keys/fixture';
import { prepareLedgerPage, frameLedgerRecord } from '@lody/e2ee-core/ledger/feed';
const ok = Result.getOrThrow;
describe('verified ledger increments without known-record skipping', () => {
  it('binds the initial exact genesis once, then extends only an authenticated suffix', () => {
    const f = envelopeFixture(),
      genesis = ok(
        verifyLedger({
          anchor: f.context.genesis,
          records: [f.genesisRecord],
          checkpoint: { head: hashRecordBytes(f.genesisRecord), length: 1 },
        })
      );
    const initial = { view: genesis, offset: '-1', bootstrap: true };
    const bound = ok(
      prepareLedgerPage(
        initial,
        {
          requestOffset: '-1',
          nextOffset: 'opaque/genesis',
          records: [f.genesisRecord],
          upToDate: false,
        },
        { head: genesis.head, length: 1 }
      )
    );
    expect(bound.offset).toBe('opaque/genesis');
    expect(bound.bootstrap).toBe(false);
    const expected = f.view();
    const next = ok(
      prepareLedgerPage(
        bound,
        {
          requestOffset: bound.offset,
          nextOffset: 'opaque/device',
          records: f.records().slice(1),
          upToDate: true,
        },
        { head: expected.head, length: expected.length }
      )
    );
    expect(next.view.head.equals(expected.head)).toBe(true);
    expect(next.view.inspectState().devices.size).toBe(2);
    expect(initial.offset).toBe('-1');
    expect(initial.view.length).toBe(1);
  });
  it('rejects a committed record appended at a new position and keeps the prior view/offset', () => {
    const f = envelopeFixture(),
      view = f.view(),
      state = { view, offset: 'opaque/2', bootstrap: false };
    const before = view.inspectState();
    const result = prepareLedgerPage(
      state,
      {
        requestOffset: state.offset,
        nextOffset: 'opaque/3',
        records: [f.records()[1]!],
        upToDate: true,
      },
      { head: view.head, length: view.length }
    );
    expect(Result.isFailure(result)).toBe(true);
    expect(state.offset).toBe('opaque/2');
    expect(view.inspectState()).toEqual(before);
  });
  it('rejects an older page and empty offset rewinds without relying on numeric ordering of opaque offsets', () => {
    const f = envelopeFixture(),
      view = f.view(),
      state = { view, offset: 'opaque/current', bootstrap: false },
      expected = { head: view.head, length: view.length };
    expect(
      Result.isFailure(
        prepareLedgerPage(
          state,
          {
            requestOffset: state.offset,
            nextOffset: 'opaque/old',
            records: [f.genesisRecord],
            upToDate: true,
          },
          expected
        )
      )
    ).toBe(true);
    expect(
      Result.isFailure(
        prepareLedgerPage(
          state,
          { requestOffset: state.offset, nextOffset: 'opaque/old', records: [], upToDate: true },
          expected
        )
      )
    ).toBe(true);
    const idle = ok(
      prepareLedgerPage(
        state,
        { requestOffset: state.offset, nextOffset: state.offset, records: [], upToDate: true },
        expected
      )
    );
    expect(idle.view).toBe(view);
    expect(idle.offset).toBe(state.offset);
  });
  it('requires the independently supplied exact endpoint and refuses unauthenticated shape or bootstrap retargeting', () => {
    const f = envelopeFixture(),
      view = f.view(),
      state = { view, offset: 'opaque/current', bootstrap: false };
    f.append([5, f.phone.raw]);
    const records = f.records().slice(-1),
      after = f.view();
    expect(
      Result.isFailure(
        prepareLedgerPage(
          state,
          { requestOffset: state.offset, nextOffset: 'opaque/next', records, upToDate: true },
          { head: view.head, length: after.length }
        )
      )
    ).toBe(true);
    const next = ok(
      prepareLedgerPage(
        state,
        { requestOffset: state.offset, nextOffset: 'opaque/next', records, upToDate: true },
        { head: after.head, length: after.length }
      )
    );
    expect(next.view.inspectState().devices.has(Buffer.from(f.phone.raw).toString('hex'))).toBe(
      false
    );
    expect(
      Result.isFailure(
        prepareLedgerPage(
          { ...state, bootstrap: true },
          {
            requestOffset: state.offset,
            nextOffset: 'opaque/next',
            records: f.records(),
            upToDate: true,
          },
          { head: after.head, length: after.length }
        )
      )
    ).toBe(true);
  });
  it('preserves the original u32be length framing and rejects empty/oversized records', () => {
    const f = envelopeFixture(),
      framed = ok(frameLedgerRecord(f.genesisRecord));
    expect(new DataView(framed.buffer).getUint32(0, false)).toBe(f.genesisRecord.length);
    expect(framed.subarray(4)).toEqual(f.genesisRecord);
    expect(Result.isFailure(frameLedgerRecord(new Uint8Array(0)))).toBe(true);
    expect(Result.isFailure(frameLedgerRecord(new Uint8Array(8193)))).toBe(true);
  });
});

describe('durable full-history feed boundary', () => {
  it('atomically persists verified history/opaque position and rejects duplicate or rollback pages after reopening', async () => {
    const f = envelopeFixture(),
      dir = mkdtempSync(path.join(tmpdir(), 'ledger-feed-')),
      file = path.join(dir, 'feed.sqlite');
    const genesisHead = hashRecordBytes(f.genesisRecord),
      expected = { head: f.view().head, length: f.view().length };
    const config = {
      path: file,
      genesis: f.context.genesis,
      genesisRecord: f.genesisRecord,
      budget: { maxRecords: 100, maxBytes: 100000 },
    };
    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const feed = yield* makeSqliteLedgerFeed({
              ...config,
              mode: 'create',
              expected: { head: genesisHead, length: 1 },
            });
            const state = yield* feed.accept(
              { requestOffset: '-1', nextOffset: 'opaque/2', records: f.records(), upToDate: true },
              expected
            );
            expect(state.offset).toBe('opaque/2');
            expect(state.view.length).toBe(2);
          })
        )
      );
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const feed = yield* makeSqliteLedgerFeed({ ...config, mode: 'open', expected });
            for (const records of [[f.records()[1]!], [f.genesisRecord], []]) {
              expect(
                Result.isFailure(
                  yield* Effect.result(
                    feed.accept(
                      {
                        requestOffset: 'opaque/2',
                        nextOffset: 'opaque/stale',
                        records,
                        upToDate: true,
                      },
                      expected
                    )
                  )
                )
              ).toBe(true);
              expect((yield* feed.current()).offset).toBe('opaque/2');
              const disk = new Database(file);
              try {
                expect(disk.prepare('SELECT offset,count FROM ledger_feed_meta').get()).toEqual({
                  offset: 'opaque/2',
                  count: 2,
                });
                expect(disk.prepare('SELECT COUNT(*) AS n FROM ledger_feed_records').get()).toEqual(
                  { n: 2 }
                );
              } finally {
                disk.close();
              }
            }
          })
        )
      );
      expect(
        Result.isFailure(
          await Effect.runPromise(
            Effect.scoped(
              Effect.result(
                makeSqliteLedgerFeed({
                  ...config,
                  mode: 'open',
                  expected: { head: genesisHead, length: 1 },
                })
              )
            )
          )
        )
      ).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('retains committed history at a local budget and rejects a stale competing handle or closed Scope', async () => {
    const f = envelopeFixture(),
      dir = mkdtempSync(path.join(tmpdir(), 'ledger-feed-')),
      file = path.join(dir, 'feed.sqlite');
    const expected = { head: hashRecordBytes(f.genesisRecord), length: 1 },
      endpoint = { head: f.view().head, length: f.view().length };
    const config = {
      path: file,
      genesis: f.context.genesis,
      genesisRecord: f.genesisRecord,
      expected,
      budget: { maxRecords: 2, maxBytes: 100000 },
    };
    const page = {
      requestOffset: '-1',
      nextOffset: 'opaque/2',
      records: f.records(),
      upToDate: true,
    };
    try {
      const closed = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const first = yield* makeSqliteLedgerFeed({ ...config, mode: 'create' });
            const competing = yield* makeSqliteLedgerFeed({ ...config, mode: 'open' });
            yield* first.accept(page, endpoint);
            expect(Result.isFailure(yield* Effect.result(competing.accept(page, endpoint)))).toBe(
              true
            );
            f.append([5, f.phone.raw]);
            const after = f.view();
            expect(
              Result.isFailure(
                yield* Effect.result(
                  first.accept(
                    {
                      requestOffset: 'opaque/2',
                      nextOffset: 'opaque/3',
                      records: f.records().slice(-1),
                      upToDate: true,
                    },
                    { head: after.head, length: after.length }
                  )
                )
              )
            ).toBe(true);
            const retained = yield* first.current();
            expect(retained.offset).toBe('opaque/2');
            expect(retained.view.length).toBe(2);
            const disk = new Database(file);
            try {
              expect(disk.prepare('SELECT COUNT(*) AS n FROM ledger_feed_records').get()).toEqual({
                n: 2,
              });
            } finally {
              disk.close();
            }
            return first;
          })
        )
      );
      expect(Result.isFailure(await Effect.runPromise(Effect.result(closed.current())))).toBe(true);
      expect(
        Result.isFailure(await Effect.runPromise(Effect.result(closed.accept(page, endpoint))))
      ).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it.each(['IGNORE', 'TAMPER'] as const)(
    'does not commit a cursor when actual record insertion is %s',
    async (fault) => {
      const f = envelopeFixture(),
        dir = mkdtempSync(path.join(tmpdir(), 'ledger-record-')),
        file = path.join(dir, 'feed.sqlite');
      try {
        await Effect.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              const feed = yield* makeSqliteLedgerFeed({
                path: file,
                mode: 'create',
                genesis: f.context.genesis,
                genesisRecord: f.genesisRecord,
                expected: { head: hashRecordBytes(f.genesisRecord), length: 1 },
                budget: { maxRecords: 100, maxBytes: 100000 },
              });
              const disk = new Database(file);
              try {
                disk.exec(
                  fault === 'IGNORE'
                    ? 'CREATE TRIGGER corrupt_record BEFORE INSERT ON ledger_feed_records BEGIN SELECT RAISE(IGNORE); END;'
                    : "CREATE TRIGGER corrupt_record AFTER INSERT ON ledger_feed_records BEGIN UPDATE ledger_feed_records SET record=x'00' WHERE position=NEW.position; END;"
                );
              } finally {
                disk.close();
              }
              const endpoint = { head: f.view().head, length: f.view().length };
              expect(
                Result.isFailure(
                  yield* Effect.result(
                    feed.accept(
                      {
                        requestOffset: '-1',
                        nextOffset: 'opaque/2',
                        records: f.records(),
                        upToDate: true,
                      },
                      endpoint
                    )
                  )
                )
              ).toBe(true);
              expect((yield* feed.current()).offset).toBe('-1');
              const check = new Database(file);
              try {
                expect(
                  check.prepare('SELECT COUNT(*) AS n FROM ledger_feed_records').get()
                ).toEqual({ n: 1 });
                expect(check.prepare('SELECT offset,count FROM ledger_feed_meta').get()).toEqual({
                  offset: '-1',
                  count: 1,
                });
              } finally {
                check.close();
              }
            })
          )
        );
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  );
  it.each(['later-overwrite', 'meta-overwrite', 'existing-overwrite'] as const)(
    'verifies the complete retained originals after the last write: %s',
    async (fault) => {
      const f = envelopeFixture(),
        dir = mkdtempSync(path.join(tmpdir(), 'ledger-final-')),
        file = path.join(dir, 'feed.sqlite');
      f.append([5, f.phone.raw]);
      const endpoint = { head: f.view().head, length: f.view().length };
      try {
        await Effect.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              const feed = yield* makeSqliteLedgerFeed({
                path: file,
                mode: 'create',
                genesis: f.context.genesis,
                genesisRecord: f.genesisRecord,
                expected: { head: hashRecordBytes(f.genesisRecord), length: 1 },
                budget: { maxRecords: 100, maxBytes: 100000 },
              });
              const initial = yield* feed.current(),
                disk = new Database(file);
              try {
                disk.exec(
                  fault === 'later-overwrite'
                    ? 'CREATE TRIGGER final_fault AFTER INSERT ON ledger_feed_records WHEN NEW.position=3 BEGIN UPDATE ledger_feed_records SET record=zeroblob(length(record)) WHERE position=2; END;'
                    : fault === 'meta-overwrite'
                      ? 'CREATE TRIGGER final_fault AFTER UPDATE ON ledger_feed_meta BEGIN UPDATE ledger_feed_records SET record=zeroblob(length(record)) WHERE position=2; END;'
                      : 'CREATE TRIGGER final_fault AFTER INSERT ON ledger_feed_records BEGIN UPDATE ledger_feed_records SET record=zeroblob(length(record)) WHERE position=1; END;'
                );
              } finally {
                disk.close();
              }
              const page = {
                requestOffset: '-1',
                nextOffset: 'opaque/3',
                records: f.records(),
                upToDate: true,
              };
              expect(Result.isFailure(yield* Effect.result(feed.accept(page, endpoint)))).toBe(
                true
              );
              const retained = yield* feed.current();
              expect(retained.view).toBe(initial.view);
              expect(retained.offset).toBe('-1');
              const check = new Database(file);
              try {
                expect(
                  check.prepare('SELECT COUNT(*) AS n FROM ledger_feed_records').get()
                ).toEqual({ n: 1 });
                expect(
                  new Uint8Array(
                    (
                      check
                        .prepare('SELECT record FROM ledger_feed_records WHERE position=1')
                        .get() as { record: Uint8Array }
                    ).record
                  )
                ).toEqual(f.genesisRecord);
                expect(check.prepare('SELECT offset,count FROM ledger_feed_meta').get()).toEqual({
                  offset: '-1',
                  count: 1,
                });
                check.exec('DROP TRIGGER final_fault');
              } finally {
                check.close();
              }
              expect((yield* feed.accept(page, endpoint)).offset).toBe('opaque/3');
            })
          )
        );
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  );
  it.each(['ABORT', 'IGNORE'] as const)(
    'rolls back actual appended records and position when metadata write is %s',
    async (failure) => {
      const f = envelopeFixture(),
        dir = mkdtempSync(path.join(tmpdir(), 'ledger-feed-')),
        file = path.join(dir, 'feed.sqlite');
      const expected = { head: hashRecordBytes(f.genesisRecord), length: 1 };
      try {
        await Effect.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              const feed = yield* makeSqliteLedgerFeed({
                path: file,
                mode: 'create',
                genesis: f.context.genesis,
                genesisRecord: f.genesisRecord,
                expected,
                budget: { maxRecords: 100, maxBytes: 100000 },
              });
              const disk = new Database(file);
              try {
                disk.exec(
                  `CREATE TRIGGER fail_feed BEFORE UPDATE ON ledger_feed_meta BEGIN SELECT RAISE(${failure}${failure === 'ABORT' ? ", 'synthetic storage fault'" : ''}); END;`
                );
              } finally {
                disk.close();
              }
              const endpoint = { head: f.view().head, length: f.view().length };
              expect(
                Result.isFailure(
                  yield* Effect.result(
                    feed.accept(
                      {
                        requestOffset: '-1',
                        nextOffset: 'opaque/2',
                        records: f.records(),
                        upToDate: true,
                      },
                      endpoint
                    )
                  )
                )
              ).toBe(true);
              expect((yield* feed.current()).offset).toBe('-1');
              const check = new Database(file);
              try {
                expect(
                  check.prepare('SELECT COUNT(*) AS n FROM ledger_feed_records').get()
                ).toEqual({ n: 1 });
                expect(check.prepare('SELECT offset,count FROM ledger_feed_meta').get()).toEqual({
                  offset: '-1',
                  count: 1,
                });
                check.exec('DROP TRIGGER fail_feed');
              } finally {
                check.close();
              }
              expect(
                (yield* feed.accept(
                  {
                    requestOffset: '-1',
                    nextOffset: 'opaque/2',
                    records: f.records(),
                    upToDate: true,
                  },
                  endpoint
                )).offset
              ).toBe('opaque/2');
            })
          )
        );
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  );
});

describe('finite framed ledger reader and borrowed request settlement', () => {
  it('joins partial frames without inventing cursor progress and rejects truncated or duplicate positions', async () => {
    const f = envelopeFixture(),
      frame = ok(frameLedgerRecord(f.genesisRecord));
    let index = 0;
    const page = (offset: string, next: string, body: Uint8Array, upToDate: boolean) => ({
      ok: true as const,
      result: {
        requestOffset: offset,
        nextOffset: next,
        upToDate,
        payload: { contentType: 'application/octet-stream', body },
      },
    });
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const reader = yield* makeLedgerStreamReader({
            read: async ({ offset }) => {
              index++;
              return index === 1
                ? page(offset, 'opaque/partial', frame.slice(0, 7), false)
                : page(offset, 'opaque/full', frame.slice(7), true);
            },
          });
          const read = yield* reader.readAfter('-1');
          expect(read.records).toEqual([f.genesisRecord]);
          expect(read.requestOffset).toBe('-1');
          expect(read.nextOffset).toBe('opaque/full');
        })
      )
    );
    for (const response of [
      page('-1', 'opaque/end', frame.slice(0, -1), true),
      page('-1', '-1', frame, true),
      page('-1', 'opaque/end', new Uint8Array([0, 0, 32, 1]), true),
    ]) {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const reader = yield* makeLedgerStreamReader({ read: async () => response });
            expect(Result.isFailure(yield* Effect.result(reader.readAfter('-1')))).toBe(true);
          })
        )
      );
    }
  });
  it('aborts then awaits a real outstanding borrowed promise before interruption completes, without exposing a late page', async () => {
    const latch = () => {
      let resolve!: () => void;
      const promise = new Promise<void>((done) => {
        resolve = done;
      });
      return { resolve, promise };
    };
    const entered = latch(),
      aborted = latch(),
      release = latch();
    const f = envelopeFixture(),
      frame = ok(frameLedgerRecord(f.genesisRecord));
    let settled = false;
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const reader = yield* makeLedgerStreamReader({
            read: async ({ offset, signal }) => {
              signal.addEventListener('abort', () => aborted.resolve(), { once: true });
              entered.resolve();
              await release.promise;
              settled = true;
              return {
                ok: true as const,
                result: {
                  requestOffset: offset,
                  nextOffset: 'opaque/late',
                  upToDate: true,
                  payload: { contentType: 'application/octet-stream', body: frame },
                },
              };
            },
          });
          const worker = yield* Effect.forkChild(reader.readAfter('-1'));
          yield* Effect.promise(() => entered.promise);
          const interrupt = yield* Effect.forkChild(Fiber.interrupt(worker));
          yield* Effect.promise(() => aborted.promise);
          const prematureSettlement = settled,
            prematureExit = interrupt.pollUnsafe();
          release.resolve();
          yield* Fiber.join(interrupt);
          expect(prematureSettlement).toBe(false);
          expect(prematureExit).toBeUndefined();
          expect(settled).toBe(true);
          expect(Exit.isFailure(yield* Fiber.await(worker))).toBe(true);
        })
      )
    );
  });
});

it('closes the reader Scope only after the borrowed raw request settles and rejects its late page', async () => {
  const latch = () => {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
      resolve = done;
    });
    return { resolve, promise };
  };
  const entered = latch(),
    aborted = latch(),
    release = latch(),
    f = envelopeFixture(),
    frame = ok(frameLedgerRecord(f.genesisRecord));
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const scope = yield* Scope.make();
        const reader = yield* makeLedgerStreamReader({
          read: async ({ offset, signal }) => {
            signal.addEventListener('abort', () => aborted.resolve(), { once: true });
            entered.resolve();
            await release.promise;
            return {
              ok: true as const,
              result: {
                requestOffset: offset,
                nextOffset: 'opaque/late',
                upToDate: true,
                payload: { contentType: 'application/octet-stream', body: frame },
              },
            };
          },
        }).pipe(Effect.provideService(Scope.Scope, scope));
        const worker = yield* Effect.forkChild(Effect.result(reader.readAfter('-1')));
        yield* Effect.promise(() => entered.promise);
        const closing = yield* Effect.forkChild(Scope.close(scope, Exit.void));
        yield* Effect.promise(() => aborted.promise);
        const prematureExit = closing.pollUnsafe();
        release.resolve();
        yield* Fiber.join(closing);
        expect(prematureExit).toBeUndefined();
        expect(Result.isFailure(yield* Fiber.join(worker))).toBe(true);
        expect(Result.isFailure(yield* Effect.result(reader.readAfter('-1')))).toBe(true);
      })
    )
  );
});
