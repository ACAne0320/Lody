import Database from 'better-sqlite3';
import { closeSync, openSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { Effect, Result } from 'effect';
import * as Bytes from '../bytes';
import { bytesEqual } from '../cbor';
import { verifyLedger, hashRecordBytes, type LedgerCheckpoint } from './index';
import {
  LedgerFeedError,
  prepareLedgerPage,
  validLedgerOffset,
  type LedgerReadPage,
  type LedgerFeedState,
} from './feed-page';
const APP = 0x4c454632;
const fail = (code: LedgerFeedError['code']) => new LedgerFeedError({ code });
const sql = <A>(work: () => A) =>
  Effect.try({
    try: work,
    catch: (error) => (error instanceof LedgerFeedError ? error : fail('storage')),
  });
/** Local full-history feed. Caller supplies a separately trusted endpoint on reopen,
 * and each accepted page. No URL/server cursor provides checkpoint authority. */
export function makeSqliteLedgerFeed(input: {
  readonly path: string;
  readonly mode: 'create' | 'open';
  readonly genesis: Bytes.GenesisHash;
  readonly genesisRecord: Uint8Array;
  readonly expected: LedgerCheckpoint;
  readonly budget: { readonly maxRecords: number; readonly maxBytes: number };
}) {
  return Effect.gen(function* () {
    const { path, mode } = input,
      budget = { ...input.budget };
    const anchor = yield* Effect.fromResult(Bytes.genesisHash(input.genesis.toBytes()));
    if (
      !(input.genesisRecord instanceof Uint8Array) ||
      input.genesisRecord.length < 1 ||
      input.genesisRecord.length > 8192
    )
      return yield* fail('invalid-frame');
    const genesisRecord = new Uint8Array(input.genesisRecord);
    const expected = {
      head: yield* Effect.fromResult(Bytes.recordHash(input.expected.head.toBytes())),
      length: input.expected.length,
    };
    if (
      typeof path !== 'string' ||
      !isAbsolute(path) ||
      (mode !== 'create' && mode !== 'open') ||
      !Number.isSafeInteger(budget.maxRecords) ||
      budget.maxRecords < 1 ||
      budget.maxRecords > 1_000_000 ||
      !Number.isSafeInteger(budget.maxBytes) ||
      budget.maxBytes < 1 ||
      budget.maxBytes > 64 * 1024 * 1024
    )
      return yield* fail('invalid-frame');
    if (genesisRecord.length > budget.maxBytes) return yield* fail('read-too-large');
    const genesis = yield* Effect.fromResult(
      verifyLedger({
        anchor,
        records: [genesisRecord],
        checkpoint: { head: hashRecordBytes(genesisRecord), length: 1 },
      })
    );
    if (mode === 'create' && (!expected.head.equals(genesis.head) || expected.length !== 1))
      return yield* fail('wrong-parent');
    if (mode === 'create') yield* sql(() => closeSync(openSync(path, 'wx', 0o600)));
    const db = yield* Effect.acquireRelease(
      sql(() => new Database(path, { fileMustExist: true, timeout: 1000 })),
      (handle) => sql(() => handle.close()).pipe(Effect.orDie)
    );
    let closed = false;
    const guard = () => {
      if (closed) throw fail('closed');
    };
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        closed = true;
      })
    );
    const initial = yield* sql(() => {
      const app = db.pragma('application_id', { simple: true }),
        version = db.pragma('user_version', { simple: true });
      if (mode === 'open' && (app !== APP || version !== 1)) throw fail('corrupt');
      if (
        mode === 'create' &&
        (app !== 0 ||
          version !== 0 ||
          db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().length !== 0)
      )
        throw fail('corrupt');
      if (mode === 'open') {
        const row = db.prepare('SELECT genesis FROM ledger_feed_meta WHERE id=1').get() as
          | { genesis: unknown }
          | undefined;
        if (
          !(row?.genesis instanceof Uint8Array) ||
          !anchor.equals(Result.getOrThrow(Bytes.genesisHash(row.genesis)))
        )
          throw fail('corrupt');
      }
      db.pragma('journal_mode=WAL');
      db.pragma('synchronous=FULL');
      if (mode === 'create')
        db.transaction(() => {
          db.exec(`CREATE TABLE ledger_feed_meta(id INTEGER PRIMARY KEY CHECK(id=1),genesis BLOB NOT NULL CHECK(length(genesis)=32),head BLOB NOT NULL CHECK(length(head)=32),count INTEGER NOT NULL,offset TEXT NOT NULL,bootstrap INTEGER NOT NULL CHECK(bootstrap IN (0,1)),bytes INTEGER NOT NULL);
    CREATE TABLE ledger_feed_records(position INTEGER PRIMARY KEY,record BLOB NOT NULL CHECK(length(record) BETWEEN 1 AND 8192));PRAGMA application_id=${APP};PRAGMA user_version=1;`);
          db.prepare('INSERT INTO ledger_feed_records VALUES(1,?)').run(genesisRecord);
          db.prepare('INSERT INTO ledger_feed_meta VALUES(1,?,?,1,?,1,?)').run(
            anchor.toBytes(),
            genesis.head.toBytes(),
            '-1',
            genesisRecord.length
          );
        }).immediate();
      return db
        .transaction(() => {
          const meta = db
            .prepare('SELECT head,count,offset,bootstrap,bytes FROM ledger_feed_meta WHERE id=1')
            .get() as
            | { head: unknown; count: unknown; offset: unknown; bootstrap: unknown; bytes: unknown }
            | undefined;
          if (
            !meta ||
            !(meta.head instanceof Uint8Array) ||
            !Number.isSafeInteger(meta.count) ||
            typeof meta.count !== 'number' ||
            meta.count < 1 ||
            meta.count > budget.maxRecords ||
            !validLedgerOffset(meta.offset) ||
            (meta.bootstrap !== 0 && meta.bootstrap !== 1) ||
            typeof meta.bytes !== 'number' ||
            !Number.isSafeInteger(meta.bytes) ||
            meta.bytes < 1 ||
            meta.bytes > budget.maxBytes
          )
            throw fail('corrupt');
          const aggregate = db
            .prepare(
              'SELECT COUNT(*) AS count,COALESCE(SUM(length(record)),0) AS bytes,MIN(length(record)) AS min,MAX(length(record)) AS max FROM ledger_feed_records'
            )
            .get() as { count: number; bytes: number; min: number; max: number };
          if (
            aggregate.count !== meta.count ||
            aggregate.bytes !== meta.bytes ||
            aggregate.count > budget.maxRecords ||
            aggregate.bytes > budget.maxBytes ||
            aggregate.min < 1 ||
            aggregate.max > 8192
          )
            throw fail('corrupt');
          const rows = db
            .prepare('SELECT position,record FROM ledger_feed_records ORDER BY position LIMIT ?')
            .all(budget.maxRecords) as { position: number; record: unknown }[];
          let size = 0;
          const records: Uint8Array[] = [];
          for (const row of rows) {
            if (
              row.position !== records.length + 1 ||
              !(row.record instanceof Uint8Array) ||
              row.record.length < 1
            )
              throw fail('corrupt');
            size += row.record.length;
            if (size > budget.maxBytes) throw fail('read-too-large');
            records.push(new Uint8Array(row.record));
          }
          if (records.length !== meta.count || size !== meta.bytes) throw fail('corrupt');
          if (
            !expected.head.equals(Result.getOrThrow(Bytes.recordHash(meta.head))) ||
            expected.length !== meta.count
          )
            throw fail('wrong-parent');
          const replayed = verifyLedger({ anchor, records, checkpoint: expected });
          if (Result.isFailure(replayed)) throw fail('wrong-parent');
          const view = replayed.success;
          if (meta.bootstrap === 1 && (meta.offset !== '-1' || view.length !== 1))
            throw fail('corrupt');
          return {
            state: {
              view,
              offset: meta.offset,
              bootstrap: meta.bootstrap === 1,
            } satisfies LedgerFeedState,
            bytes: size,
            records,
          };
        })
        .deferred();
    });
    let state = initial.state,
      totalBytes = initial.bytes,
      originals = initial.records;
    const matches = () => {
      guard();
      const row = db
        .prepare('SELECT head,count,offset,bootstrap,bytes FROM ledger_feed_meta WHERE id=1')
        .get() as
        | { head: Uint8Array; count: number; offset: string; bootstrap: number; bytes: number }
        | undefined;
      if (
        !row ||
        !(row.head instanceof Uint8Array) ||
        !state.view.head.equals(Result.getOrThrow(Bytes.recordHash(row.head))) ||
        row.count !== state.view.length ||
        row.offset !== state.offset ||
        row.bootstrap !== Number(state.bootstrap) ||
        row.bytes !== totalBytes
      )
        throw fail('conflict');
    };
    return Object.freeze({
      current: () =>
        sql(() => {
          matches();
          return { ...state };
        }),
      accept: (page: LedgerReadPage, checkpoint: LedgerCheckpoint) =>
        sql(() =>
          db
            .transaction(() => {
              matches();
              const incoming = page.records;
              if (!Array.isArray(incoming) || incoming.length > 4096) throw fail('read-too-large');
              const records: Uint8Array[] = [];
              let pageBytes = 0;
              for (let index = 0; index < incoming.length; index++) {
                const record = incoming[index];
                if (!(record instanceof Uint8Array) || record.length < 1 || record.length > 8192)
                  throw fail('invalid-frame');
                pageBytes += record.length;
                if (pageBytes > 16 * 1024 * 1024) throw fail('read-too-large');
                records.push(new Uint8Array(record));
              }
              const copied = {
                requestOffset: page.requestOffset,
                nextOffset: page.nextOffset,
                upToDate: page.upToDate,
                records,
              };
              const prepared = prepareLedgerPage(state, copied, checkpoint);
              if (Result.isFailure(prepared)) throw prepared.failure;
              const next = prepared.success;
              const additions = copied.records.slice(state.bootstrap ? 1 : 0);
              const bytes = additions.reduce((size, record) => size + record.length, totalBytes);
              if (next.view.length > budget.maxRecords || bytes > budget.maxBytes)
                throw fail('read-too-large');
              const insert = db.prepare(
                'INSERT INTO ledger_feed_records(position,record) VALUES(?,?)'
              );
              const readOriginal = db.prepare(
                'SELECT CASE WHEN length(record) BETWEEN 1 AND 8192 THEN record ELSE NULL END AS record FROM ledger_feed_records WHERE position=?'
              );
              additions.forEach((record, index) => {
                const position = state.view.length + index + 1;
                if (insert.run(position, record).changes !== 1) throw fail('corrupt');
                const saved = readOriginal.get(position) as { record: unknown } | undefined;
                if (!(saved?.record instanceof Uint8Array) || !bytesEqual(saved.record, record))
                  throw fail('corrupt');
              });
              const aggregate = db
                .prepare(
                  'SELECT COUNT(*) AS count,COALESCE(SUM(length(record)),0) AS bytes FROM ledger_feed_records'
                )
                .get() as { count: number; bytes: number };
              if (aggregate.count !== next.view.length || aggregate.bytes !== bytes)
                throw fail('corrupt');
              const changed = db
                .prepare(
                  'UPDATE ledger_feed_meta SET head=?,count=?,offset=?,bootstrap=?,bytes=? WHERE id=1'
                )
                .run(
                  next.view.head.toBytes(),
                  next.view.length,
                  next.offset,
                  Number(next.bootstrap),
                  bytes
                );
              const stored = db
                .prepare(
                  'SELECT head,count,offset,bootstrap,bytes FROM ledger_feed_meta WHERE id=1'
                )
                .get() as
                | {
                    head: Uint8Array;
                    count: number;
                    offset: string;
                    bootstrap: number;
                    bytes: number;
                  }
                | undefined;
              if (
                !stored ||
                !(stored.head instanceof Uint8Array) ||
                !next.view.head.equals(Result.getOrThrow(Bytes.recordHash(stored.head))) ||
                stored.count !== next.view.length ||
                stored.offset !== next.offset ||
                stored.bootstrap !== Number(next.bootstrap) ||
                stored.bytes !== bytes
              )
                throw fail('corrupt');
              if (changed.changes !== 1) throw fail('corrupt');
              // No DML follows this complete check: later INSERT or metadata triggers
              // may have changed previously checked records without changing their lengths.
              const expectedOriginals = [...originals, ...additions];
              const finalSize = db
                .prepare(
                  'SELECT COUNT(*) AS count,COALESCE(SUM(length(record)),0) AS bytes FROM ledger_feed_records'
                )
                .get() as { count: number; bytes: number };
              if (
                finalSize.count !== expectedOriginals.length ||
                finalSize.bytes !== bytes ||
                finalSize.bytes > budget.maxBytes
              )
                throw fail('corrupt');
              const retained = db
                .prepare(
                  'SELECT position,CASE WHEN length(record) BETWEEN 1 AND 8192 THEN record ELSE NULL END AS record FROM ledger_feed_records ORDER BY position LIMIT ?'
                )
                .all(budget.maxRecords) as { position: number; record: unknown }[];
              if (retained.length !== expectedOriginals.length) throw fail('corrupt');
              for (let index = 0; index < retained.length; index++) {
                const row = retained[index]!;
                if (
                  row.position !== index + 1 ||
                  !(row.record instanceof Uint8Array) ||
                  !bytesEqual(row.record, expectedOriginals[index]!)
                )
                  throw fail('corrupt');
              }
              return { next, bytes, originals: expectedOriginals };
            })
            .immediate()
        ).pipe(
          Effect.map(({ next, bytes, originals: retainedOriginals }) => {
            state = next;
            totalBytes = bytes;
            originals = retainedOriginals;
            return { ...state };
          })
        ),
    });
  });
}
