import Database from 'better-sqlite3';
import { closeSync, openSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { Data, Effect, Result } from 'effect';
import * as Bytes from '../bytes';
import { disposeEpochKey } from '../epoch-key';
import { keyId } from '../identifiers';
import { hasVerifiedCheckpoint, requireLedgerContinuation, type LedgerView } from '../ledger';
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
    if (mode === 'create') yield* sql(() => closeSync(openSync(path, 'wx', 0o600)));
    const db = yield* Effect.acquireRelease(
      sql(() => new Database(path, { fileMustExist: true, timeout: 1000 })),
      (handle) => sql(() => handle.close()).pipe(Effect.orDie)
    );
    let closed = false;
    const guard = () => {
      if (closed) throw fail('closed');
    };
    yield* sql(() => {
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
      // Validate foreign file before switching journal mode.
      if (mode === 'open') {
        const meta = db
          .prepare('SELECT genesis,recipient FROM protected_key_meta WHERE id=1')
          .get() as { genesis: unknown; recipient: unknown } | undefined;
        if (meta?.genesis !== org || meta.recipient !== self) throw fail('corrupt');
      }
      db.pragma('journal_mode=WAL');
      db.pragma('synchronous=FULL');
      if (mode === 'create')
        db.transaction(() => {
          db.exec(`CREATE TABLE protected_key_meta(id INTEGER PRIMARY KEY CHECK(id=1),genesis TEXT NOT NULL,recipient TEXT NOT NULL,head BLOB,count INTEGER);
        CREATE TABLE protected_epoch_keys(epoch INTEGER PRIMARY KEY CHECK(epoch>=0 AND epoch<=4294967295),blob BLOB NOT NULL CHECK(length(blob) BETWEEN 1 AND ${MAX_PROTECTED_EPOCH_BYTES}));
        PRAGMA application_id=${APP};PRAGMA user_version=1;`);
          db.prepare('INSERT INTO protected_key_meta(id,genesis,recipient) VALUES(1,?,?)').run(
            org,
            self
          );
        }).immediate();
    });
    const ledger = () =>
      Effect.gen(function* () {
        yield* sql(guard);
        const view = yield* lookup();
        yield* sql(guard);
        yield* Effect.fromResult(requireLedgerContinuation(view, view));
        if (!anchor.equals(view.genesis)) return yield* fail('rollback');
        yield* sql(() =>
          db
            .transaction(() => {
              guard();
              const pin = db
                .prepare('SELECT head,count FROM protected_key_meta WHERE id=1')
                .get() as { head: unknown; count: unknown } | undefined;
              if (!pin) throw fail('corrupt');
              if (pin.head !== null) {
                if (
                  !(pin.head instanceof Uint8Array) ||
                  pin.head.length !== 32 ||
                  typeof pin.count !== 'number' ||
                  !Number.isSafeInteger(pin.count) ||
                  pin.count < 1
                )
                  throw fail('corrupt');
                const head = Result.getOrThrow(Bytes.recordHash(pin.head));
                const checked = hasVerifiedCheckpoint(view, { head, length: pin.count });
                if (Result.isFailure(checked) || !checked.success) throw fail('rollback');
              } else if (pin.count !== null) throw fail('corrupt');
              db.prepare('UPDATE protected_key_meta SET head=?,count=? WHERE id=1').run(
                view.head.toBytes(),
                view.length
              );
            })
            .immediate()
        );
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
          const blob = yield* protection.seal(epoch, key);
          yield* sql(() => {
            guard();
            db.prepare(
              'INSERT INTO protected_epoch_keys(epoch,blob) VALUES(?,?) ON CONFLICT(epoch) DO NOTHING'
            ).run(epoch, blob);
          });
          // Completion requires actual readback/decrypt and independently recomputed commitment.
          yield* Effect.acquireUseRelease(
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
