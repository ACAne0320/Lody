import { isAbsolute } from 'node:path';
import { Effect, Result, Schema } from 'effect';
import * as Bytes from '../bytes';
import { bytesEqual } from '../cbor';
import { openSqliteStore } from '../storage/sqlite';
import { extendLedgerEffect, type LedgerCheckpoint } from './index';
import {
  verifyLedgerSnapshot,
  type SnapshotTrust,
  type VerifiedViewSnapshotTrust,
} from './snapshot';
import {
  LedgerFeedError,
  prepareLedgerPageEffect,
  validLedgerOffset,
  type LedgerFeedState,
  type LedgerReadPage,
} from './feed-page';

const APP = 0x4c455346;
const MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024;
const fail = (code: LedgerFeedError['code']) => new LedgerFeedError({ code });
const Meta = Schema.Struct({
  genesis: Schema.Uint8Array,
  snapshot: Schema.Uint8Array,
  originHead: Schema.Uint8Array,
  originCount: Schema.Number,
  originOffset: Schema.String,
  head: Schema.Uint8Array,
  count: Schema.Number,
  offset: Schema.String,
  bytes: Schema.Number,
});
const RecordRow = Schema.Struct({ position: Schema.Number, record: Schema.Uint8Array });

/** Explicit endorsed origin. Every create/open supplies qualification independently;
 * persisted bytes and transport offsets never select an endorser or grant authority. */
export interface SnapshotFeedOrigin {
  readonly bytes: Uint8Array;
  readonly trust: SnapshotTrust | VerifiedViewSnapshotTrust;
  readonly offset: string;
}
export interface SqliteSnapshotLedgerFeedInput {
  readonly path: string;
  readonly mode: 'create' | 'open';
  readonly genesis: Bytes.GenesisHash;
  readonly snapshot: SnapshotFeedOrigin;
  readonly expected: LedgerCheckpoint;
  readonly budget: { readonly maxRecords: number; readonly maxBytes: number };
}

function capture(input: SqliteSnapshotLedgerFeedInput) {
  return Result.try({
    try: () =>
      Result.getOrThrow(
        Result.gen(function* () {
          const path = input.path,
            mode = input.mode,
            source = input.snapshot,
            candidate = source.bytes,
            offset = source.offset,
            trustSource = source.trust;
          const genesis = yield* Bytes.genesisHash(input.genesis.toBytes());
          const expected = {
            head: yield* Bytes.recordHash(input.expected.head.toBytes()),
            length: input.expected.length,
          };
          const budget = {
            maxRecords: input.budget.maxRecords,
            maxBytes: input.budget.maxBytes,
          };
          if (
            !isAbsolute(path) ||
            (mode !== 'create' && mode !== 'open') ||
            !(candidate instanceof Uint8Array) ||
            candidate.length < 1 ||
            candidate.length > MAX_SNAPSHOT_BYTES ||
            !validLedgerOffset(offset) ||
            !Number.isSafeInteger(expected.length) ||
            expected.length < 1 ||
            !Number.isSafeInteger(budget.maxRecords) ||
            budget.maxRecords < 1 ||
            budget.maxRecords > 1_000_000 ||
            !Number.isSafeInteger(budget.maxBytes) ||
            budget.maxBytes < 1 ||
            budget.maxBytes > 64 * 1024 * 1024
          )
            return yield* Result.fail(fail('invalid-frame'));
          const snapshot = new Uint8Array(candidate);
          // A genuine token has private identity. Rebuilding its public shape would
          // discard provenance; external facts instead receive independent copies.
          const trust =
            trustSource.source === 'verified-view'
              ? trustSource
              : Object.freeze({
                  source: trustSource.source,
                  genesis: yield* Bytes.genesisHash(trustSource.genesis.toBytes()),
                  endorser: yield* Bytes.signingPublicKey(trustSource.endorser.toBytes()),
                  head: yield* Bytes.recordHash(trustSource.head.toBytes()),
                  length: trustSource.length,
                  headSignature: yield* Bytes.signature(trustSource.headSignature.toBytes()),
                  membershipId: yield* Bytes.membershipId(trustSource.membershipId.toBytes()),
                  role: trustSource.role,
                  kind: trustSource.kind,
                  ...(trustSource.stateDigest
                    ? { stateDigest: yield* Bytes.recordHash(trustSource.stateDigest.toBytes()) }
                    : {}),
                });
          const view = yield* verifyLedgerSnapshot({ snapshot, trust });
          if (!genesis.equals(view.genesis)) return yield* Result.fail(fail('wrong-parent'));
          if (view.length > budget.maxRecords || snapshot.length > budget.maxBytes)
            return yield* Result.fail(fail('read-too-large'));
          if (
            mode === 'create' &&
            (expected.length !== view.length || !expected.head.equals(view.head))
          )
            return yield* Result.fail(fail('wrong-parent'));
          return { path, mode, genesis, expected, budget, snapshot, originOffset: offset, view };
        })
      ),
    catch: (error) => (error instanceof LedgerFeedError ? error : fail('wrong-parent')),
  });
}

