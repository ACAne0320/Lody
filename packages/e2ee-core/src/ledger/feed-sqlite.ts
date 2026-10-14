import Database from 'better-sqlite3';
import { closeSync, openSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { Chunk, Effect, Result } from 'effect';
import * as Bytes from '../bytes';
import { bytesEqual } from '../cbor';
import { verifyLedger, verifyLedgerEffect, hashRecordBytes, type LedgerCheckpoint } from './index';
import {
  LedgerFeedError,
  prepareLedgerPageEffect,
  validLedgerOffset,
  type LedgerReadPage,
  type LedgerFeedState,
} from './feed-page';
const APP = 0x4c454632;
const feedSchema = [
  'CREATE TABLE ledger_feed_meta(id INTEGER PRIMARY KEY CHECK(id=1),genesis BLOB NOT NULL CHECK(length(genesis)=32),head BLOB NOT NULL CHECK(length(head)=32),count INTEGER NOT NULL,offset TEXT NOT NULL,bootstrap INTEGER NOT NULL CHECK(bootstrap IN (0,1)),bytes INTEGER NOT NULL)',
  'CREATE TABLE ledger_feed_records(position INTEGER PRIMARY KEY,record BLOB NOT NULL CHECK(length(record) BETWEEN 1 AND 8192))',
];
type StorageStamp = { schema: number; tempSchema: number; data: number };
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
            .prepare(
              'SELECT genesis,head,count,offset,bootstrap,bytes FROM ledger_feed_meta WHERE id=1'
            )
            .get() as
            | {
                genesis: unknown;
                head: unknown;
                count: unknown;
                offset: unknown;
                bootstrap: unknown;
                bytes: unknown;
              }
            | undefined;
          if (
            !meta ||
            !(meta.genesis instanceof Uint8Array) ||
            !bytesEqual(meta.genesis, anchor.toBytes()) ||
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
          if (meta.bootstrap === 1 && (meta.offset !== '-1' || records.length !== 1))
            throw fail('corrupt');
          return {
            offset: meta.offset,
            bootstrap: meta.bootstrap === 1,
            bytes: size,
            records,
          };
        })
        .deferred();
    });
    // Signature work cooperatively yields outside SQLite's read transaction. Disk
    // bytes are still untrusted: publish only after rereading the complete captured
    // point and every original in one new transaction, not from a version counter.
    const verified = yield* verifyLedgerEffect({
      anchor,
      records: initial.records,
      checkpoint: expected,
    }).pipe(
      Effect.mapError((error) =>
        fail(error.code === 'native-unavailable' ? 'native-unavailable' : 'wrong-parent')
      )
    );
    yield* sql(() =>
      db
        .transaction(() => {
          const meta = db
            .prepare(
              'SELECT genesis,head,count,offset,bootstrap,bytes FROM ledger_feed_meta WHERE id=1'
            )
            .get() as
            | {
                genesis: unknown;
                head: unknown;
                count: unknown;
                offset: unknown;
                bootstrap: unknown;
                bytes: unknown;
              }
            | undefined;
          if (
            !meta ||
            !(meta.genesis instanceof Uint8Array) ||
            !bytesEqual(meta.genesis, anchor.toBytes()) ||
            !(meta.head instanceof Uint8Array) ||
            !bytesEqual(meta.head, expected.head.toBytes()) ||
            meta.count !== initial.records.length ||
            meta.offset !== initial.offset ||
            meta.bootstrap !== Number(initial.bootstrap) ||
            meta.bytes !== initial.bytes
          )
            throw fail('conflict');
          const size = db
            .prepare(
              'SELECT COUNT(*) AS count,COALESCE(SUM(length(record)),0) AS bytes FROM ledger_feed_records'
            )
            .get() as { count: number; bytes: number };
          if (size.count !== initial.records.length || size.bytes !== initial.bytes)
            throw fail('conflict');
          const rows = db
            .prepare(
              'SELECT position,CASE WHEN length(record) BETWEEN 1 AND 8192 THEN record ELSE NULL END AS record FROM ledger_feed_records ORDER BY position LIMIT ?'
            )
            .all(budget.maxRecords) as { position: number; record: unknown }[];
          if (rows.length !== initial.records.length) throw fail('conflict');
          for (let index = 0; index < rows.length; index++) {
            const row = rows[index]!;
            if (
              row.position !== index + 1 ||
              !(row.record instanceof Uint8Array) ||
              !bytesEqual(row.record, initial.records[index]!)
            )
              throw fail('conflict');
          }
        })
        .deferred()
    );
    let state: LedgerFeedState = {
        view: verified,
        offset: initial.offset,
        bootstrap: initial.bootstrap,
      },
      totalBytes = initial.bytes,
      originals = Chunk.fromIterable(initial.records);
    // These counters are only a change detector for an already byte-checked baseline.
    // Capture them under the writer lock, never after COMMIT where another writer could race.
    const stamp = (): StorageStamp => ({
      schema: db.pragma('schema_version', { simple: true }) as number,
      tempSchema: db.pragma('temp.schema_version', { simple: true }) as number,
      data: db.pragma('data_version', { simple: true }) as number,
    });
    const cleanSchema = () => {
      const rows = db.prepare('SELECT sql FROM sqlite_schema ORDER BY name LIMIT 3').all() as {
        sql: unknown;
      }[];
      return (
        rows.length === feedSchema.length &&
        rows.every((row, index) => row.sql === feedSchema[index]) &&
        !db.prepare('SELECT 1 FROM sqlite_temp_schema LIMIT 1').get()
      );
    };
    const totalChanges = db.prepare('SELECT total_changes()').safeIntegers().pluck();
    let audited: StorageStamp | undefined;
    const matches = () => {
      guard();
      const row = db
        .prepare(
          'SELECT genesis,head,count,offset,bootstrap,bytes FROM ledger_feed_meta WHERE id=1'
        )
        .get() as
        | {
            genesis: unknown;
            head: Uint8Array;
            count: number;
            offset: string;
            bootstrap: number;
            bytes: number;
          }
        | undefined;
      if (
        !row ||
        !(row.genesis instanceof Uint8Array) ||
        !bytesEqual(row.genesis, anchor.toBytes()) ||
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
        Effect.gen(function* () {
          const observed = state;
          const copied = yield* sql(() => {
            matches();
            const incoming = page.records;
            if (!Array.isArray(incoming) || incoming.length > 4096) throw fail('read-too-large');
            const count = incoming.length;
            const records: Uint8Array[] = [];
            let pageBytes = 0;
            for (let index = 0; index < count; index++) {
              const record = incoming[index];
              if (!(record instanceof Uint8Array) || record.length < 1 || record.length > 8192)
                throw fail('invalid-frame');
              pageBytes += record.length;
              if (pageBytes > 16 * 1024 * 1024) throw fail('read-too-large');
              records.push(new Uint8Array(record));
            }
            if (incoming.length !== count) throw fail('invalid-frame');
            return {
              requestOffset: page.requestOffset,
              nextOffset: page.nextOffset,
              upToDate: page.upToDate,
              records,
            };
          });
          const next = yield* prepareLedgerPageEffect(observed, copied, checkpoint);
          return yield* sql(() =>
            db
              .transaction(() => {
                if (state !== observed) throw fail('conflict');
                matches();
                const before = stamp();
                const fast =
                  audited !== undefined &&
                  before.schema === audited.schema &&
                  before.tempSchema === audited.tempSchema &&
                  before.data === audited.data;
                const changesBefore = totalChanges.get() as bigint;
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
                if (!fast) {
                  const aggregate = db
                    .prepare(
                      'SELECT COUNT(*) AS count,COALESCE(SUM(length(record)),0) AS bytes FROM ledger_feed_records'
                    )
                    .get() as { count: number; bytes: number };
                  if (aggregate.count !== next.view.length || aggregate.bytes !== bytes)
                    throw fail('corrupt');
                }
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
                    'SELECT genesis,head,count,offset,bootstrap,bytes FROM ledger_feed_meta WHERE id=1'
                  )
                  .get() as
                  | {
                      genesis: Uint8Array;
                      head: Uint8Array;
                      count: number;
                      offset: string;
                      bootstrap: number;
                      bytes: number;
                    }
                  | undefined;
                if (
                  !stored ||
                  !(stored.genesis instanceof Uint8Array) ||
                  !bytesEqual(stored.genesis, anchor.toBytes()) ||
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
                // Persistent concatenation retains the audited prefix without copying
                // its references. Never iterate/spread this Chunk: v4's iterator flattens it.
                const expectedOriginals = Chunk.appendAll(originals, Chunk.fromIterable(additions));
                if (fast) {
                  // The exact trigger-free schema and unchanged external-write stamp ensure
                  // our plain INSERTs/meta UPDATE cannot touch the retained prefix. Still
                  // check every actual change and reread the suffix after the LAST DML.
                  if (
                    (totalChanges.get() as bigint) - changesBefore !==
                    BigInt(additions.length + 1)
                  )
                    throw fail('corrupt');
                  additions.forEach((record, index) => {
                    const row = readOriginal.get(state.view.length + index + 1) as
                      | { record: unknown }
                      | undefined;
                    if (!(row?.record instanceof Uint8Array) || !bytesEqual(row.record, record))
                      throw fail('corrupt');
                  });
                  return { next, bytes, originals: expectedOriginals, audit: before };
                }
                const finalSize = db
                  .prepare(
                    'SELECT COUNT(*) AS count,COALESCE(SUM(length(record)),0) AS bytes FROM ledger_feed_records'
                  )
                  .get() as { count: number; bytes: number };
                if (
                  finalSize.count !== Chunk.size(expectedOriginals) ||
                  finalSize.bytes !== bytes ||
                  finalSize.bytes > budget.maxBytes
                )
                  throw fail('corrupt');
                const retained = db
                  .prepare(
                    'SELECT position,CASE WHEN length(record) BETWEEN 1 AND 8192 THEN record ELSE NULL END AS record FROM ledger_feed_records ORDER BY position LIMIT ?'
                  )
                  .all(budget.maxRecords) as { position: number; record: unknown }[];
                if (retained.length !== Chunk.size(expectedOriginals)) throw fail('corrupt');
                for (let index = 0; index < retained.length; index++) {
                  const row = retained[index]!;
                  if (
                    row.position !== index + 1 ||
                    !(row.record instanceof Uint8Array) ||
                    !bytesEqual(row.record, Chunk.getUnsafe(expectedOriginals, index))
                  )
                    throw fail('corrupt');
                }
                return {
                  next,
                  bytes,
                  originals: expectedOriginals,
                  audit: cleanSchema() ? stamp() : undefined,
                };
              })
              .immediate()
          ).pipe(
            Effect.map(({ next: committed, bytes, originals: retainedOriginals, audit }) => {
              state = committed;
              totalBytes = bytes;
              originals = retainedOriginals;
              audited = audit;
              return { ...state };
            })
          );
        }),
    });
  });
}
