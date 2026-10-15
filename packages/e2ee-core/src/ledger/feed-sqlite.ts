import { isAbsolute } from 'node:path';
import { Effect, Result } from 'effect';
import * as Bytes from '../bytes';
import { bytesEqual } from '../cbor';
import { openSqliteStore } from '../storage/sqlite';
import { verifyLedger, verifyLedgerEffect, hashRecordBytes, type LedgerCheckpoint } from './index';
import {
  LedgerFeedError,
  prepareLedgerPageEffect,
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
    const db = yield* openSqliteStore({
      path,
      mode,
      applicationId: APP,
      version: 1,
      error: fail,
      initialize: (connection) => {
        connection.exec(`CREATE TABLE ledger_feed_meta(id INTEGER PRIMARY KEY CHECK(id=1),genesis BLOB NOT NULL CHECK(length(genesis)=32),head BLOB NOT NULL CHECK(length(head)=32),count INTEGER NOT NULL,offset TEXT NOT NULL,bootstrap INTEGER NOT NULL CHECK(bootstrap IN (0,1)),bytes INTEGER NOT NULL);
          CREATE TABLE ledger_feed_records(position INTEGER PRIMARY KEY,record BLOB NOT NULL CHECK(length(record) BETWEEN 1 AND 8192));`);
        connection.prepare('INSERT INTO ledger_feed_records VALUES(1,?)').run(genesisRecord);
        connection
          .prepare('INSERT INTO ledger_feed_meta VALUES(1,?,?,1,?,1,?)')
          .run(anchor.toBytes(), genesis.head.toBytes(), '-1', genesisRecord.length);
      },
      validate: (connection) => {
        const row = connection.prepare('SELECT genesis FROM ledger_feed_meta WHERE id=1').get() as
          | { genesis: unknown }
          | undefined;
        if (!(row?.genesis instanceof Uint8Array) || !bytesEqual(row.genesis, anchor.toBytes()))
          throw fail('corrupt');
      },
    });
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
    // Authenticate all retained bytes on open; mutations subsequently read only
    // their metadata point and the newly written rows.
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
        })
        .deferred()
    );
    let state: LedgerFeedState = {
        view: verified,
        offset: initial.offset,
        bootstrap: initial.bootstrap,
      },
      totalBytes = initial.bytes;
    const checkPoint = () => {
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
          checkPoint();
          return { ...state };
        }),
      accept: (page: LedgerReadPage, checkpoint: LedgerCheckpoint) =>
        Effect.gen(function* () {
          const observed = state;
          const copied = yield* sql(() => {
            checkPoint();
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
                checkPoint();
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
                });
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
                // Read back only the originals written by this transaction.
                additions.forEach((record, index) => {
                  const row = readOriginal.get(state.view.length + index + 1) as
                    | { record: unknown }
                    | undefined;
                  if (!(row?.record instanceof Uint8Array) || !bytesEqual(row.record, record))
                    throw fail('corrupt');
                });
                return { next, bytes };
              })
              .immediate()
          ).pipe(
            Effect.map(({ next: committed, bytes }) => {
              state = committed;
              totalBytes = bytes;
              return { ...state };
            })
          );
        }),
    });
  });
}
