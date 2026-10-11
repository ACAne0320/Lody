import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Effect, Result, Scope, Exit, Deferred, Fiber } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';
import { makeSqliteMailboxRepair } from '@lody/e2ee-core/keys/mailbox/repair/sqlite';
import { makeSqliteKeyMailbox } from '@lody/e2ee-core/keys/mailbox/sqlite';
import { mailboxDigest } from '@lody/e2ee-core/keys/reports';
import { ContentError } from '../../src/errors';
import { envelopeFixture } from './fixture';
const ok = Result.getOrThrow,
  hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');
const dirs: string[] = [];
const directory = () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'e2ee-repair-'));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const slot = (f: ReturnType<typeof envelopeFixture>) => ({
  genesis: hex(f.context.genesis.toBytes()),
  epoch: 0,
  recipient: hex(f.phone.raw),
});
const rows = (file: string) => {
  const db = new Database(file);
  try {
    return db
      .prepare('SELECT id,epoch,rejected,phase,consumed FROM repair_tasks ORDER BY id')
      .all();
  } finally {
    db.close();
  }
};
describe('durable stable-ID mailbox repair episodes', () => {
  it('persists before dispatch, retains lost ACK, and retries the same ID after reopening without a second repair revision', async () => {
    const f = envelopeFixture(),
      dir = directory(),
      journal = path.join(dir, 'repair.sqlite'),
      hostfile = path.join(dir, 'mailbox.sqlite');
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const host = yield* makeSqliteKeyMailbox({
              path: hostfile,
              mode: 'create',
              genesis: f.context.genesis,
              ledger: f.ledger,
            }),
            remote = ok(host.bind(f.phone.publicKey));
          const queue = yield* makeSqliteMailboxRepair({
            path: journal,
            mode: 'create',
            genesis: f.context.genesis,
            recipient: f.phone.publicKey,
            ledger: f.ledger,
            remote: {
              repair: (target, id, digest) =>
                Effect.gen(function* () {
                  expect(rows(journal)).toEqual([
                    { id: 'lost-key', epoch: 0, rejected: null, phase: 'Pending', consumed: 0 },
                  ]);
                  yield* remote.repair(target, id, digest);
                  return yield* new ContentError({ code: 'sign-failed' });
                }),
            },
          });
          expect(yield* queue.enqueue('lost-key')).toEqual({ id: 'lost-key' });
          expect((yield* remote.status(slot(f))).revision).toBe(0);
          expect(yield* queue.flush()).toEqual({ processed: 1, blocked: ['lost-key'], next: null });
          expect((yield* remote.status(slot(f))).revision).toBe(1);
          expect(rows(journal)[0]).toMatchObject({ phase: 'Pending' });
        })
      )
    );
    const child = JSON.parse(
      execFileSync(
        process.execPath,
        ['--import', 'tsx', fileURLToPath(new URL('./repair-reopen.mts', import.meta.url)), dir],
        { encoding: 'utf8' }
      )
    );
    expect(child.pid).not.toBe(process.pid);
    expect(child.batch).toEqual({ processed: 1, blocked: [], next: null });
    expect(child.revision).toBe(1);
    expect(child.results).toEqual({ items: [{ id: 'lost-key', outcome: 'Repaired' }], next: null });
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const host = yield* makeSqliteKeyMailbox({
              path: hostfile,
              mode: 'open',
              genesis: f.context.genesis,
              ledger: f.ledger,
            }),
            remote = ok(host.bind(f.phone.publicKey));
          const queue = yield* makeSqliteMailboxRepair({
            path: journal,
            mode: 'open',
            genesis: f.context.genesis,
            recipient: f.phone.publicKey,
            ledger: f.ledger,
            remote,
          });
          yield* queue.enqueue('lost-key');
          expect(yield* queue.flush()).toEqual({ processed: 0, blocked: [], next: null });
          expect((yield* remote.status(slot(f))).revision).toBe(1);
          expect(yield* queue.results()).toEqual({
            items: [{ id: 'lost-key', outcome: 'Repaired' }],
            next: null,
          });
          yield* queue.acknowledge('lost-key');
          expect((yield* queue.results()).items).toEqual([]);
          expect(rows(journal)).toEqual([
            { id: 'lost-key', epoch: 0, rejected: null, phase: 'Repaired', consumed: 1 },
          ]);
        })
      )
    );
  });
  it('binds one ID to original fields and durably excludes only the explicit rejected real envelope', async () => {
    const f = envelopeFixture(),
      dir = directory(),
      journal = path.join(dir, 'repair.sqlite'),
      frame = await Effect.runPromise(f.prepare());
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const host = yield* makeSqliteKeyMailbox({
              path: path.join(dir, 'mailbox.sqlite'),
              mode: 'create',
              genesis: f.context.genesis,
              ledger: f.ledger,
            }),
            sender = ok(host.bind(f.owner.publicKey)),
            remote = ok(host.bind(f.phone.publicKey));
          yield* sender.put('ac'.repeat(16), frame);
          const queue = yield* makeSqliteMailboxRepair({
            path: journal,
            mode: 'create',
            genesis: f.context.genesis,
            recipient: f.phone.publicKey,
            ledger: f.ledger,
            remote,
          });
          yield* queue.enqueue('bad-envelope', mailboxDigest(frame));
          expect(Result.isFailure(yield* Effect.result(queue.enqueue('bad-envelope')))).toBe(true);
          expect((yield* remote.fetch(0, null, 100)).items).toHaveLength(1);
          yield* queue.flush();
          expect((yield* remote.fetch(0, null, 100)).items).toEqual([]);
          expect(rows(journal)[0]).toMatchObject({
            rejected: mailboxDigest(frame),
            phase: 'Repaired',
          });
        })
      )
    );
  });
  it('uses genuine ledger disposition, admits a registered Recovery recipient and refuses forged views', async () => {
    const f = envelopeFixture(),
      dir = directory(),
      journal = path.join(dir, 'repair.sqlite');
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const host = yield* makeSqliteKeyMailbox({
              path: path.join(dir, 'mailbox.sqlite'),
              mode: 'create',
              genesis: f.context.genesis,
              ledger: f.ledger,
            }),
            remote = ok(host.bind(f.phone.publicKey));
          const queue = yield* makeSqliteMailboxRepair({
            path: journal,
            mode: 'create',
            genesis: f.context.genesis,
            recipient: f.phone.publicKey,
            ledger: f.ledger,
            remote,
          });
          yield* queue.enqueue('revoked');
          f.append([5, f.phone.raw]);
          expect(yield* queue.flush()).toEqual({ processed: 1, blocked: [], next: null });
          expect(yield* queue.results()).toEqual({
            items: [{ id: 'revoked', outcome: 'Revoked' }],
            next: null,
          });
          expect(Result.isFailure(yield* Effect.result(queue.enqueue('after-revoke')))).toBe(true);
        })
      )
    );
    const recovery = envelopeFixture(2),
      rdir = directory();
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const host = yield* makeSqliteKeyMailbox({
              path: path.join(rdir, 'mailbox.sqlite'),
              mode: 'create',
              genesis: recovery.context.genesis,
              ledger: recovery.ledger,
            }),
            remote = ok(host.bind(recovery.phone.publicKey));
          const queue = yield* makeSqliteMailboxRepair({
            path: path.join(rdir, 'repair.sqlite'),
            mode: 'create',
            genesis: recovery.context.genesis,
            recipient: recovery.phone.publicKey,
            ledger: recovery.ledger,
            remote,
          });
          yield* queue.enqueue('recovery');
          expect(yield* queue.flush()).toEqual({ processed: 1, blocked: [], next: null });
          expect((yield* remote.status(slot(recovery))).revision).toBe(1);
          expect(rows(path.join(rdir, 'repair.sqlite'))).toEqual([
            { id: 'recovery', epoch: 0, rejected: null, phase: 'Repaired', consumed: 0 },
          ]);
        })
      )
    );
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const queue = yield* makeSqliteMailboxRepair({
            path: path.join(dir, 'forged.sqlite'),
            mode: 'create',
            genesis: f.context.genesis,
            recipient: f.phone.publicKey,
            ledger: () => Effect.succeed({ ...f.view() }),
            remote: { repair: () => Effect.void },
          });
          expect(Result.isFailure(yield* Effect.result(queue.enqueue('fake')))).toBe(true);
          expect(rows(path.join(dir, 'forged.sqlite'))).toEqual([]);
        })
      )
    );
  });
  it('retains the original when a terminal write is ignored after remote repair, then idempotently recovers', async () => {
    const f = envelopeFixture(),
      dir = directory(),
      journal = path.join(dir, 'repair.sqlite');
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const host = yield* makeSqliteKeyMailbox({
              path: path.join(dir, 'mailbox.sqlite'),
              mode: 'create',
              genesis: f.context.genesis,
              ledger: f.ledger,
            }),
            remote = ok(host.bind(f.phone.publicKey));
          const queue = yield* makeSqliteMailboxRepair({
            path: journal,
            mode: 'create',
            genesis: f.context.genesis,
            recipient: f.phone.publicKey,
            ledger: f.ledger,
            remote,
          });
          yield* queue.enqueue('ignored');
          const db = new Database(journal);
          try {
            db.exec(
              'CREATE TRIGGER ignore_repair BEFORE UPDATE ON repair_tasks BEGIN SELECT RAISE(IGNORE); END;'
            );
          } finally {
            db.close();
          }
          expect((yield* queue.flush()).blocked).toEqual(['ignored']);
          expect((yield* remote.status(slot(f))).revision).toBe(1);
          expect(rows(journal)[0]).toMatchObject({ phase: 'Pending' });
          const clear = new Database(journal);
          try {
            clear.exec('DROP TRIGGER ignore_repair');
          } finally {
            clear.close();
          }
          expect((yield* queue.flush()).blocked).toEqual([]);
          expect((yield* remote.status(slot(f))).revision).toBe(1);
          expect(rows(journal)[0]).toMatchObject({ phase: 'Repaired' });
        })
      )
    );
  });
  it('pages beyond blocked original repair work, retains results and idempotently binds acknowledged IDs', async () => {
    const f = envelopeFixture(),
      dir = directory(),
      journal = path.join(dir, 'repair.sqlite'),
      verified = f.view(),
      ledger = () => Effect.succeed(verified);
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const host = yield* makeSqliteKeyMailbox({
              path: path.join(dir, 'mailbox.sqlite'),
              mode: 'create',
              genesis: f.context.genesis,
              ledger,
            }),
            remote = ok(host.bind(f.phone.publicKey));
          const queue = yield* makeSqliteMailboxRepair({
            path: journal,
            mode: 'create',
            genesis: f.context.genesis,
            recipient: f.phone.publicKey,
            ledger,
            remote,
          });
          yield* queue.enqueue('000-blocked', 'ff'.repeat(32));
          for (let index = 1; index <= 101; index++)
            yield* queue.enqueue(index.toString().padStart(3, '0'));
          let cursor: string | null = null,
            total = 0;
          const blocked: string[] = [];
          do {
            const page: { processed: number; blocked: string[]; next: string | null } =
              yield* queue.flush(17, cursor);
            total += page.processed;
            blocked.push(...page.blocked);
            cursor = page.next;
          } while (cursor !== null);
          expect(total).toBe(102);
          expect(blocked).toEqual(['000-blocked']);
          expect((yield* remote.status(slot(f))).revision).toBe(101);
          const first = yield* queue.results(100);
          expect(first.items).toHaveLength(100);
          expect(first.next).not.toBeNull();
          const second = yield* queue.results(100, first.next);
          expect(second.items).toHaveLength(1);
          expect(second.next).toBeNull();
          for (const result of [...first.items, ...second.items])
            yield* queue.acknowledge(result.id);
          expect((yield* queue.results()).items).toEqual([]);
          expect(rows(journal)).toHaveLength(102);
          yield* queue.enqueue('001');
          expect((yield* remote.status(slot(f))).revision).toBe(101);
          expect((yield* queue.flush()).blocked).toEqual(['000-blocked']);
          expect(Result.isFailure(yield* Effect.result(queue.flush(101)))).toBe(true);
        })
      )
    );
  });
  it('does not write a late ACK after Scope close', async () => {
    const f = envelopeFixture(),
      dir = directory(),
      journal = path.join(dir, 'repair.sqlite');
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const host = yield* makeSqliteKeyMailbox({
              path: path.join(dir, 'mailbox.sqlite'),
              mode: 'create',
              genesis: f.context.genesis,
              ledger: f.ledger,
            }),
            remote = ok(host.bind(f.phone.publicKey));
          const scope = yield* Scope.make(),
            entered = yield* Deferred.make<void>(),
            release = yield* Deferred.make<void>();
          const queue = yield* makeSqliteMailboxRepair({
            path: journal,
            mode: 'create',
            genesis: f.context.genesis,
            recipient: f.phone.publicKey,
            ledger: f.ledger,
            remote: {
              repair: (target, id, digest) =>
                Effect.gen(function* () {
                  yield* remote.repair(target, id, digest);
                  yield* Deferred.succeed(entered, undefined);
                  yield* Deferred.await(release);
                }),
            },
          }).pipe(Effect.provideService(Scope.Scope, scope));
          yield* queue.enqueue('late');
          const worker = yield* Effect.forkChild(queue.flush());
          yield* Deferred.await(entered);
          yield* Scope.close(scope, Exit.void);
          yield* Deferred.succeed(release, undefined);
          expect((yield* Fiber.join(worker)).blocked).toEqual(['late']);
          expect(rows(journal)[0]).toMatchObject({ phase: 'Pending' });
          expect(Result.isFailure(yield* Effect.result(queue.flush()))).toBe(true);
          expect((yield* remote.status(slot(f))).revision).toBe(1);
        })
      )
    );
  });
});
