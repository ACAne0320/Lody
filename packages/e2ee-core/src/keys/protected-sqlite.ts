import { openSqliteStore, makeSqliteLedgerPin } from '../storage/sqlite';
import { isAbsolute } from 'node:path';
import { Data, Effect, Result } from 'effect';
import * as Bytes from '../bytes';
import { disposeEpochKey } from '../epoch-key';
import { keyId } from '../identifiers';
import { type LedgerView } from '../ledger';
import {
  makeHostEpochProtection,
  MAX_PROTECTED_EPOCH_BYTES,
  type NativeEpochProtector,
} from './host-protection';
export class ProtectedStoreError extends Data.TaggedError('ProtectedStoreError')<{
  readonly code: 'closed' | 'storage' | 'corrupt' | 'rollback' | 'missing-key';
}> {}
const fail = (code: ProtectedStoreError['code']) => new ProtectedStoreError({ code });
const sql = <A>(work: () => A) =>
  Effect.try({
    try: work,
    catch: (error) => (error instanceof ProtectedStoreError ? error : fail('storage')),
  });
const APP = 0x4c45504b;
/** Separate durable local protected-key store, not a recovery vault or native OS adapter.
 * Composition authenticates/binds the host identity and supplies one native protection capability. */
export function makeSqliteProtectedEpochKeys(input: {
  readonly path: string;
  readonly mode: 'create' | 'open';
  readonly genesis: Bytes.GenesisHash;
  readonly recipient: Bytes.SigningPublicKey;
  readonly ledger: () => Effect.Effect<LedgerView, unknown>;
  readonly protector: NativeEpochProtector;
}) {
  return Effect.gen(function* () {
    const { path, mode } = input;
    const lookup = input.ledger;
    const native = input.protector;
    const protector = Object.freeze({
      protect: native.protect.bind(native),
      unprotect: native.unprotect.bind(native),
    });
    const anchor = yield* Effect.fromResult(Bytes.genesisHash(input.genesis.toBytes()));
    const recipient = yield* Effect.fromResult(Bytes.signingPublicKey(input.recipient.toBytes()));
    const org = keyId(anchor.toBytes()),
      self = keyId(recipient.toBytes());
    if (typeof path !== 'string' || !isAbsolute(path) || (mode !== 'create' && mode !== 'open'))
      return yield* fail('storage');
    const db = yield* openSqliteStore({
      path,
      mode,
      applicationId: APP,
      version: 1,
      initialize(connection) {
        connection.exec(`CREATE TABLE protected_key_meta(id INTEGER PRIMARY KEY CHECK(id=1),genesis TEXT NOT NULL,recipient TEXT NOT NULL,head BLOB,count INTEGER);
        CREATE TABLE protected_epoch_keys(epoch INTEGER PRIMARY KEY CHECK(epoch>=0 AND epoch<=4294967295),blob BLOB NOT NULL CHECK(length(blob) BETWEEN 1 AND ${MAX_PROTECTED_EPOCH_BYTES}));
        `);
        connection
          .prepare('INSERT INTO protected_key_meta(id,genesis,recipient) VALUES(1,?,?)')
          .run(org, self);
      },
      validate(connection) {
        const meta = connection
          .prepare('SELECT genesis,recipient FROM protected_key_meta WHERE id=1')
          .get() as { genesis?: unknown; recipient?: unknown; sender?: unknown } | undefined;
        if (meta?.genesis !== org || meta?.recipient !== self) throw fail('corrupt');
      },
      error: fail,
    });
    let closed = false;
    const guard = () => {
      if (closed) throw fail('closed');
    };

    const observePin = makeSqliteLedgerPin({
      db,
      table: 'protected_key_meta',
      genesis: org,
      bindings: { recipient: self },
      error: fail,
    });
    const ledger = () =>
      Effect.gen(function* () {
        yield* sql(guard);
        const view = yield* lookup();
        yield* sql(() => {
          guard();
          observePin(view);
        });
        return view;
      });
    const protection = yield* makeHostEpochProtection({
      genesis: anchor,
      recipient,
      ledger,
      protector,
    });
    // Close admission first, then await native leases, then close the database.
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        closed = true;
      })
    );
    const load = (epoch: number) =>
      sql(() => {
        guard();
        const row = db
          .prepare(
            `SELECT CASE WHEN length(blob) BETWEEN 1 AND ${MAX_PROTECTED_EPOCH_BYTES} THEN blob ELSE NULL END AS blob FROM protected_epoch_keys WHERE epoch=?`
          )
          .get(epoch) as { blob: unknown } | undefined;
        if (!row) throw fail('missing-key');
        if (!(row.blob instanceof Uint8Array)) throw fail('corrupt');
        return new Uint8Array(row.blob);
      });
    return Object.freeze({
      saveAndReload: (epoch: number, key: Bytes.EpochKey) =>
        Effect.gen(function* () {
          const existing = yield* Effect.result(load(epoch));
          let damaged: Uint8Array | undefined;
          if (Result.isSuccess(existing)) {
            const opened = yield* Effect.result(protection.open(epoch, existing.success));
            if (Result.isSuccess(opened)) {
              disposeEpochKey(opened.success);
              return yield* Effect.void;
            }
            if (opened.failure.code === 'closed') return yield* opened.failure;
            damaged = existing.success;
          } else if (existing.failure.code !== 'missing-key') return yield* existing.failure;
          const blob = yield* protection.seal(epoch, key);
          // A replacement must independently open and match the verified epoch commitment.
          yield* Effect.acquireUseRelease(
            protection.open(epoch, blob),
            () => Effect.void,
            (ownedKey) => Effect.sync(() => disposeEpochKey(ownedKey))
          );
          yield* sql(() =>
            db
              .transaction(() => {
                guard();
                if (damaged)
                  db.prepare('UPDATE protected_epoch_keys SET blob=? WHERE epoch=? AND blob=?').run(
                    blob,
                    epoch,
                    damaged
                  );
                else
                  db.prepare(
                    'INSERT INTO protected_epoch_keys(epoch,blob) VALUES(?,?) ON CONFLICT(epoch) DO NOTHING'
                  ).run(epoch, blob);
              })
              .immediate()
          );
          // Concurrent originals still win; success requires the actual stored key.
          return yield* Effect.acquireUseRelease(
            load(epoch).pipe(Effect.flatMap((storedBlob) => protection.open(epoch, storedBlob))),
            () => Effect.void,
            (ownedKey) => Effect.sync(() => disposeEpochKey(ownedKey))
          );
        }),
      read: (epoch: number) =>
        load(epoch).pipe(Effect.flatMap((storedBlob) => protection.open(epoch, storedBlob))),
    });
  });
}
