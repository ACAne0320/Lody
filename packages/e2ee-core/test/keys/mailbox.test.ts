import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { Effect, Result, Deferred, Fiber, Scope, Exit } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';
import { makeSqliteKeyMailbox } from '@lody/e2ee-core/keys/mailbox/sqlite';
import * as Reports from '@lody/e2ee-core/keys/reports';
import * as Envelopes from '@lody/e2ee-core/keys/envelope';
import { envelopeFixture } from './fixture';
const ok = <A, E>(r: Result.Result<A, E>) => Result.getOrThrow(r);
const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');
const dirs: string[] = [];
const file = () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'e2ee-mailbox-'));
  dirs.push(dir);
  return path.join(dir, 'mailbox.sqlite');
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const target = (f: ReturnType<typeof envelopeFixture>) => ({
  genesis: hex(f.context.genesis.toBytes()),
  epoch: 0,
  recipient: hex(f.phone.raw),
});
const signedReport = (f: ReturnType<typeof envelopeFixture>, frame: Uint8Array, revision = 0) => {
  const context: Reports.InstallationContext = {
    ...target(f),
    commitment: hex(f.view().inspectState().epoch.keyCommitment.toBytes()),
    revision,
    source: {
      _tag: 'Envelope',
      sender: hex(f.owner.raw),
      frameDigest: Reports.mailboxDigest(frame),
    },
  };
  return ok(
    Reports.encodeInstallationReport(
      context,
      f.phone.signBytes(Reports.installationSigningBytes(ok(Reports.installationBody(context))))
    )
  );
};
describe('authenticated SQLite key mailbox', () => {
  it('persists ciphertext and signed claims, reopens, and repairs without deleting history', async () => {
    const f = envelopeFixture(),
      dbPath = file(),
      frame = await Effect.runPromise(f.prepare());
    const run = (
      mode: 'create' | 'open',
      body: (
        host: Effect.Success<ReturnType<typeof makeSqliteKeyMailbox<never, never>>>
      ) => Effect.Effect<void, unknown>
    ) =>
      Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const host = yield* makeSqliteKeyMailbox({
              path: dbPath,
              mode,
              genesis: f.context.genesis,
              ledger: f.ledger,
            });
            yield* body(host);
          })
        )
      );
    await run('create', (host) =>
      Effect.gen(function* () {
        const sender = ok(host.bind(f.owner.publicKey)),
          recipient = ok(host.bind(f.phone.publicKey));
        expect((yield* sender.status(target(f))).status).toBe('NeedsEnvelope');
        yield* sender.put('01'.repeat(16), frame);
        expect(yield* sender.read('01'.repeat(16))).toEqual(frame);
        expect((yield* recipient.fetch(0, null, 1)).items[0]?.frame).toEqual(frame);
        expect((yield* recipient.status(target(f))).status).toBe('EnvelopeStored');
        yield* recipient.report(signedReport(f, frame));
        expect((yield* sender.status(target(f))).status).toBe('InstallationReported');
      })
    );
    await run('open', (host) =>
      Effect.gen(function* () {
        const sender = ok(host.bind(f.owner.publicKey)),
          recipient = ok(host.bind(f.phone.publicKey));
        expect((yield* recipient.status(target(f))).status).toBe('InstallationReported');
        yield* recipient.repair(target(f), 'repair-1', Reports.mailboxDigest(frame));
        yield* recipient.repair(target(f), 'repair-1', Reports.mailboxDigest(frame));
        expect(yield* recipient.status(target(f))).toMatchObject({
          status: 'NeedsEnvelope',
          revision: 1,
        });
        expect((yield* recipient.fetch(0, null, 1)).items).toEqual([]);
        expect(yield* sender.read('01'.repeat(16))).toEqual(frame);
        expect(
          Result.isFailure(yield* Effect.result(recipient.report(signedReport(f, frame))))
        ).toBe(true);
        expect(
          Result.isFailure(yield* Effect.result(recipient.repair(target(f), 'repair-1')))
        ).toBe(true);
      })
    );
    const db = new Database(dbPath);
    try {
      expect(db.prepare('SELECT count(*) AS n FROM mailbox_envelopes').get()).toEqual({ n: 1 });
      expect(db.prepare('SELECT count(*) AS n FROM mailbox_reports').get()).toEqual({ n: 1 });
    } finally {
      db.close();
    }
  });
  it('deduplicates authenticated insider ciphertext and keeps an unrelated recipient readable', async () => {
    const f = envelopeFixture(),
      dbPath = file(),
      frame = await Effect.runPromise(f.prepare());
    const other = await Effect.runPromise(
      Envelopes.prepareEpochEnvelope({
        context: { ...f.context, recipient: f.owner.publicKey },
        key: f.secret,
        signer: f.owner.signer,
        ledger: f.ledger,
      })
    );
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const host = yield* makeSqliteKeyMailbox({
            path: dbPath,
            mode: 'create',
            genesis: f.context.genesis,
            ledger: f.ledger,
          });
          const sender = ok(host.bind(f.owner.publicKey)),
            recipient = ok(host.bind(f.phone.publicKey));
          for (let n = 0; n < 500; n++) yield* sender.put(n.toString(16).padStart(32, '0'), frame);
          yield* sender.put('ff'.repeat(16), other);
          const received = yield* recipient.fetch(0, null, 1);
          expect(received).toEqual({ items: [{ sender: hex(f.owner.raw), frame }], next: null });
          expect((yield* sender.fetch(0, null, 1)).items[0]?.frame).toEqual(other);
        })
      )
    );
    const db = new Database(dbPath);
    try {
      expect(db.prepare('SELECT count(*) AS n FROM mailbox_envelopes').get()).toEqual({ n: 2 });
    } finally {
      db.close();
    }
  }, 30_000);
  it('binds sender and reporting recipient to authenticated principals and fixes signature verification', async () => {
    const f = envelopeFixture(),
      frame = await Effect.runPromise(f.prepare());
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const host = yield* makeSqliteKeyMailbox({
            path: file(),
            mode: 'create',
            genesis: f.context.genesis,
            ledger: f.ledger,
          });
          const sender = ok(host.bind(f.owner.publicKey)),
            recipient = ok(host.bind(f.phone.publicKey));
          expect(
            Result.isFailure(yield* Effect.result(recipient.put('01'.repeat(16), frame)))
          ).toBe(true);
          const forged = new Uint8Array(frame);
          forged[forged.length - 1] ^= 1;
          expect(Result.isFailure(yield* Effect.result(sender.put('01'.repeat(16), forged)))).toBe(
            true
          );
          expect(
            Result.isFailure(yield* Effect.result(recipient.report(signedReport(f, frame))))
          ).toBe(true);
          yield* sender.put('01'.repeat(16), frame);
          expect(
            Result.isFailure(yield* Effect.result(sender.report(signedReport(f, frame))))
          ).toBe(true);
          const report = signedReport(f, frame);
          report[report.length - 1] ^= 1;
          expect(Result.isFailure(yield* Effect.result(recipient.report(report)))).toBe(true);
          expect((yield* recipient.status(target(f))).status).toBe('EnvelopeStored');
        })
      )
    );
  });
  it('rejects persisted rollback after reopening and preserves another authority observation', async () => {
    const f = envelopeFixture(),
      dbPath = file(),
      old = f.view();
    f.append([5, f.phone.raw]);
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const host = yield* makeSqliteKeyMailbox({
            path: dbPath,
            mode: 'create',
            genesis: f.context.genesis,
            ledger: f.ledger,
          });
          expect((yield* ok(host.bind(f.owner.publicKey)).status(target(f))).status).toBe(
            'Ineligible'
          );
        })
      )
    );
    const result = await Effect.runPromise(
      Effect.result(
        Effect.scoped(
          Effect.gen(function* () {
            const host = yield* makeSqliteKeyMailbox({
              path: dbPath,
              mode: 'open',
              genesis: f.context.genesis,
              ledger: () => Effect.succeed(old),
            });
            yield* ok(host.bind(f.owner.publicKey)).status(target(f));
          })
        )
      )
    );
    expect(Result.isFailure(result)).toBe(true);
    const db = new Database(dbPath);
    try {
      expect(db.prepare('SELECT count FROM mailbox_meta').get()).toEqual({ count: 3 });
    } finally {
      db.close();
    }
  });
  it('rejects foreign files and operations after Scope closes', async () => {
    const f = envelopeFixture(),
      dbPath = file();
    writeFileSync(dbPath, 'foreign');
    const result = await Effect.runPromise(
      Effect.result(
        Effect.scoped(
          makeSqliteKeyMailbox({
            path: dbPath,
            mode: 'open',
            genesis: f.context.genesis,
            ledger: f.ledger,
          })
        )
      )
    );
    expect(Result.isFailure(result)).toBe(true);
    expect(readFileSync(dbPath, 'utf8')).toBe('foreign');
    const session = await Effect.runPromise(
      Effect.scoped(
        Effect.map(
          makeSqliteKeyMailbox({
            path: file(),
            mode: 'create',
            genesis: f.context.genesis,
            ledger: f.ledger,
          }),
          (host) => ok(host.bind(f.owner.publicKey))
        )
      )
    );
    const closed = await Effect.runPromise(Effect.result(session.status(target(f))));
    expect(Result.isFailure(closed) && closed.failure).toMatchObject({ code: 'closed' });
  });
  it('validates cursors before reading rows and isolates unrelated oversized storage corruption', async () => {
    const f = envelopeFixture(),
      dbPath = file(),
      frame = await Effect.runPromise(f.prepare());
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const host = yield* makeSqliteKeyMailbox({
              path: dbPath,
              mode: 'create',
              genesis: f.context.genesis,
              ledger: f.ledger,
            }),
            sender = ok(host.bind(f.owner.publicKey)),
            recipient = ok(host.bind(f.phone.publicKey));
          yield* sender.put('01'.repeat(16), frame);
          const db = new Database(dbPath);
          try {
            db.pragma('ignore_check_constraints=ON');
            db.prepare('INSERT INTO mailbox_envelopes VALUES(?,?,?,?,?,?)').run(
              0,
              hex(f.owner.raw),
              hex(f.owner.raw),
              '02'.repeat(16),
              'ff'.repeat(32),
              new Uint8Array(513)
            );
          } finally {
            db.close();
          }
          expect((yield* recipient.fetch(0, null, 1)).items[0]?.frame).toEqual(frame);
          expect(Result.isFailure(yield* Effect.result(recipient.fetch(0, '2', 1)))).toBe(true);
          expect(Result.isFailure(yield* Effect.result(recipient.fetch(0, null, 101)))).toBe(true);
          expect(Result.isFailure(yield* Effect.result(sender.fetch(0, null, 1)))).toBe(true);
        })
      )
    );
  });
  it('captures ciphertext before waiting and rejects revocation observed during admission', async () => {
    const f = envelopeFixture(),
      frame = await Effect.runPromise(f.prepare()),
      original = new Uint8Array(frame);
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const reached = yield* Deferred.make<void>(),
            release = yield* Deferred.make<void>();
          let pause = true;
          const ledger = () =>
            Effect.gen(function* () {
              if (pause) {
                pause = false;
                yield* Deferred.succeed(reached, undefined);
                yield* Deferred.await(release);
              }
              return f.view();
            });
          const host = yield* makeSqliteKeyMailbox({
            path: file(),
            mode: 'create',
            genesis: f.context.genesis,
            ledger,
          });
          const sender = ok(host.bind(f.owner.publicKey));
          const worker = yield* Effect.forkChild(sender.put('01'.repeat(16), frame));
          yield* Deferred.await(reached);
          frame.fill(0);
          yield* Deferred.succeed(release, undefined);
          expect(Exit.isSuccess(yield* Fiber.await(worker))).toBe(true);
          expect(yield* sender.read('01'.repeat(16))).toEqual(original);
          f.append([5, f.phone.raw]);
          expect(
            Result.isFailure(yield* Effect.result(sender.put('02'.repeat(16), original)))
          ).toBe(true);
        })
      )
    );
  });
  it('awaits caller work explicitly and closes without a late write while a borrowed ledger is pending', async () => {
    const f = envelopeFixture(),
      dbPath = file(),
      frame = await Effect.runPromise(f.prepare());
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const reached = yield* Deferred.make<void>(),
            release = yield* Deferred.make<void>(),
            scope = yield* Scope.make();
          const ledger = () =>
            Effect.gen(function* () {
              yield* Deferred.succeed(reached, undefined);
              yield* Deferred.await(release);
              return f.view();
            });
          const host = yield* Scope.provide(
            makeSqliteKeyMailbox({
              path: dbPath,
              mode: 'create',
              genesis: f.context.genesis,
              ledger,
            }),
            scope
          );
          const worker = yield* Effect.forkChild(
            ok(host.bind(f.owner.publicKey)).put('01'.repeat(16), frame)
          );
          yield* Deferred.await(reached);
          yield* Scope.close(scope, Exit.void);
          yield* Deferred.succeed(release, undefined);
          expect(Exit.isFailure(yield* Fiber.await(worker))).toBe(true);
        })
      )
    );
    const db = new Database(dbPath);
    try {
      expect(db.prepare('SELECT count(*) AS n FROM mailbox_envelopes').get()).toEqual({ n: 0 });
    } finally {
      db.close();
    }
  });
  it('rejects the old JSON schema before mutating its SQLite file', async () => {
    const f = envelopeFixture(),
      dbPath = file(),
      db = new Database(dbPath);
    db.exec(
      "CREATE TABLE document (text TEXT); INSERT INTO document VALUES ('original'); PRAGMA application_id=1279610161; PRAGMA user_version=1;"
    );
    db.close();
    const before = readFileSync(dbPath);
    const result = await Effect.runPromise(
      Effect.result(
        Effect.scoped(
          makeSqliteKeyMailbox({
            path: dbPath,
            mode: 'open',
            genesis: f.context.genesis,
            ledger: f.ledger,
          })
        )
      )
    );
    expect(Result.isFailure(result)).toBe(true);
    expect(readFileSync(dbPath)).toEqual(before);
  });
});
