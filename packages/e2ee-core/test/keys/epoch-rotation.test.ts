import Database from 'better-sqlite3';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Context, Deferred, Effect, Exit, Fiber, Layer, Result, Scope } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';
import * as Bytes from '../../src/bytes';
import { encodeCbor } from '../../src/cbor';
import { disposeEpochKey } from '../../src/epoch-key';
import { extendLedger, hashRecordBytes, type LedgerView } from '../../src/ledger';
import { prepareLedgerRecord, signLedgerRecord } from '../../src/ledger/signing';
import { SubmissionJournal, SubmissionRemote, SubmissionRemoteError } from '../../src/submission';
import { sqliteSubmissionJournal } from '../../src/submission/sqlite';
import { makeSqliteEpochRotation } from '../../src/keys/epoch-rotation';
import { commitEpochKey, sealHistoryPacket } from '../../src/keys/history';
import { makeSqliteProtectedEpochKeys } from '../../src/keys/protected-sqlite';
import { envelopeFixture } from './fixture';
import { synthetic } from './protection-fixture';
const ok = Result.getOrThrow;
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function fixture(kind: 0 | 1 | 2 = 0) {
  const f = envelopeFixture(kind),
    native = synthetic();
  const dir = mkdtempSync(path.join(tmpdir(), 'e2ee-epoch-rotation-'));
  dirs.push(dir);
  const files = {
    candidate: path.join(dir, 'candidate.sqlite'),
    keys: path.join(dir, 'keys.sqlite'),
    journal: path.join(dir, 'journal.sqlite'),
    history: path.join(dir, 'history.json'),
  };
  let view = f.view(),
    records = f.records(),
    mode: 'ok' | 'unavailable' | 'lost-ack' = 'ok',
    signed = 0;
  const persist = () =>
    writeFileSync(
      files.history,
      JSON.stringify(records.map((r) => Buffer.from(r).toString('hex')))
    );
  persist();
  const append = (record: Uint8Array) => {
    view = ok(
      extendLedger(view, [record], { head: hashRecordBytes(record), length: view.length + 1 })
    );
    records.push(new Uint8Array(record));
    persist();
  };
  const lookup = () => Effect.sync(() => view);
  const remote = SubmissionRemote.of({
    read: () =>
      Effect.sync(() => ({
        records: records.map((r) => new Uint8Array(r)),
        checkpoint: { head: view.head, length: view.length },
      })),
    appendCas: (_anchor, expected, record) =>
      Effect.suspend(() => {
        // Observe both actual durable originals at the transport boundary, not
        // only the eventual result after publication has already happened.
        expect(row()?.record).toEqual(Buffer.from(record));
        const journalDb = new Database(files.journal);
        try {
          const pending = journalDb.prepare('SELECT pending FROM submission_journal').get() as {
            pending: Buffer;
          };
          expect(pending.pending).toEqual(Buffer.from(record));
        } finally {
          journalDb.close();
        }
        const candidatePurpose = new TextEncoder().encode('lody-e2ee/local-epoch-candidate/v1\0');
        expect(
          native.plains.some(
            (plain) =>
              plain.length > candidatePurpose.length &&
              plain
                .subarray(0, candidatePurpose.length)
                .every((value, index) => value === candidatePurpose[index])
          )
        ).toBe(true);
        if (mode === 'unavailable') return Effect.fail(new SubmissionRemoteError());
        if (!view.head.equals(expected.head) || view.length !== expected.length)
          return Effect.fail(new SubmissionRemoteError());
        append(record);
        return mode === 'lost-ack' ? Effect.fail(new SubmissionRemoteError()) : Effect.void;
      }),
  });
  const signer = {
    publicKey: f.owner.publicKey,
    sign: (message: Uint8Array) =>
      Effect.sync(() => {
        signed++;
      }).pipe(Effect.andThen(f.owner.signer.sign(message))),
  };
  const open = Effect.fnUntraced(function* (
    openMode: 'create' | 'open' = 'create',
    options: {
      signer?: typeof signer;
      native?: typeof native.protector;
      lookup?: () => Effect.Effect<LedgerView, unknown>;
    } = {}
  ) {
    const ledger = options.lookup ?? lookup;
    const installed = yield* makeSqliteProtectedEpochKeys({
      path: files.keys,
      mode: openMode,
      genesis: f.context.genesis,
      recipient: f.owner.publicKey,
      ledger,
      protector: native.protector,
    });
    if (openMode === 'create') yield* installed.saveAndReload(0, f.secret);
    const context = yield* Layer.build(sqliteSubmissionJournal(files.journal)),
      journal = Context.get(context, SubmissionJournal);
    const rotation = yield* makeSqliteEpochRotation({
      path: files.candidate,
      mode: openMode,
      genesis: f.context.genesis,
      signer: options.signer ?? signer,
      ledger,
      installed,
      protector: options.native ?? native.protector,
    }).pipe(
      Effect.provideService(SubmissionJournal, journal),
      Effect.provideService(SubmissionRemote, remote)
    );
    return { rotation, installed, journal };
  });
  const row = () => {
    const db = new Database(files.candidate);
    try {
      return db
        .prepare('SELECT * FROM epoch_rotation_candidates ORDER BY rowid DESC LIMIT 1')
        .get() as
        | { record: Buffer; blob: Buffer; outcome: string | null; consumed: number; epoch: number }
        | undefined;
    } finally {
      db.close();
    }
  };
  return {
    ...f,
    files,
    native,
    lookup,
    remote,
    open,
    row,
    append,
    view: () => view,
    records: () => records.map((r) => new Uint8Array(r)),
    mode: (next: typeof mode) => {
      mode = next;
    },
    signed: () => signed,
  };
}
const failureCode = (exit: Exit.Exit<unknown, unknown>, code: string) => {
  expect(Exit.isFailure(exit)).toBe(true);
  if (Exit.isFailure(exit)) expect(JSON.stringify(exit.cause)).toContain(code);
};
describe('durable local epoch rotation', () => {
  it('persists and actually opens one candidate before CAS; lost ACK keeps original and explicit ACK releases the next epoch', async () => {
    const f = fixture();
    f.mode('lost-ack');
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const { rotation, installed, journal } = yield* f.open();
          const result = yield* rotation.publish();
          expect(result).toMatchObject({ outcome: 'Committed', epoch: 1, binding: 'current' });
          const first = f.row()!;
          expect(first.record).toEqual(Buffer.from(result.record));
          expect(first.outcome).toBe('Committed');
          expect(first.consumed).toBe(0);
          expect(f.signed()).toBe(1);
          const key = yield* installed.read(1);
          expect(ok(commitEpochKey(f.context.genesis, 1, key))).toEqual(
            f.view().inspectState().epoch.keyCommitment
          );
          disposeEpochKey(key);
          expect((yield* journal.load(f.context.genesis)).record).toEqual(result.record);
          const again = yield* rotation.publish();
          expect(again?.record).toEqual(result.record);
          expect(f.signed()).toBe(1);
          yield* rotation.acknowledge(result!);
          expect(f.row()!.consumed).toBe(1);
          expect((yield* journal.load(f.context.genesis)).record).toBeNull();
          f.mode('ok');
          const next = yield* rotation.publish();
          expect(next).toMatchObject({ outcome: 'Committed', epoch: 2 });
          expect(f.signed()).toBe(2);
          expect(f.native.plains.every((buffer) => buffer.every((byte) => byte === 0))).toBe(true);
          const db = new Database(f.files.candidate);
          try {
            expect(db.prepare('SELECT count(*) AS n FROM epoch_rotation_candidates').get()).toEqual(
              { n: 2 }
            );
          } finally {
            db.close();
          }
        })
      )
    );
  });
  it('failed transport and process reopen use original bytes without a usable signer, then retain originals after ACK', async () => {
    const f = fixture();
    f.mode('unavailable');
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const { rotation } = yield* f.open();
          failureCode(yield* Effect.exit(rotation.publish()), 'unconfirmed');
        })
      )
    );
    const before = f.row()!;
    expect(before.outcome).toBeNull();
    expect(f.signed()).toBe(1);
    expect(f.records()).toHaveLength(2);
    const config = path.join(path.dirname(f.files.candidate), 'child.json');
    writeFileSync(
      config,
      JSON.stringify({
        genesis: Buffer.from(f.context.genesis.toBytes()).toString('hex'),
        publisher: Buffer.from(f.owner.publicKey.toBytes()).toString('hex'),
        files: f.files,
        initial: f.records().map((r) => Buffer.from(r).toString('hex')),
        candidate: before.record.toString('hex'),
      }),
      { mode: 0o600 }
    );
    const child = spawnSync(
      process.execPath,
      ['--import', 'tsx', fileURLToPath(new URL('./rotation-reopen.mts', import.meta.url)), config],
      { cwd: fileURLToPath(new URL('../..', import.meta.url)), encoding: 'utf8' }
    );
    expect(child.status, child.stderr).toBe(0);
    const output = JSON.parse(child.stdout.trim());
    expect(output).toMatchObject({ outcome: 'Committed', epoch: 1, signed: 0, consumed: 1 });
    expect(output.record).toBe(before.record.toString('hex'));
    const after = f.row()!;
    expect(after.record).toEqual(before.record);
    expect(after.blob).toEqual(before.blob);
    expect(after.consumed).toBe(1);
    expect(JSON.parse(readFileSync(f.files.history, 'utf8'))).toHaveLength(3);
  });
  it('candidate SQL IGNORE and rewrite roll back before submitting; original installation failure resumes safely', async () => {
    const f = fixture();
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const { rotation } = yield* f.open();
          const db = new Database(f.files.candidate);
          try {
            db.exec(
              'CREATE TRIGGER ignore_candidate BEFORE INSERT ON epoch_rotation_candidates BEGIN SELECT RAISE(IGNORE);END'
            );
            failureCode(yield* Effect.exit(rotation.publish()), 'corrupt');
            expect(f.row()).toBeUndefined();
            expect(f.records()).toHaveLength(2);
            db.exec(
              'DROP TRIGGER ignore_candidate;CREATE TRIGGER rewrite_candidate AFTER INSERT ON epoch_rotation_candidates BEGIN UPDATE epoch_rotation_candidates SET epoch=99 WHERE id=NEW.id;END'
            );
            failureCode(yield* Effect.exit(rotation.publish()), 'corrupt');
            expect(f.row()).toBeUndefined();
            expect(f.records()).toHaveLength(2);
            db.exec('DROP TRIGGER rewrite_candidate');
            const keydb = new Database(f.files.keys);
            try {
              keydb.exec(
                'CREATE TRIGGER ignore_install BEFORE INSERT ON protected_epoch_keys WHEN NEW.epoch=1 BEGIN SELECT RAISE(IGNORE);END'
              );
              failureCode(yield* Effect.exit(rotation.publish()), 'missing-key');
              const original = f.row()!;
              expect(original.outcome).toBeNull();
              expect(f.records()).toHaveLength(3);
              const signed = f.signed();
              keydb.exec('DROP TRIGGER ignore_install');
              const done = yield* rotation.resume();
              expect(done?.record).toEqual(new Uint8Array(original.record));
              expect(f.signed()).toBe(signed);
            } finally {
              keydb.close();
            }
          } finally {
            db.close();
          }
        })
      )
    );
  });
  it('Conflict never installs the losing secret and permits a new candidate only after explicit ACK', async () => {
    const f = fixture();
    f.mode('unavailable');
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const { rotation, installed } = yield* f.open();
          yield* Effect.exit(rotation.publish());
          const original = f.row()!;
          const view = f.view(),
            body = ok(
              encodeCbor([view.head.toBytes(), f.owner.publicKey.toBytes(), [5, f.phone.raw]])
            );
          const competitor = yield* signLedgerRecord(
            ok(prepareLedgerRecord(view, body)),
            f.owner.signer
          );
          f.append(competitor);
          const conflict = yield* rotation.resume();
          expect(conflict).toMatchObject({ outcome: 'Conflict', epoch: 1, binding: null });
          expect(conflict?.record).toEqual(new Uint8Array(original.record));
          failureCode(yield* Effect.exit(installed.read(1)), 'missing-key');
          expect(f.signed()).toBe(1);
          yield* rotation.acknowledge(conflict!);
          f.mode('ok');
          expect(yield* rotation.publish()).toMatchObject({ outcome: 'Committed', epoch: 1 });
          expect(f.signed()).toBe(2);
        })
      )
    );
  });
  it('a confirmed candidate may install historically and later epoch advancement does not invalidate its original ACK', async () => {
    const f = fixture();
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const { rotation, installed } = yield* f.open();
          const first = yield* rotation.publish();
          const key1 = yield* installed.read(1),
            raw = new Uint8Array(32).fill(72),
            key2 = ok(Bytes.epochKey(raw));
          raw.fill(0);
          try {
            const commitment = ok(commitEpochKey(f.context.genesis, 2, key2)),
              packet = ok(
                sealHistoryPacket({
                  genesis: f.context.genesis,
                  epoch: 2,
                  currentKey: key2,
                  previousKey: key1,
                })
              ),
              view = f.view();
            const body = ok(
              encodeCbor([
                view.head.toBytes(),
                f.owner.publicKey.toBytes(),
                [7, 2, commitment.toBytes(), packet],
              ])
            );
            f.append(yield* signLedgerRecord(ok(prepareLedgerRecord(view, body)), f.owner.signer));
            const resumed = yield* rotation.resume();
            expect(resumed?.record).toEqual(first!.record);
            expect(f.view().inspectState().epoch.number).toBe(2);
            yield* rotation.acknowledge(first!);
            expect(f.row()!.consumed).toBe(1);
          } finally {
            disposeEpochKey(key1);
            disposeEpochKey(key2);
          }
        })
      )
    );
  });
  it('ACK failure preserves original candidate after P09 consumption and is safely repeatable', async () => {
    const f = fixture();
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const { rotation, journal } = yield* f.open();
          const done = yield* rotation.publish(),
            original = f.row()!;
          const db = new Database(f.files.candidate);
          try {
            db.exec(
              'CREATE TRIGGER ignore_ack BEFORE UPDATE OF consumed ON epoch_rotation_candidates BEGIN SELECT RAISE(IGNORE);END'
            );
            failureCode(yield* Effect.exit(rotation.acknowledge(done!)), 'corrupt');
            expect((yield* journal.load(f.context.genesis)).record).toBeNull();
            expect(f.row()!.consumed).toBe(0);
            expect(f.row()!.blob).toEqual(original.blob);
            db.exec('DROP TRIGGER ignore_ack');
            yield* rotation.acknowledge(done!);
            yield* rotation.acknowledge(done!);
            expect(f.row()!.consumed).toBe(1);
            expect(f.signed()).toBe(1);
          } finally {
            db.close();
          }
        })
      )
    );
  });
  it('two handles elect one immutable candidate; the losing first attempt never submits and retries only the winner', async () => {
    const f = fixture();
    f.mode('unavailable');
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const entered = yield* Deferred.make<void>(),
            release = yield* Deferred.make<void>();
          yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined));
          const delayed = {
            ...f.native.protector,
            protect: async (body: Uint8Array) => {
              Deferred.doneUnsafe(entered, Effect.void);
              await Effect.runPromise(Deferred.await(release));
              return f.native.protector.protect(body);
            },
          };
          const first = yield* f.open('create', { native: delayed }),
            other = yield* f.open('open');
          const publishing = yield* Effect.exit(first.rotation.publish()).pipe(Effect.forkChild);
          yield* Deferred.await(entered);
          failureCode(yield* Effect.exit(other.rotation.publish()), 'unconfirmed');
          const winner = f.row()!;
          expect(f.signed()).toBe(2);
          yield* Deferred.succeed(release, undefined);
          failureCode(yield* Fiber.join(publishing), 'busy');
          expect(f.row()!.record).toEqual(winner.record);
          expect(f.row()!.blob).toEqual(winner.blob);
          expect(f.records()).toHaveLength(2);
          f.mode('ok');
          expect(yield* first.rotation.publish()).toMatchObject({ outcome: 'Committed', epoch: 1 });
          expect(f.row()!.record).toEqual(winner.record);
          expect(f.signed()).toBe(2);
          expect(f.records()).toHaveLength(3);
        })
      )
    );
  });
  it('first local confirmation may be historical without rolling back the genuine current epoch', async () => {
    const f = fixture();
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const { rotation } = yield* f.open(),
            db = new Database(f.files.keys);
          try {
            db.exec(
              'CREATE TRIGGER hold_install BEFORE INSERT ON protected_epoch_keys WHEN NEW.epoch=1 BEGIN SELECT RAISE(IGNORE);END'
            );
            failureCode(yield* Effect.exit(rotation.publish()), 'missing-key');
            const original = f.row()!;
            const plain = yield* Effect.promise(() =>
                f.native.protector.unprotect(new Uint8Array(original.blob))
              ),
              key1 = ok(Bytes.epochKey(plain.subarray(-32)));
            plain.fill(0);
            const raw = new Uint8Array(32).fill(61),
              key2 = ok(Bytes.epochKey(raw));
            raw.fill(0);
            try {
              const commitment = ok(commitEpochKey(f.context.genesis, 2, key2)),
                packet = ok(
                  sealHistoryPacket({
                    genesis: f.context.genesis,
                    epoch: 2,
                    currentKey: key2,
                    previousKey: key1,
                  })
                ),
                view = f.view(),
                body = ok(
                  encodeCbor([
                    view.head.toBytes(),
                    f.owner.publicKey.toBytes(),
                    [7, 2, commitment.toBytes(), packet],
                  ])
                );
              f.append(
                yield* signLedgerRecord(ok(prepareLedgerRecord(view, body)), f.owner.signer)
              );
              db.exec('DROP TRIGGER hold_install');
              const result = yield* rotation.resume();
              expect(result).toMatchObject({
                outcome: 'Committed',
                epoch: 1,
                binding: 'historical',
              });
              expect(f.view().inspectState().epoch.number).toBe(2);
              expect(result?.record).toEqual(new Uint8Array(original.record));
              yield* rotation.acknowledge(result!);
            } finally {
              disposeEpochKey(key1);
              disposeEpochKey(key2);
            }
          } finally {
            db.close();
          }
        })
      )
    );
  });
  it('terminal and ACK field rewrites roll back, preserving the exact candidate and safe retries', async () => {
    const f = fixture();
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const { rotation } = yield* f.open(),
            db = new Database(f.files.candidate);
          try {
            db.exec(
              'CREATE TRIGGER change_terminal AFTER UPDATE OF outcome ON epoch_rotation_candidates BEGIN UPDATE epoch_rotation_candidates SET consumed=1 WHERE id=NEW.id;END'
            );
            failureCode(yield* Effect.exit(rotation.publish()), 'corrupt');
            const original = f.row()!;
            expect(original.outcome).toBeNull();
            expect(original.consumed).toBe(0);
            expect(f.records()).toHaveLength(3);
            db.exec('DROP TRIGGER change_terminal');
            const result = yield* rotation.resume();
            expect(result?.record).toEqual(new Uint8Array(original.record));
            db.exec(
              'CREATE TRIGGER change_ack AFTER UPDATE OF consumed ON epoch_rotation_candidates BEGIN UPDATE epoch_rotation_candidates SET parent_count=99 WHERE id=NEW.id;END'
            );
            failureCode(yield* Effect.exit(rotation.acknowledge(result!)), 'corrupt');
            expect(f.row()!.consumed).toBe(0);
            expect(f.row()!.record).toEqual(original.record);
            expect(f.row()!.blob).toEqual(original.blob);
            db.exec('DROP TRIGGER change_ack');
            yield* rotation.acknowledge(result!);
            expect(f.row()!.consumed).toBe(1);
            expect(f.signed()).toBe(1);
          } finally {
            db.close();
          }
        })
      )
    );
  });
  it('candidate native readback failure never reaches CAS and retains the first protected original for explicit retry', async () => {
    const f = fixture();
    let refuse = true;
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const native = {
            ...f.native.protector,
            unprotect: async (blob: Uint8Array) => {
              if (refuse) throw Error('host temporarily unavailable');
              return f.native.protector.unprotect(blob);
            },
          };
          const { rotation, journal } = yield* f.open('create', { native });
          failureCode(yield* Effect.exit(rotation.publish()), 'native-failed');
          const original = f.row()!;
          expect(original.outcome).toBeNull();
          expect((yield* journal.load(f.context.genesis)).record).toBeNull();
          expect(f.records()).toHaveLength(2);
          refuse = false;
          expect(yield* rotation.publish()).toMatchObject({ outcome: 'Committed', epoch: 1 });
          expect(f.row()!.blob).toEqual(original.blob);
          expect(f.row()!.record).toEqual(original.record);
          expect(f.signed()).toBe(1);
          expect(f.native.plains.every((buffer) => buffer.every((byte) => byte === 0))).toBe(true);
        })
      )
    );
  });
  it('final outcome and ACK transactions reject ignored writes and metadata rewrites after the candidate update', async () => {
    for (const fault of ['ignore', 'metadata'] as const) {
      const f = fixture();
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const { rotation, journal } = yield* f.open(),
              db = new Database(f.files.candidate);
            try {
              db.exec(
                fault === 'ignore'
                  ? 'CREATE TRIGGER terminal_fault BEFORE UPDATE OF outcome ON epoch_rotation_candidates BEGIN SELECT RAISE(IGNORE);END'
                  : `CREATE TRIGGER terminal_fault AFTER UPDATE OF outcome ON epoch_rotation_candidates BEGIN UPDATE epoch_rotation_meta SET genesis='${'00'.repeat(32)}' WHERE id=1;END`
              );
              failureCode(yield* Effect.exit(rotation.publish()), 'corrupt');
              const original = f.row()!;
              expect(original.outcome).toBeNull();
              expect(original.consumed).toBe(0);
              expect(db.prepare('SELECT genesis FROM epoch_rotation_meta').get()).toEqual({
                genesis: Buffer.from(f.context.genesis.toBytes()).toString('hex'),
              });
              expect(f.records()).toHaveLength(3);
              db.exec('DROP TRIGGER terminal_fault');
              const done = yield* rotation.resume();
              expect(done?.record).toEqual(new Uint8Array(original.record));
              db.exec(
                fault === 'ignore'
                  ? 'CREATE TRIGGER ack_fault BEFORE UPDATE OF consumed ON epoch_rotation_candidates BEGIN SELECT RAISE(IGNORE);END'
                  : `CREATE TRIGGER ack_fault AFTER UPDATE OF consumed ON epoch_rotation_candidates BEGIN UPDATE epoch_rotation_meta SET publisher='${'00'.repeat(32)}' WHERE id=1;END`
              );
              failureCode(yield* Effect.exit(rotation.acknowledge(done!)), 'corrupt');
              expect((yield* journal.load(f.context.genesis)).record).toBeNull();
              expect(f.row()!.consumed).toBe(0);
              expect(f.row()!.blob).toEqual(original.blob);
              expect(db.prepare('SELECT publisher FROM epoch_rotation_meta').get()).toEqual({
                publisher: Buffer.from(f.owner.publicKey.toBytes()).toString('hex'),
              });
              db.exec('DROP TRIGGER ack_fault');
              yield* rotation.acknowledge(done!);
              expect(f.row()!.consumed).toBe(1);
              expect(f.signed()).toBe(1);
            } finally {
              db.close();
            }
          })
        )
      );
    }
  });
  it('rejects Recovery/machine and known rollback before random/signing or submission', async () => {
    for (const kind of [1, 2] as const) {
      const f = fixture(kind);
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const { journal } = yield* f.open();
            const installed = yield* makeSqliteProtectedEpochKeys({
              path: path.join(path.dirname(f.files.keys), 'other.sqlite'),
              mode: 'create',
              genesis: f.context.genesis,
              recipient: f.phone.publicKey,
              ledger: f.lookup,
              protector: f.native.protector,
            });
            yield* installed.saveAndReload(0, f.secret);
            const rotation = yield* makeSqliteEpochRotation({
              path: path.join(path.dirname(f.files.candidate), 'other-candidate.sqlite'),
              mode: 'create',
              genesis: f.context.genesis,
              signer: f.phone.signer,
              ledger: f.lookup,
              installed,
              protector: f.native.protector,
            }).pipe(
              Effect.provideService(SubmissionJournal, journal),
              Effect.provideService(SubmissionRemote, f.remote)
            );
            failureCode(yield* Effect.exit(rotation.publish()), 'unauthorized');
            expect(f.records()).toHaveLength(2);
          })
        )
      );
    }
    const f = fixture();
    let selected = f.view();
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const { rotation } = yield* f.open('create', {
            lookup: () => Effect.sync(() => selected),
          });
          f.mode('unavailable');
          yield* Effect.exit(rotation.publish());
          const before = selected,
            body = ok(
              encodeCbor([before.head.toBytes(), f.owner.publicKey.toBytes(), [5, f.phone.raw]])
            );
          f.append(yield* signLedgerRecord(ok(prepareLedgerRecord(before, body)), f.owner.signer));
          selected = f.view();
          const db = new Database(f.files.candidate);
          try {
            db.exec(
              'CREATE TRIGGER ignore_pin BEFORE UPDATE ON epoch_rotation_meta BEGIN SELECT RAISE(IGNORE);END'
            );
            failureCode(yield* Effect.exit(rotation.resume()), 'corrupt');
            expect(db.prepare('SELECT count FROM epoch_rotation_meta').get()).toEqual({ count: 2 });
            selected = before;
            failureCode(yield* Effect.exit(rotation.resume()), 'checkpoint-mismatch');
            db.exec('DROP TRIGGER ignore_pin');
            selected = f.view();
            expect(yield* rotation.resume()).toMatchObject({ outcome: 'Conflict' });
            expect(f.signed()).toBe(1);
          } finally {
            db.close();
          }
        })
      )
    );
  });
  it('Scope close waits for real native protection settlement, wipes plaintext and rejects late persistence', async () => {
    const f = fixture();
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const entered = yield* Deferred.make<void>(),
            release = yield* Deferred.make<void>(),
            closed = yield* Deferred.make<void>();
          let nativeBody: Uint8Array | undefined;
          const child = yield* Scope.make();
          yield* Effect.addFinalizer(() =>
            Deferred.succeed(release, undefined).pipe(Effect.andThen(Scope.close(child, Exit.void)))
          );
          const native = {
            ...f.native.protector,
            protect: async (body: Uint8Array) => {
              nativeBody = body;
              Deferred.doneUnsafe(entered, Effect.void);
              await Effect.runPromise(Deferred.await(release));
              return f.native.protector.protect(body);
            },
          };
          const { rotation } = yield* f
            .open('create', { native })
            .pipe(Effect.provideService(Scope.Scope, child));
          const publishing = yield* rotation.publish().pipe(Effect.forkChild);
          yield* Deferred.await(entered);
          const closing = yield* Scope.close(child, Exit.void).pipe(
            Effect.andThen(Deferred.succeed(closed, undefined)),
            Effect.forkChild({ startImmediately: true })
          );
          // Register after both child fibers: even a failed pre-release assertion
          // releases the native gate before their owning finalizers await them.
          yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined));
          // Effect's immediate start runs admission close through its first awaited
          // native lease. No sleep or guessed number of microtask drains is used.
          expect(yield* Deferred.isDone(closed)).toBe(false);
          failureCode(yield* Effect.exit(rotation.publish()), 'closed');
          const interrupted = yield* Fiber.interrupt(publishing).pipe(
            Effect.forkChild({ startImmediately: true })
          );
          yield* Deferred.succeed(release, undefined);
          yield* Fiber.await(interrupted);
          yield* Fiber.await(closing);
          yield* Deferred.await(closed);
          expect(nativeBody?.every((x) => x === 0)).toBe(true);
          expect(f.row()).toBeUndefined();
          expect(f.records()).toHaveLength(2);
          failureCode(yield* Effect.exit(rotation.publish()), 'closed');
        })
      )
    );
  });
});
