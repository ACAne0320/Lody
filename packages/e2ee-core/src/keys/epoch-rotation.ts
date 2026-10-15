import Database from 'better-sqlite3';
import { closeSync, openSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { Data, Deferred, Effect, Result, Schema, Semaphore } from 'effect';
import * as Bytes from '../bytes';
import { bytesEqual, encodeCbor } from '../cbor';
import { copyEpochKeyBytes, disposeEpochKey } from '../epoch-key';
import { keyId } from '../identifiers';
import {
  decodeRecord,
  epochHistoryPacket,
  hashRecordBytes,
  hasVerifiedCheckpoint,
  requireLedgerContinuation,
  type LedgerView,
} from '../ledger';
import { prepareLedgerRecord, signLedgerRecord } from '../ledger/signing';
import type { DeviceSigner } from '../signing';
import {
  acknowledgeSubmission,
  resumeSubmission,
  SubmissionJournal,
  SubmissionRemote,
  submitRecord,
  type SubmissionResult,
} from '../submission';
import { commitEpochKey, sealHistoryPacket } from './history';
import type { NativeEpochProtector } from './host-protection';
import type { makeSqliteProtectedEpochKeys } from './protected-sqlite';

export class EpochRotationError extends Data.TaggedError('EpochRotationError')<{
  readonly code:
    | 'closed'
    | 'storage'
    | 'corrupt'
    | 'busy'
    | 'unauthorized'
    | 'context-changed'
    | 'candidate-missing'
    | 'native-failed';
}> {}
export interface EpochRotationResult extends SubmissionResult {
  readonly epoch: number;
  /** Binding at this attempt's first successful local installation, not current authority. */
  readonly binding: 'current' | 'historical' | null;
}
const APP = 0x4c455243;
const MAX_BLOB = 24576;
const purpose = new TextEncoder().encode('lody-e2ee/local-epoch-candidate/v1\0');
const HEADER = purpose.length + 32 * 5 + 4 * 3;
const Row = Schema.Struct({
  id: Schema.String,
  parent: Schema.Uint8Array,
  parent_count: Schema.Int,
  epoch: Schema.Int,
  commitment: Schema.Uint8Array,
  record: Schema.Uint8Array,
  blob: Schema.Uint8Array,
  outcome: Schema.NullOr(Schema.Literals(['Committed', 'Conflict'])),
  binding: Schema.NullOr(Schema.Literals(['current', 'historical'])),
  consumed: Schema.Int,
});
const Meta = Schema.Struct({
  genesis: Schema.String,
  publisher: Schema.String,
  head: Schema.NullOr(Schema.Uint8Array),
  count: Schema.NullOr(Schema.Int),
});
type Candidate = typeof Row.Type;
const fail = (code: EpochRotationError['code']) => new EpochRotationError({ code });
const sql = <A>(work: () => A) =>
  Effect.try({
    try: work,
    catch: (error) => (error instanceof EpochRotationError ? error : fail('storage')),
  });
const same = (a: Candidate, b: Candidate) =>
  a.id === b.id &&
  a.parent_count === b.parent_count &&
  a.epoch === b.epoch &&
  bytesEqual(a.parent, b.parent) &&
  bytesEqual(a.commitment, b.commitment) &&
  bytesEqual(a.record, b.record) &&
  bytesEqual(a.blob, b.blob) &&
  a.outcome === b.outcome &&
  a.binding === b.binding &&
  a.consumed === b.consumed;

/** Local publisher recovery, not an independent backup or installed-key protector.
 * The host supplies a separate full-payload protection capability once. Candidate
 * secrets cannot use the installed-key protection port before publication exists.
 * Borrowed ledger refresh must select its own genuine checkpoint and persist its
 * feed before callers acknowledge; this module never invents either authority.
 */
export const makeSqliteEpochRotation = Effect.fnUntraced(function* (input: {
  readonly path: string;
  readonly mode: 'create' | 'open';
  readonly genesis: Bytes.GenesisHash;
  readonly signer: DeviceSigner;
  readonly ledger: () => Effect.Effect<LedgerView, unknown>;
  readonly installed: Effect.Success<ReturnType<typeof makeSqliteProtectedEpochKeys>>;
  readonly protector: NativeEpochProtector;
}) {
  const { path, mode } = input;
  const anchor = yield* Effect.fromResult(Bytes.genesisHash(input.genesis.toBytes()));
  const publicKey = yield* Effect.fromResult(
    Bytes.signingPublicKey(input.signer.publicKey.toBytes())
  );
  const signer = Object.freeze({ publicKey, sign: input.signer.sign.bind(input.signer) });
  const lookup = input.ledger,
    read = input.installed.read.bind(input.installed),
    save = input.installed.saveAndReload.bind(input.installed),
    protect = input.protector.protect.bind(input.protector),
    unprotect = input.protector.unprotect.bind(input.protector);
  const borrowedJournal = yield* SubmissionJournal;
  const journal = SubmissionJournal.of({
    load: borrowedJournal.load.bind(borrowedJournal),
    prepare: borrowedJournal.prepare.bind(borrowedJournal),
    observe: borrowedJournal.observe.bind(borrowedJournal),
    finish: borrowedJournal.finish.bind(borrowedJournal),
    acknowledge: borrowedJournal.acknowledge.bind(borrowedJournal),
  });
  const borrowedRemote = yield* SubmissionRemote;
  const remote = SubmissionRemote.of({
    read: borrowedRemote.read.bind(borrowedRemote),
    appendCas: borrowedRemote.appendCas.bind(borrowedRemote),
  });
  const provide = <A, E>(work: Effect.Effect<A, E, SubmissionJournal | SubmissionRemote>) =>
    work.pipe(
      Effect.provideService(SubmissionJournal, journal),
      Effect.provideService(SubmissionRemote, remote)
    );
  const org = keyId(anchor.toBytes()),
    publisher = keyId(publicKey.toBytes());
  if (typeof path !== 'string' || !isAbsolute(path) || (mode !== 'create' && mode !== 'open'))
    return yield* fail('storage');
  if (mode === 'create') yield* sql(() => closeSync(openSync(path, 'wx', 0o600)));
  const db = yield* Effect.acquireRelease(
    sql(() => new Database(path, { fileMustExist: true, timeout: 1000 })),
    (handle) => sql(() => handle.close()).pipe(Effect.orDie)
  );
  let closed = false,
    observed: LedgerView | undefined;
  const active = new Set<Deferred.Deferred<void>>();
  const serial = yield* Semaphore.make(1);
  const guard = () => {
    if (closed) throw fail('closed');
  };
  const metadata = () => {
    let row: typeof Meta.Type;
    try {
      row = Schema.decodeUnknownSync(Meta)(
        db
          .prepare(`SELECT
        CASE WHEN length(genesis)=64 THEN genesis END AS genesis,
        CASE WHEN length(publisher)=64 THEN publisher END AS publisher,
        CASE WHEN head IS NULL OR length(head)=32 THEN head ELSE x'' END AS head,
        count FROM epoch_rotation_meta WHERE id=1`)
          .get()
      );
    } catch {
      throw fail('corrupt');
    }
    if (
      row.genesis !== org ||
      row.publisher !== publisher ||
      (row.head === null) !== (row.count === null) ||
      (row.head !== null &&
        (row.head.length !== 32 || row.count === null || row.count < 1 || row.count > 0xffffffff))
    )
      throw fail('corrupt');
    return row;
  };
  yield* sql(() => {
    const app = db.pragma('application_id', { simple: true }),
      version = db.pragma('user_version', { simple: true });
    if (mode === 'open' && (app !== APP || version !== 1)) throw fail('corrupt');
    if (
      mode === 'create' &&
      (app !== 0 ||
        version !== 0 ||
        db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().length)
    )
      throw fail('corrupt');
    if (mode === 'open') {
      metadata();
    }
    db.pragma('journal_mode=WAL');
    db.pragma('synchronous=FULL');
    if (mode === 'create')
      db.transaction(() => {
        db.exec(`CREATE TABLE epoch_rotation_meta(id INTEGER PRIMARY KEY CHECK(id=1),genesis TEXT NOT NULL,publisher TEXT NOT NULL,head BLOB,count INTEGER);
        CREATE TABLE epoch_rotation_candidates(id TEXT PRIMARY KEY,parent BLOB NOT NULL,parent_count INTEGER NOT NULL,epoch INTEGER NOT NULL,commitment BLOB NOT NULL,record BLOB NOT NULL,blob BLOB NOT NULL,outcome TEXT,binding TEXT,consumed INTEGER NOT NULL DEFAULT 0 CHECK(consumed IN (0,1)));
        CREATE UNIQUE INDEX epoch_rotation_active ON epoch_rotation_candidates(consumed) WHERE consumed=0;
        PRAGMA application_id=${APP};PRAGMA user_version=1;`);
        db.prepare('INSERT INTO epoch_rotation_meta(id,genesis,publisher) VALUES(1,?,?)').run(
          org,
          publisher
        );
      }).immediate();
  });
  yield* Effect.addFinalizer(() =>
    Effect.gen(function* () {
      closed = true;
      for (const done of active) yield* Deferred.await(done);
    })
  );
  const lease = <A, E, R>(work: Effect.Effect<A, E, R>) =>
    Effect.acquireUseRelease(
      Effect.gen(function* () {
        yield* sql(guard);
        const done = yield* Deferred.make<void>();
        active.add(done);
        return done;
      }),
      () => serial.withPermit(work),
      (done) =>
        Effect.sync(() => {
          active.delete(done);
          Deferred.doneUnsafe(done, Effect.void);
        })
    );
  const current = Effect.fnUntraced(function* () {
    yield* sql(guard);
    const view = yield* lookup();
    yield* sql(guard);
    yield* Effect.fromResult(requireLedgerContinuation(view, view));
    if (!view.genesis.equals(anchor) || view.length > 0xffffffff)
      return yield* fail('context-changed');
    if (observed) yield* Effect.fromResult(requireLedgerContinuation(observed, view));
    // A failed pin write never forgets genuine knowledge in this owner.
    observed = view;
    yield* sql(() =>
      db
        .transaction(() => {
          guard();
          const meta = metadata();
          if (meta.head !== null) {
            if (
              !(meta.head instanceof Uint8Array) ||
              typeof meta.count !== 'number' ||
              !Number.isSafeInteger(meta.count) ||
              meta.count < 1
            )
              throw fail('corrupt');
            const pin = {
              head: Result.getOrThrow(Bytes.recordHash(meta.head)),
              length: meta.count,
            };
            if (!Result.getOrThrow(hasVerifiedCheckpoint(view, pin))) throw fail('context-changed');
          }
          if (
            db
              .prepare('UPDATE epoch_rotation_meta SET head=?,count=? WHERE id=1')
              .run(view.head.toBytes(), view.length).changes !== 1
          )
            throw fail('corrupt');
          const saved = metadata();
          if (
            saved?.genesis !== org ||
            saved.publisher !== publisher ||
            saved.count !== view.length ||
            !(saved.head instanceof Uint8Array) ||
            !bytesEqual(saved.head, view.head.toBytes())
          )
            throw fail('corrupt');
        })
        .immediate()
    );
    return view;
  });
  const checkPin = (view: LedgerView) => {
    const meta = metadata();
    if (
      meta.count !== view.length ||
      meta.head === null ||
      !bytesEqual(meta.head, view.head.toBytes())
    )
      throw fail('corrupt');
  };
  const manager = (view: LedgerView) => {
    const state = view.inspectState(),
      device = state.devices.get(publisher),
      member = device && state.members.get(keyId(device.membershipId.toBytes()));
    if (
      device?.kind !== 'personal' ||
      !member ||
      (member.role !== 'owner' && member.role !== 'admin')
    )
      return Effect.fail(fail('unauthorized'));
    return Effect.void;
  };
  const select = `SELECT CASE WHEN length(id)=64 THEN id END AS id,
    CASE WHEN length(parent)=32 THEN parent END AS parent,parent_count,epoch,
    CASE WHEN length(commitment)=32 THEN commitment END AS commitment,
    CASE WHEN length(record) BETWEEN 1 AND 8192 THEN record END AS record,
    CASE WHEN length(blob) BETWEEN 1 AND ${MAX_BLOB} THEN blob END AS blob,
    outcome,binding,consumed FROM epoch_rotation_candidates`;
  const load = (id?: string): Candidate | null => {
    guard();
    const rows =
      id !== undefined
        ? db.prepare(`${select} WHERE id=?`).all(id)
        : db.prepare(`${select} WHERE consumed=0 LIMIT 2`).all();
    if (!rows.length) return null;
    if (rows.length !== 1) throw fail('corrupt');
    let row: Candidate;
    try {
      row = Schema.decodeUnknownSync(Row)(rows[0]);
    } catch {
      throw fail('corrupt');
    }
    if (
      row.parent.length !== 32 ||
      row.commitment.length !== 32 ||
      row.parent_count < 1 ||
      row.parent_count > 0xffffffff ||
      !Number.isSafeInteger(row.parent_count) ||
      row.epoch < 1 ||
      row.epoch > 0xffffffff ||
      row.record.length < 1 ||
      row.record.length > 8192 ||
      row.blob.length < 1 ||
      row.blob.length > MAX_BLOB ||
      (row.consumed !== 0 && row.consumed !== 1) ||
      row.id !== keyId(hashRecordBytes(row.record).toBytes()) ||
      (row.outcome === null && (row.binding !== null || row.consumed !== 0)) ||
      (row.outcome === 'Committed' && row.binding === null) ||
      (row.outcome === 'Conflict' && row.binding !== null)
    )
      throw fail('corrupt');
    const decoded = Result.getOrThrow(decodeRecord(row.record));
    if (
      decoded.body.type !== 'ordinary' ||
      !decoded.body.signer.equals(publicKey) ||
      !bytesEqual(decoded.body.previousHash.toBytes(), row.parent) ||
      decoded.body.operation.type !== 'publishEpoch' ||
      decoded.body.operation.epoch !== row.epoch ||
      !bytesEqual(decoded.body.operation.commitment.toBytes(), row.commitment)
    )
      throw fail('corrupt');
    return {
      ...row,
      parent: new Uint8Array(row.parent),
      commitment: new Uint8Array(row.commitment),
      record: new Uint8Array(row.record),
      blob: new Uint8Array(row.blob),
    };
  };
  const payload = (row: Candidate, key: Bytes.EpochKey) => {
    const body = new Uint8Array(HEADER + row.record.length + 32),
      cursor = new DataView(body.buffer);
    let at = 0;
    body.set(purpose, at);
    at += purpose.length;
    for (const bytes of [
      anchor.toBytes(),
      publicKey.toBytes(),
      row.parent,
      row.commitment,
      hashRecordBytes(row.record).toBytes(),
    ]) {
      body.set(bytes, at);
      at += 32;
    }
    cursor.setUint32(at, row.parent_count);
    at += 4;
    cursor.setUint32(at, row.epoch);
    at += 4;
    cursor.setUint32(at, row.record.length);
    at += 4;
    body.set(row.record, at);
    at += row.record.length;
    const raw = copyEpochKeyBytes(key);
    try {
      body.set(raw, at);
    } finally {
      raw.fill(0);
    }
    return body;
  };
  const withKey = <A, E, R>(
    row: Candidate,
    work: (key: Bytes.EpochKey) => Effect.Effect<A, E, R>
  ) =>
    Effect.acquireUseRelease(
      Effect.uninterruptible(
        Effect.tryPromise({
          try: () => unprotect(new Uint8Array(row.blob)),
          catch: () => fail('native-failed'),
        })
      ),
      (body) =>
        Effect.gen(function* () {
          if (!(body instanceof Uint8Array) || body.length !== HEADER + row.record.length + 32)
            return yield* fail('corrupt');
          return yield* Effect.acquireUseRelease(
            Effect.fromResult(Bytes.epochKey(body.subarray(body.length - 32))),
            (key) =>
              Effect.gen(function* () {
                const expected = payload(row, key);
                try {
                  if (!bytesEqual(body, expected)) return yield* fail('corrupt');
                } finally {
                  expected.fill(0);
                }
                const committed = yield* Effect.fromResult(commitEpochKey(anchor, row.epoch, key));
                if (!bytesEqual(committed.toBytes(), row.commitment)) return yield* fail('corrupt');
                return yield* work(key);
              }),
            (key) => Effect.sync(() => disposeEpochKey(key))
          );
        }),
      (body) =>
        Effect.sync(() => {
          if (body instanceof Uint8Array) body.fill(0);
        })
    );
  const binding = (view: LedgerView, row: Candidate): 'current' | 'historical' | null => {
    const parent = Result.getOrThrow(Bytes.recordHash(row.parent));
    if (!Result.getOrThrow(hasVerifiedCheckpoint(view, { head: parent, length: row.parent_count })))
      throw fail('context-changed');
    if (
      !Result.getOrThrow(
        hasVerifiedCheckpoint(view, {
          head: hashRecordBytes(row.record),
          length: row.parent_count + 1,
        })
      )
    )
      return null;
    const packet = Result.getOrThrow(epochHistoryPacket(view, row.epoch));
    const record = Result.getOrThrow(decodeRecord(row.record));
    if (
      record.body.type !== 'ordinary' ||
      record.body.operation.type !== 'publishEpoch' ||
      !bytesEqual(packet.commitment.toBytes(), row.commitment) ||
      !bytesEqual(packet.packet, record.body.operation.previousEpochKey)
    )
      throw fail('corrupt');
    return view.inspectState().epoch.number === row.epoch ? 'current' : 'historical';
  };
  const result = (row: Candidate): EpochRotationResult | null =>
    row.outcome
      ? {
          outcome: row.outcome,
          record: new Uint8Array(row.record),
          epoch: row.epoch,
          binding: row.binding,
        }
      : null;
  const confirm = Effect.fnUntraced(function* (
    row: Candidate,
    outcome: 'Committed' | 'Conflict',
    key: Bytes.EpochKey
  ) {
    const view = yield* current();
    const bound = yield* sql(() => binding(view, row));
    if (outcome === 'Committed') {
      if (!bound) return yield* fail('context-changed');
      yield* save(row.epoch, key);
      yield* Effect.acquireUseRelease(
        read(row.epoch),
        (installed) =>
          Effect.gen(function* () {
            const commitment = yield* Effect.fromResult(
              commitEpochKey(anchor, row.epoch, installed)
            );
            if (!bytesEqual(commitment.toBytes(), row.commitment)) return yield* fail('corrupt');
            return undefined;
          }),
        (installed) => Effect.sync(() => disposeEpochKey(installed))
      );
    } else if (bound || view.length <= row.parent_count) return yield* fail('context-changed');
    // Binding reports the first confirmed local installation. A later epoch must
    // not invalidate acknowledgement of the same durable original/result.
    const next = { ...row, outcome, binding: row.outcome ? row.binding : bound };
    if (row.outcome && row.outcome !== outcome) return yield* fail('corrupt');
    yield* sql(() =>
      db
        .transaction(() => {
          const before = load(row.id);
          if (!before || !same(before, row)) throw fail('busy');
          if (
            db
              .prepare(
                'UPDATE epoch_rotation_candidates SET outcome=?,binding=? WHERE id=? AND consumed=0'
              )
              .run(outcome, next.binding, row.id).changes !== 1
          )
            throw fail('corrupt');
          const after = load(row.id);
          if (!after || !same(after, next)) throw fail('corrupt');
          checkPin(view);
        })
        .immediate()
    );
    return result(next)!;
  });
  const settle = (row: Candidate) =>
    withKey(row, (key) =>
      Effect.gen(function* () {
        const view = yield* current();
        yield* sql(() => {
          binding(view, row);
        });
        const entry = yield* journal.load(anchor);
        if (entry.record && !bytesEqual(entry.record, row.record)) return yield* fail('busy');
        if (row.outcome && !entry.record) return yield* confirm(row, row.outcome, key);
        const submitted = entry.record
          ? yield* provide(resumeSubmission(anchor))
          : yield* provide(submitRecord(anchor, row.record));
        if (!submitted || !bytesEqual(submitted.record, row.record)) return yield* fail('corrupt');
        return yield* confirm(row, submitted.outcome, key);
      })
    );
  const resume = Effect.fnUntraced(function* () {
    yield* current();
    const row = yield* sql(() => load());
    if (row) return yield* settle(row);
    const entry = yield* journal.load(anchor);
    if (entry.record) {
      const decoded = yield* Effect.fromResult(decodeRecord(entry.record));
      if (decoded.body.type === 'ordinary' && decoded.body.operation.type === 'publishEpoch')
        return yield* fail('candidate-missing');
    }
    return null;
  });
  const publish = Effect.fnUntraced(function* () {
    const view = yield* current();
    const existing = yield* sql(() => load());
    if (existing) return yield* settle(existing);
    const pending = yield* journal.load(anchor);
    if (pending.record) {
      const decoded = yield* Effect.fromResult(decodeRecord(pending.record));
      return yield* fail(
        decoded.body.type === 'ordinary' && decoded.body.operation.type === 'publishEpoch'
          ? 'candidate-missing'
          : 'busy'
      );
    }
    yield* manager(view);
    const state = view.inspectState(),
      epoch = yield* Effect.fromResult(Bytes.epochNumber(state.epoch.number + 1));
    return yield* Effect.acquireUseRelease(
      read(state.epoch.number),
      (previous) =>
        Effect.acquireUseRelease(
          sql(() => {
            const raw = globalThis.crypto.getRandomValues(new Uint8Array(32));
            try {
              return Result.getOrThrow(Bytes.epochKey(raw));
            } finally {
              raw.fill(0);
            }
          }),
          (key) =>
            Effect.gen(function* () {
              const old = yield* Effect.fromResult(
                commitEpochKey(anchor, state.epoch.number, previous)
              );
              if (!old.equals(state.epoch.keyCommitment)) return yield* fail('corrupt');
              const commitment = yield* Effect.fromResult(commitEpochKey(anchor, epoch, key)),
                packet = yield* Effect.fromResult(
                  sealHistoryPacket({
                    genesis: anchor,
                    epoch,
                    currentKey: key,
                    previousKey: previous,
                  })
                );
              const body = yield* Effect.fromResult(
                encodeCbor([
                  view.head.toBytes(),
                  publicKey.toBytes(),
                  [7, epoch, commitment.toBytes(), packet],
                ])
              );
              const proposal = yield* Effect.fromResult(prepareLedgerRecord(view, body));
              const record = yield* signLedgerRecord(proposal, signer);
              let row: Candidate = {
                id: keyId(hashRecordBytes(record).toBytes()),
                parent: view.head.toBytes(),
                parent_count: view.length,
                epoch,
                commitment: commitment.toBytes(),
                record,
                blob: new Uint8Array(),
                outcome: null,
                binding: null,
                consumed: 0,
              };
              const blob = yield* Effect.acquireUseRelease(
                sql(() => payload(row, key)),
                (raw) =>
                  Effect.uninterruptible(
                    Effect.tryPromise({
                      try: () => protect(raw),
                      catch: () => fail('native-failed'),
                    })
                  ).pipe(
                    Effect.flatMap((output) =>
                      output instanceof Uint8Array && output.length > 0 && output.length <= MAX_BLOB
                        ? Effect.succeed(new Uint8Array(output))
                        : Effect.fail(fail('corrupt'))
                    )
                  ),
                (raw) => Effect.sync(() => raw.fill(0))
              );
              row = { ...row, blob };
              const now = yield* current();
              yield* manager(now);
              if (!now.head.equals(view.head) || now.length !== view.length)
                return yield* fail('context-changed');
              yield* sql(() =>
                db
                  .transaction(() => {
                    if (load()) throw fail('busy');
                    if (
                      db
                        .prepare(
                          'INSERT INTO epoch_rotation_candidates(id,parent,parent_count,epoch,commitment,record,blob,consumed) VALUES(?,?,?,?,?,?,?,0)'
                        )
                        .run(
                          row.id,
                          row.parent,
                          row.parent_count,
                          row.epoch,
                          row.commitment,
                          row.record,
                          row.blob
                        ).changes !== 1
                    )
                      throw fail('corrupt');
                    const stored = load(row.id);
                    if (!stored || !same(stored, row)) throw fail('corrupt');
                    checkPin(now);
                  })
                  .immediate()
              );
              // Actual stored blob must open before the first submission can begin.
              const stored = yield* sql(() => load(row.id));
              if (!stored) return yield* fail('corrupt');
              return yield* settle(stored);
            }),
          (key) => Effect.sync(() => disposeEpochKey(key))
        ),
      (previous) => Effect.sync(() => disposeEpochKey(previous))
    );
  });
  const acknowledge = (expected: EpochRotationResult) =>
    Effect.gen(function* () {
      const original = (yield* Effect.fromResult(decodeRecord(expected.record))).recordBytes;
      const id = keyId(hashRecordBytes(original).toBytes()),
        row = yield* sql(() => load(id));
      if (
        !row ||
        !row.outcome ||
        row.outcome !== expected.outcome ||
        row.epoch !== expected.epoch ||
        row.binding !== expected.binding
      )
        return yield* fail('corrupt');
      if (row.consumed === 1) return undefined;
      const checked = yield* settle(row);
      if (checked.outcome !== expected.outcome || checked.binding !== expected.binding)
        return yield* fail('corrupt');
      const entry = yield* journal.load(anchor);
      if (entry.record) {
        if (!bytesEqual(entry.record, original) || entry.outcome !== expected.outcome)
          return yield* fail('busy');
        yield* provide(
          acknowledgeSubmission(anchor, { outcome: expected.outcome, record: original })
        );
      }
      const view = yield* current();
      yield* sql(() =>
        db
          .transaction(() => {
            const before = load(id);
            if (!before || !same(before, row)) throw fail('busy');
            if (
              db
                .prepare(
                  'UPDATE epoch_rotation_candidates SET consumed=1 WHERE id=? AND consumed=0'
                )
                .run(id).changes !== 1
            )
              throw fail('corrupt');
            const after = load(id);
            if (!after || !same(after, { ...row, consumed: 1 })) throw fail('corrupt');
            checkPin(view);
          })
          .immediate()
      );
      return undefined;
    });
  return Object.freeze({
    publish: () => lease(publish()),
    resume: () => lease(resume()),
    /** Local original/result history only. Use resume to reconcile remote authority. */
    result: () =>
      lease(
        sql(() => {
          const row = load();
          return row ? result(row) : null;
        })
      ),
    acknowledge: (expected: EpochRotationResult) =>
      lease(acknowledge({ ...expected, record: new Uint8Array(expected.record) })),
  });
});