/** Current-format SQLite snapshot plus original suffix. No legacy conversion,
 * unknown-prefix skipping, cursor inference, or snapshot-only P09/CAS path. */
export const makeSqliteSnapshotLedgerFeed = Effect.fnUntraced(function* (
  input: SqliteSnapshotLedgerFeedInput
) {
  // Capture every externally selected field and verify before any native wait.
  const config = yield* Effect.fromResult(capture(input));
  const { path, mode, genesis, expected, budget, snapshot, originOffset } = config;
  const sql = <A>(work: () => A) =>
    Effect.try({
      try: work,
      catch: (error) => (error instanceof LedgerFeedError ? error : fail('storage')),
    });
  const db = yield* openSqliteStore({
    path,
    mode,
    applicationId: APP,
    version: 1,
    error: fail,
    initialize: (connection) => {
      connection.exec(`CREATE TABLE snapshot_feed_meta(id INTEGER PRIMARY KEY CHECK(id=1),genesis BLOB NOT NULL CHECK(length(genesis)=32),snapshot BLOB NOT NULL CHECK(length(snapshot) BETWEEN 1 AND ${MAX_SNAPSHOT_BYTES}),originHead BLOB NOT NULL CHECK(length(originHead)=32),originCount INTEGER NOT NULL CHECK(originCount>0),originOffset TEXT NOT NULL,head BLOB NOT NULL CHECK(length(head)=32),count INTEGER NOT NULL,offset TEXT NOT NULL,bytes INTEGER NOT NULL);
        CREATE TABLE snapshot_feed_records(position INTEGER PRIMARY KEY,record BLOB NOT NULL CHECK(length(record) BETWEEN 1 AND 8192));`);
      if (
        connection
          .prepare('INSERT INTO snapshot_feed_meta VALUES(1,?,?,?,?,?,?,?,?,?)')
          .run(
            genesis.toBytes(),
            snapshot,
            config.view.head.toBytes(),
            config.view.length,
            originOffset,
            config.view.head.toBytes(),
            config.view.length,
            originOffset,
            snapshot.length
          ).changes !== 1
      )
        throw fail('corrupt');
    },
    validate: (connection) => {
      const row = connection.prepare('SELECT genesis FROM snapshot_feed_meta WHERE id=1').get() as
        | { genesis: unknown }
        | undefined;
      if (!(row?.genesis instanceof Uint8Array) || !bytesEqual(row.genesis, genesis.toBytes()))
        throw fail('corrupt');
    },
  });
  let closed = false;
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      closed = true;
    })
  );
  const guard = () => {
    if (closed) throw fail('closed');
  };
  const read = () => {
    guard();
    const parsed = Schema.decodeUnknownResult(Meta)(
      db
        .prepare(
          `SELECT CASE WHEN length(genesis)=32 THEN genesis ELSE NULL END AS genesis,
CASE WHEN length(snapshot) BETWEEN 1 AND ${MAX_SNAPSHOT_BYTES} THEN snapshot ELSE NULL END AS snapshot,
CASE WHEN length(originHead)=32 THEN originHead ELSE NULL END AS originHead,originCount,
CASE WHEN length(originOffset) BETWEEN 1 AND 1024 THEN originOffset ELSE NULL END AS originOffset,
CASE WHEN length(head)=32 THEN head ELSE NULL END AS head,count,
CASE WHEN length(offset) BETWEEN 1 AND 1024 THEN offset ELSE NULL END AS offset,bytes FROM snapshot_feed_meta WHERE id=1`
        )
        .get()
    );
    if (Result.isFailure(parsed)) throw fail('corrupt');
    const row = parsed.success;
    if (
      !bytesEqual(row.genesis, genesis.toBytes()) ||
      !bytesEqual(row.snapshot, snapshot) ||
      !bytesEqual(row.originHead, config.view.head.toBytes()) ||
      row.originCount !== config.view.length ||
      row.originOffset !== originOffset ||
      row.head.length !== 32 ||
      !Number.isSafeInteger(row.count) ||
      row.count < config.view.length ||
      row.count > budget.maxRecords ||
      (row.count === config.view.length && row.offset !== originOffset) ||
      !validLedgerOffset(row.offset) ||
      !Number.isSafeInteger(row.bytes) ||
      row.bytes < snapshot.length ||
      row.bytes > budget.maxBytes
    )
      throw fail('corrupt');
    if (
      (db.prepare('SELECT COUNT(*) AS count FROM snapshot_feed_meta').get() as { count: number })
        .count !== 1
    )
      throw fail('corrupt');
    const aggregate = db
      .prepare(
        'SELECT COUNT(*) AS count,COALESCE(SUM(length(record)),0) AS bytes FROM snapshot_feed_records'
      )
      .get() as { count: number; bytes: number };
    if (
      aggregate.count !== row.count - config.view.length ||
      aggregate.bytes !== row.bytes - snapshot.length
    )
      throw fail('corrupt');
    const rows = db
      .prepare(
        'SELECT position,CASE WHEN length(record) BETWEEN 1 AND 8192 THEN record ELSE NULL END AS record FROM snapshot_feed_records ORDER BY position LIMIT ?'
      )
      .all(budget.maxRecords);
    if (rows.length !== aggregate.count) throw fail('corrupt');
    const records: Uint8Array[] = [];
    for (let index = 0; index < rows.length; index++) {
      const entry = Schema.decodeUnknownResult(RecordRow)(rows[index]);
      if (
        Result.isFailure(entry) ||
        entry.success.position !== config.view.length + index + 1 ||
        entry.success.record.length < 1 ||
        entry.success.record.length > 8192
      )
        throw fail('corrupt');
      records.push(new Uint8Array(entry.success.record));
    }
    return { row, records };
  };
  const initial = yield* sql(() => db.transaction(read).deferred());
  const verified = yield* extendLedgerEffect(config.view, initial.records, expected).pipe(
    Effect.mapError((error) =>
      fail(error.code === 'native-unavailable' ? 'native-unavailable' : 'wrong-parent')
    )
  );
  let state: LedgerFeedState = { view: verified, offset: initial.row.offset, bootstrap: false },
    totalBytes = initial.row.bytes;
  const checkPoint = (expectedState = state, expectedBytes = totalBytes) => {
    guard();
    const row = db
      .prepare('SELECT genesis,head,count,offset,bytes FROM snapshot_feed_meta WHERE id=1')
      .get() as
      | { genesis: Uint8Array; head: Uint8Array; count: number; offset: string; bytes: number }
      | undefined;
    if (
      !row ||
      !(row.genesis instanceof Uint8Array) ||
      !bytesEqual(row.genesis, genesis.toBytes()) ||
      !(row.head instanceof Uint8Array) ||
      !bytesEqual(row.head, expectedState.view.head.toBytes()) ||
      row.count !== expectedState.view.length ||
      row.offset !== expectedState.offset ||
      row.bytes !== expectedBytes
    )
      throw fail('conflict');
  };
  // Verification can yield: reject a concurrent append at this metadata point.
  yield* sql(() => checkPoint());
  return Object.freeze({
    current: () =>
      sql(() =>
        db
          .transaction(() => {
            checkPoint();
            return { ...state };
          })
          .deferred()
      ),
    accept: Effect.fnUntraced(function* (page: LedgerReadPage, checkpoint: LedgerCheckpoint) {
      const observed = state;
      const copied = yield* sql(() => {
        checkPoint();
        const incoming = page.records;
        if (!Array.isArray(incoming) || incoming.length > 4096) throw fail('read-too-large');
        const count = incoming.length,
          records: Uint8Array[] = [];
        let size = 0;
        for (let index = 0; index < count; index++) {
          const record = incoming[index];
          if (!(record instanceof Uint8Array) || record.length < 1 || record.length > 8192)
            throw fail('invalid-frame');
          size += record.length;
          if (size > 16 * 1024 * 1024) throw fail('read-too-large');
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
      const bytes = copied.records.reduce((size, record) => size + record.length, totalBytes);
      if (next.view.length > budget.maxRecords || bytes > budget.maxBytes)
        return yield* fail('read-too-large');
      yield* sql(() =>
        db
          .transaction(() => {
            if (state !== observed) throw fail('conflict');
            checkPoint();
            const insert = db.prepare(
              'INSERT INTO snapshot_feed_records(position,record) VALUES(?,?)'
            );
            for (let index = 0; index < copied.records.length; index++)
              if (
                insert.run(observed.view.length + index + 1, copied.records[index]!).changes !== 1
              )
                throw fail('corrupt');
            if (
              db
                .prepare('UPDATE snapshot_feed_meta SET head=?,count=?,offset=?,bytes=? WHERE id=1')
                .run(next.view.head.toBytes(), next.view.length, next.offset, bytes).changes !== 1
            )
              throw fail('corrupt');
            checkPoint(next, bytes);
            const readOriginal = db.prepare(
              'SELECT record FROM snapshot_feed_records WHERE position=?'
            );
            for (let index = 0; index < copied.records.length; index++) {
              const row = readOriginal.get(observed.view.length + index + 1) as
                | { record: unknown }
                | undefined;
              if (
                !(row?.record instanceof Uint8Array) ||
                !bytesEqual(row.record, copied.records[index]!)
              )
                throw fail('corrupt');
            }
          })
          .immediate()
      );
      state = next;
      totalBytes = bytes;
      return { ...state };
    }),
  });
});
