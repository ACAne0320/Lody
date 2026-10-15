import Database from 'better-sqlite3';
import { closeSync, openSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { Data, Effect, Result, Schema } from 'effect';
import * as Bytes from '../bytes';
import { bytesEqual } from '../cbor';
import { MAX_CONTENT_BYTES } from '../content-format';

export class SnapshotPublicationError extends Data.TaggedError('SnapshotPublicationError')<{
  readonly code:
    | 'invalid-input'
    | 'closed'
    | 'storage'
    | 'corrupt'
    | 'conflict'
    | 'busy'
    | 'capacity';
}> {}
export interface SnapshotPublicationRow {
  readonly offset: string;
  readonly signer: string;
  readonly body: Uint8Array;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly phase: 'Pending' | 'Accepted';
}
type Original = Omit<SnapshotPublicationRow, 'phase'>;
const APP = 0x4c455350;
const fail = (code: SnapshotPublicationError['code']) => new SnapshotPublicationError({ code });
const validOffset = (offset: unknown): offset is string =>
  typeof offset === 'string' &&
  offset.length > 0 &&
  offset.length <= 1024 &&
  offset !== 'now' &&
  offset !== '-1' &&
  offset.trim() === offset &&
  !Array.from(offset).some((value) => value.charCodeAt(0) < 32 || value.charCodeAt(0) === 127);
const Meta = Schema.Struct({
  genesis: Schema.Uint8Array,
  resource: Schema.String,
  model: Schema.Literals(['loro', 'flock']),
  currentOffset: Schema.NullOr(Schema.String),
  count: Schema.Int,
  bytes: Schema.Int,
});
const Row = Schema.Struct({
  offset: Schema.String,
  signer: Schema.String,
  body: Schema.Uint8Array,
  issuedAt: Schema.Int,
  expiresAt: Schema.Int,
  phase: Schema.Literals(['Pending', 'Accepted']),
});
const same = (a: SnapshotPublicationRow, b: SnapshotPublicationRow) =>
  a.offset === b.offset &&
  a.signer === b.signer &&
  a.issuedAt === b.issuedAt &&
  a.expiresAt === b.expiresAt &&
  a.phase === b.phase &&
  bytesEqual(a.body, b.body);
const sameOriginal = (a: Original, b: Original) =>
  a.offset === b.offset && a.signer === b.signer && bytesEqual(a.body, b.body);
const own = (row: SnapshotPublicationRow): SnapshotPublicationRow =>
  Object.freeze({ ...row, body: new Uint8Array(row.body) });

function captureOriginal(input: Original) {
  return Result.try({
    try: () => {
      const offset = input.offset,
        signer = input.signer,
        source = input.body,
        issuedAt = input.issuedAt,
        expiresAt = input.expiresAt;
      if (
        !validOffset(offset) ||
        typeof signer !== 'string' ||
        !/^[0-9a-f]{64}$/.test(signer) ||
        !(source instanceof Uint8Array) ||
        source.length < 1 ||
        source.length > MAX_CONTENT_BYTES ||
        !Number.isSafeInteger(issuedAt) ||
        issuedAt < 0 ||
        !Number.isSafeInteger(expiresAt) ||
        expiresAt <= issuedAt
      )
        throw fail('invalid-input');
      Result.getOrThrow(Bytes.signingPublicKey(new Uint8Array(Buffer.from(signer, 'hex'))));
      return Object.freeze({ offset, signer, body: new Uint8Array(source), issuedAt, expiresAt });
    },
    catch: () => fail('invalid-input'),
  });
}

/** Single-host durable publication identities. Stores exact ciphertext and an
 * uncertain Pending attempt before native PUT. It never validates permissions,
 * chooses a trusted view, orders opaque offsets, or infers native success.
 * Callers accept only after exact actual native readback and serialize their
 * admissions. Native I/O is never held inside these synchronous transactions. */
export const makeSqliteSnapshotPublication = Effect.fnUntraced(function* (input: {
  readonly path: string;
  readonly mode: 'create' | 'open';
  readonly genesis: Bytes.GenesisHash;
  readonly resource: string;
  readonly model: 'loro' | 'flock';
  readonly budget?: { readonly maxSnapshots: number; readonly maxBytes: number };
}) {
  const path = input.path,
    mode = input.mode,
    resource = input.resource,
    model = input.model;
  const genesis = yield* Effect.fromResult(Bytes.genesisHash(input.genesis.toBytes()));
  const maxSnapshots = input.budget?.maxSnapshots ?? 10000,
    maxBytes = input.budget?.maxBytes ?? 64 * 1024 * 1024;
  if (
    typeof path !== 'string' ||
    !isAbsolute(path) ||
    (mode !== 'create' && mode !== 'open') ||
    typeof resource !== 'string' ||
    resource.length < 1 ||
    resource.length > 1024 ||
    !/^[!-~]+$/.test(resource) ||
    (model !== 'loro' && model !== 'flock') ||
    !Number.isSafeInteger(maxSnapshots) ||
    maxSnapshots < 1 ||
    maxSnapshots > 100000 ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    maxBytes > 64 * 1024 * 1024
  )
    return yield* fail('invalid-input');
  const sql = <A>(work: () => A) =>
    Effect.try({
      try: work,
      catch: (error) => (error instanceof SnapshotPublicationError ? error : fail('storage')),
    });
  if (mode === 'create') yield* sql(() => closeSync(openSync(path, 'wx', 0o600)));
  const db = yield* Effect.acquireRelease(
    sql(() => new Database(path, { fileMustExist: true, timeout: 1000 })),
    (value) => sql(() => value.close()).pipe(Effect.orDie)
  );
  let closed = false;
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      closed = true;
    })
  );
  const guard = () => {
    if (closed) throw fail('closed');
  };
  yield* sql(() => {
    if (
      mode === 'open' &&
      (db.pragma('application_id', { simple: true }) !== APP ||
        db.pragma('user_version', { simple: true }) !== 1)
    )
      throw fail('corrupt');
    db.pragma('journal_mode=WAL');
    db.pragma('synchronous=FULL');
    if (mode === 'create')
      db.transaction(() => {
        db.exec(`CREATE TABLE snapshot_publication_meta(id INTEGER PRIMARY KEY CHECK(id=1),genesis BLOB NOT NULL CHECK(length(genesis)=32),resource TEXT NOT NULL,model TEXT NOT NULL CHECK(model IN ('loro','flock')),currentOffset TEXT,count INTEGER NOT NULL,bytes INTEGER NOT NULL) STRICT;
CREATE TABLE snapshot_publications(offset TEXT PRIMARY KEY,signer TEXT NOT NULL CHECK(length(signer)=64),body BLOB NOT NULL CHECK(length(body) BETWEEN 1 AND ${MAX_CONTENT_BYTES}),issuedAt INTEGER NOT NULL CHECK(issuedAt>=0),expiresAt INTEGER NOT NULL CHECK(expiresAt>issuedAt),phase TEXT NOT NULL CHECK(phase IN ('Pending','Accepted'))) STRICT;
CREATE UNIQUE INDEX snapshot_one_pending ON snapshot_publications(phase) WHERE phase='Pending';
PRAGMA application_id=${APP}; PRAGMA user_version=1;`);
        if (
          db
            .prepare('INSERT INTO snapshot_publication_meta VALUES(1,?,?,?,NULL,0,0)')
            .run(genesis.toBytes(), resource, model).changes !== 1
        )
          throw fail('corrupt');
      }).immediate();
  });
  const read = () => {
    guard();
    const metaResult = Schema.decodeUnknownResult(Meta)(
      db
        .prepare(`SELECT
CASE WHEN length(genesis)=32 THEN genesis ELSE NULL END AS genesis,
CASE WHEN length(resource) BETWEEN 1 AND 1024 THEN resource ELSE NULL END AS resource,model,
CASE WHEN currentOffset IS NULL OR length(currentOffset) BETWEEN 1 AND 1024 THEN currentOffset ELSE x'' END AS currentOffset,
count,bytes FROM snapshot_publication_meta WHERE id=1`)
        .get()
    );
    if (Result.isFailure(metaResult)) throw fail('corrupt');
    const meta = metaResult.success;
    if (
      !bytesEqual(meta.genesis, genesis.toBytes()) ||
      meta.resource !== resource ||
      meta.model !== model ||
      (meta.currentOffset !== null && !validOffset(meta.currentOffset)) ||
      meta.count < 0 ||
      meta.count > maxSnapshots ||
      meta.bytes < 0 ||
      meta.bytes > maxBytes ||
      (db.prepare('SELECT COUNT(*) AS n FROM snapshot_publication_meta').get() as { n: number })
        .n !== 1
    )
      throw fail('corrupt');
    const sizes = db
      .prepare(
        'SELECT COUNT(*) AS count,COALESCE(SUM(length(body)),0) AS bytes FROM snapshot_publications'
      )
      .get() as { count: number; bytes: number };
    if (sizes.count !== meta.count || sizes.bytes !== meta.bytes) throw fail('corrupt');
    const rows = db
      .prepare(`SELECT
CASE WHEN length(offset) BETWEEN 1 AND 1024 THEN offset ELSE NULL END AS offset,
CASE WHEN length(signer)=64 THEN signer ELSE NULL END AS signer,
CASE WHEN length(body) BETWEEN 1 AND ${MAX_CONTENT_BYTES} THEN body ELSE NULL END AS body,issuedAt,expiresAt,phase
FROM snapshot_publications ORDER BY offset LIMIT ?`)
      .all(maxSnapshots);
    if (rows.length !== meta.count) throw fail('corrupt');
    const originals = new Map<string, SnapshotPublicationRow>();
    let pending = 0,
      accepted = 0;
    for (const raw of rows) {
      const parsed = Schema.decodeUnknownResult(Row)(raw);
      if (Result.isFailure(parsed)) throw fail('corrupt');
      const row = parsed.success;
      const original = captureOriginal(row);
      if (Result.isFailure(original) || originals.has(row.offset)) throw fail('corrupt');
      originals.set(row.offset, own({ ...original.success, phase: row.phase }));
      if (row.phase === 'Pending') pending++;
      else accepted++;
    }
    if (
      pending > 1 ||
      (accepted === 0 ? meta.currentOffset !== null : meta.currentOffset === null) ||
      (meta.currentOffset !== null && originals.get(meta.currentOffset)?.phase !== 'Accepted')
    )
      throw fail('corrupt');
    return { originals, currentOffset: meta.currentOffset, bytes: meta.bytes };
  };
  let state = yield* sql(() => db.transaction(read).deferred());
  const matches = () => {
    const actual = read();
    if (
      actual.currentOffset !== state.currentOffset ||
      actual.bytes !== state.bytes ||
      actual.originals.size !== state.originals.size
    )
      throw fail('conflict');
    for (const [offset, original] of state.originals) {
      const row = actual.originals.get(offset);
      if (!row || !same(row, original)) throw fail('conflict');
    }
  };
  const audit = (next: typeof state) => {
    const actual = read();
    if (
      actual.currentOffset !== next.currentOffset ||
      actual.bytes !== next.bytes ||
      actual.originals.size !== next.originals.size
    )
      throw fail('corrupt');
    for (const [offset, expected] of next.originals) {
      const stored = actual.originals.get(offset);
      if (!stored || !same(stored, expected)) throw fail('corrupt');
    }
  };
  const checked = <A>(work: () => A) =>
    sql(() =>
      db
        .transaction(() => {
          matches();
          return work();
        })
        .deferred()
    );
  return Object.freeze({
    lookup: (offset: string) =>
      checked(() => {
        if (!validOffset(offset)) throw fail('invalid-input');
        const row = state.originals.get(offset);
        return row ? own(row) : null;
      }),
    pending: () =>
      checked(() => {
        for (const row of state.originals.values()) if (row.phase === 'Pending') return own(row);
        return null;
      }),
    current: () =>
      checked(() =>
        state.currentOffset === null ? null : own(state.originals.get(state.currentOffset)!)
      ),
    reserve: Effect.fnUntraced(function* (inputRow: Original) {
      const original = yield* Effect.fromResult(captureOriginal(inputRow));
      const next = yield* sql(() =>
        db
          .transaction(() => {
            matches();
            const prior = state.originals.get(original.offset);
            if (prior) {
              if (!sameOriginal(prior, original)) throw fail('conflict');
              // A later credential may confirm the original, never renew its first deadline.
              return { state, row: prior };
            }
            for (const row of state.originals.values())
              if (row.phase === 'Pending') throw fail('busy');
            if (
              state.originals.size >= maxSnapshots ||
              state.bytes + original.body.length > maxBytes
            )
              throw fail('capacity');
            const row: SnapshotPublicationRow = own({ ...original, phase: 'Pending' });
            const originals = new Map(state.originals);
            originals.set(row.offset, row);
            const proposed = {
              originals,
              currentOffset: state.currentOffset,
              bytes: state.bytes + row.body.length,
            };
            if (
              db
                .prepare('INSERT INTO snapshot_publications VALUES(?,?,?,?,?,?)')
                .run(row.offset, row.signer, row.body, row.issuedAt, row.expiresAt, row.phase)
                .changes !== 1
            )
              throw fail('corrupt');
            if (
              db
                .prepare('UPDATE snapshot_publication_meta SET count=?,bytes=? WHERE id=1')
                .run(originals.size, proposed.bytes).changes !== 1
            )
              throw fail('corrupt');
            audit(proposed); // No DML follows the complete final original/meta check.
            return { state: proposed, row };
          })
          .immediate()
      );
      state = next.state;
      return own(next.row);
    }),
    accept: Effect.fnUntraced(function* (expected: SnapshotPublicationRow) {
      const original = yield* Effect.fromResult(captureOriginal(expected));
      const phase = expected.phase;
      if (phase !== 'Pending' && phase !== 'Accepted') return yield* fail('invalid-input');
      const next = yield* sql(() =>
        db
          .transaction(() => {
            matches();
            const prior = state.originals.get(original.offset);
            if (
              !prior ||
              !sameOriginal(prior, original) ||
              prior.issuedAt !== original.issuedAt ||
              prior.expiresAt !== original.expiresAt
            )
              throw fail('conflict');
            if (prior.phase === 'Accepted') return state; // Never republish or rewind current.
            if (phase !== 'Pending') throw fail('conflict');
            const originals = new Map(state.originals);
            originals.set(prior.offset, own({ ...prior, phase: 'Accepted' }));
            const proposed = { originals, currentOffset: prior.offset, bytes: state.bytes };
            if (
              db
                .prepare(
                  "UPDATE snapshot_publications SET phase='Accepted' WHERE offset=? AND phase='Pending'"
                )
                .run(prior.offset).changes !== 1
            )
              throw fail('corrupt');
            if (
              db
                .prepare('UPDATE snapshot_publication_meta SET currentOffset=? WHERE id=1')
                .run(prior.offset).changes !== 1
            )
              throw fail('corrupt');
            audit(proposed); // Last DML already completed, including all trigger effects.
            return proposed;
          })
          .immediate()
      );
      state = next;
      return undefined;
    }),
  });
});
