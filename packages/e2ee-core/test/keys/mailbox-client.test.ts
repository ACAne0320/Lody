import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { Effect, Result, Deferred, Fiber, Scope, Exit } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';
import {
  makeSqliteRecipientMailbox,
  type RecipientMailboxRemote,
} from '@lody/e2ee-core/keys/host/mailbox/sqlite';
import { makeSqliteKeyMailbox } from '@lody/e2ee-core/keys/mailbox/sqlite';
import { envelopeFixture, recipientPair } from './fixture';
import { synthetic } from './protection-fixture';
const ok = Result.getOrThrow,
  hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');
const dirs: string[] = [];
const directory = () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'e2ee-mailbox-client-'));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const inspect = (file: string) => {
  const db = new Database(file);
  try {
    return db.prepare('SELECT phase,report FROM receive_tasks').all() as {
      phase: string;
      report: Uint8Array | null;
    }[];
  } finally {
    db.close();
  }
};
describe('real recipient receive/repair/fetch composition', () => {
  it('fetches through the actual bound mailbox, installs protected keys/reports, and performs durable repair with retained usable ciphertext', async () => {
    const f = envelopeFixture(),
      dir = directory(),
      pair = await recipientPair(),
      frame = await Effect.runPromise(f.prepare());
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const host = yield* makeSqliteKeyMailbox({
              path: path.join(dir, 'host.sqlite'),
              mode: 'create',
              genesis: f.context.genesis,
              ledger: f.ledger,
            }),
            sender = ok(host.bind(f.owner.publicKey)),
            remote = ok(host.bind(f.phone.publicKey));
          yield* sender.put('aa'.repeat(16), frame);
          const client = yield* makeSqliteRecipientMailbox({
            path: path.join(dir, 'receive.sqlite'),
            mode: 'create',
            genesis: f.context.genesis,
            signer: f.phone.signer,
            pair,
            ledger: f.ledger,
            remote,
            repairStore: { path: path.join(dir, 'repair.sqlite'), mode: 'create' },
            keyStore: {
              path: path.join(dir, 'keys.sqlite'),
              mode: 'create',
              protector: synthetic().protector,
            },
          });
          expect(yield* client.fetchAndInstall()).toEqual({ processed: 1, next: null });
          expect(inspect(path.join(dir, 'receive.sqlite'))[0]).toMatchObject({ phase: 'Report' });
          yield* client.flushReports();
          const target = {
            genesis: hex(f.context.genesis.toBytes()),
            epoch: 0,
            recipient: hex(f.phone.raw),
          };
          expect((yield* remote.status(target)).status).toBe('InstallationReported');
          const lost = new Database(path.join(dir, 'keys.sqlite'));
          try {
            lost.exec('DELETE FROM protected_epoch_keys');
          } finally {
            lost.close();
          }
          yield* client.enqueueRepair('local-loss');
          expect((yield* remote.status(target)).revision).toBe(0);
          yield* client.flushRepairs();
          expect((yield* remote.status(target)).revision).toBe(1);
          expect((yield* remote.fetch(0, null, 100)).items).toHaveLength(1);
          expect(yield* client.fetchAndInstall()).toEqual({ processed: 1, next: null });
          yield* client.flushReports();
          expect((yield* remote.status(target)).status).toBe('InstallationReported');
          expect(yield* client.results()).toHaveLength(2);
          expect((yield* client.repairResults()).items).toEqual([
            { id: 'local-loss', outcome: 'Repaired' },
          ]);
        })
      )
    );
  });
  it.each([false, true])(
    'retains failed installation without page-next success (earlier valid install=%s)',
    async (goodFirst) => {
      const f = envelopeFixture(),
        dir = directory(),
        pair = await recipientPair(),
        frame = await Effect.runPromise(f.prepare());
      const good = new Uint8Array(frame);
      frame[frame.length - 65] ^= 1;
      const bad = f.resign(frame);
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const host = yield* makeSqliteKeyMailbox({
                path: path.join(dir, 'host.sqlite'),
                mode: 'create',
                genesis: f.context.genesis,
                ledger: f.ledger,
              }),
              sender = ok(host.bind(f.owner.publicKey)),
              remote = ok(host.bind(f.phone.publicKey));
            yield* sender.put('ab'.repeat(16), bad);
            if (goodFirst) yield* sender.put('ad'.repeat(16), good);
            const client = yield* makeSqliteRecipientMailbox({
              path: path.join(dir, 'receive.sqlite'),
              mode: 'create',
              genesis: f.context.genesis,
              signer: f.phone.signer,
              pair,
              ledger: f.ledger,
              remote: {
                ...remote,
                fetch: (epoch, cursor, limit) =>
                  remote.fetch(epoch, cursor, limit).pipe(
                    Effect.map((page) => ({
                      ...page,
                      items: goodFirst
                        ? [...page.items].sort(
                            (a, b) =>
                              Number(hex(b.frame) === hex(good)) -
                              Number(hex(a.frame) === hex(good))
                          )
                        : page.items,
                      next: 'later-page',
                    }))
                  ),
              },
              repairStore: { path: path.join(dir, 'repair.sqlite'), mode: 'create' },
              keyStore: {
                path: path.join(dir, 'keys.sqlite'),
                mode: 'create',
                protector: synthetic().protector,
              },
            });
            expect(Result.isFailure(yield* Effect.result(client.fetchAndInstall()))).toBe(true);
            const retained = inspect(path.join(dir, 'receive.sqlite'));
            expect(retained.filter((row) => row.phase === 'Verify')).toEqual([
              { phase: 'Verify', report: null },
            ]);
            expect(retained.filter((row) => row.phase === 'Report')).toHaveLength(
              goodFirst ? 1 : 0
            );
            if (goodFirst) {
              expect(retained.find((row) => row.phase === 'Report')!.report).toBeInstanceOf(
                Uint8Array
              );
              const keys = new Database(path.join(dir, 'keys.sqlite'));
              try {
                expect(
                  keys.prepare('SELECT COUNT(*) AS n FROM protected_epoch_keys').get()
                ).toEqual({ n: 1 });
              } finally {
                keys.close();
              }
            }
            expect(
              (yield* remote.status({
                genesis: hex(f.context.genesis.toBytes()),
                epoch: 0,
                recipient: hex(f.phone.raw),
              })).status
            ).toBe('EnvelopeStored');
          })
        )
      );
    }
  );
  it.each([
    'oversize-last',
    'too-many',
    'empty-next',
    'revoked-during-fetch',
    'hidden-bad-row',
  ] as const)(
    'rejects the complete %s page before any task/key/report is persisted',
    async (fault) => {
      const f = envelopeFixture(),
        dir = directory(),
        pair = await recipientPair(),
        frame = await Effect.runPromise(f.prepare());
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const host = yield* makeSqliteKeyMailbox({
                path: path.join(dir, 'host.sqlite'),
                mode: 'create',
                genesis: f.context.genesis,
                ledger: f.ledger,
              }),
              bound = ok(host.bind(f.phone.publicKey));
            const client = yield* makeSqliteRecipientMailbox({
              path: path.join(dir, 'receive.sqlite'),
              mode: 'create',
              genesis: f.context.genesis,
              signer: f.phone.signer,
              pair,
              ledger: f.ledger,
              remote: {
                ...bound,
                fetch: () =>
                  Effect.sync(() => {
                    const row = { sender: hex(f.owner.raw), frame };
                    if (fault === 'revoked-during-fetch') {
                      f.append([5, f.phone.raw]);
                      return { items: [row], next: null };
                    }
                    if (fault === 'empty-next') return { items: [], next: 'unproven-next' };
                    if (fault === 'too-many')
                      return { items: Array.from({ length: 101 }, () => row), next: null };
                    const items = [row, { sender: hex(f.owner.raw), frame: new Uint8Array(513) }];
                    if (fault === 'hidden-bad-row')
                      Object.defineProperty(items, Symbol.iterator, {
                        value: function* () {
                          yield row;
                        },
                      });
                    return { items, next: null };
                  }),
              },
              repairStore: { path: path.join(dir, 'repair.sqlite'), mode: 'create' },
              keyStore: {
                path: path.join(dir, 'keys.sqlite'),
                mode: 'create',
                protector: synthetic().protector,
              },
            });
            expect(Result.isFailure(yield* Effect.result(client.fetchAndInstall()))).toBe(true);
            expect(inspect(path.join(dir, 'receive.sqlite'))).toEqual([]);
            const keys = new Database(path.join(dir, 'keys.sqlite'));
            try {
              expect(keys.prepare('SELECT COUNT(*) AS n FROM protected_epoch_keys').get()).toEqual({
                n: 0,
              });
            } finally {
              keys.close();
            }
          })
        )
      );
    }
  );
  it('copies the complete fetched page before async ledger recheck and retains initialized fetch capability', async () => {
    const f = envelopeFixture(),
      dir = directory(),
      pair = await recipientPair(),
      frame = await Effect.runPromise(f.prepare());
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const host = yield* makeSqliteKeyMailbox({
              path: path.join(dir, 'host.sqlite'),
              mode: 'create',
              genesis: f.context.genesis,
              ledger: f.ledger,
            }),
            sender = ok(host.bind(f.owner.publicKey)),
            bound = ok(host.bind(f.phone.publicKey));
          yield* sender.put('ac'.repeat(16), frame);
          const entered = yield* Deferred.make<void>(),
            release = yield* Deferred.make<void>();
          let gate = false;
          const ledger = () =>
            Effect.gen(function* () {
              if (gate) {
                gate = false;
                yield* Deferred.succeed(entered, undefined);
                yield* Deferred.await(release);
              }
              return yield* f.ledger();
            });
          const row = { sender: hex(f.owner.raw), frame: new Uint8Array(frame) },
            remote: { fetch: RecipientMailboxRemote['fetch'] } & Omit<
              RecipientMailboxRemote,
              'fetch'
            > = {
              ...bound,
              fetch: () =>
                Effect.sync(() => {
                  gate = true;
                  return { items: [row], next: null };
                }),
            };
          const client = yield* makeSqliteRecipientMailbox({
            path: path.join(dir, 'receive.sqlite'),
            mode: 'create',
            genesis: f.context.genesis,
            signer: f.phone.signer,
            pair,
            ledger,
            remote,
            repairStore: { path: path.join(dir, 'repair.sqlite'), mode: 'create' },
            keyStore: {
              path: path.join(dir, 'keys.sqlite'),
              mode: 'create',
              protector: synthetic().protector,
            },
          });
          remote.fetch = () => Effect.succeed({ items: [], next: null });
          const worker = yield* Effect.forkChild(client.fetchAndInstall());
          yield* Deferred.await(entered);
          row.frame.fill(0);
          row.sender = 'ff'.repeat(32);
          yield* Deferred.succeed(release, undefined);
          expect(yield* Fiber.join(worker)).toEqual({ processed: 1, next: null });
          expect(inspect(path.join(dir, 'receive.sqlite'))[0]!.phase).toBe('Report');
        })
      )
    );
  });
  it('rejects a late fetch page after explicit Scope close before any receive task is saved', async () => {
    const f = envelopeFixture(),
      dir = directory(),
      pair = await recipientPair(),
      frame = await Effect.runPromise(f.prepare());
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const host = yield* makeSqliteKeyMailbox({
              path: path.join(dir, 'host.sqlite'),
              mode: 'create',
              genesis: f.context.genesis,
              ledger: f.ledger,
            }),
            bound = ok(host.bind(f.phone.publicKey));
          const scope = yield* Scope.make(),
            entered = yield* Deferred.make<void>(),
            release = yield* Deferred.make<void>();
          const client = yield* makeSqliteRecipientMailbox({
            path: path.join(dir, 'receive.sqlite'),
            mode: 'create',
            genesis: f.context.genesis,
            signer: f.phone.signer,
            pair,
            ledger: f.ledger,
            remote: {
              ...bound,
              fetch: () =>
                Effect.gen(function* () {
                  yield* Deferred.succeed(entered, undefined);
                  yield* Deferred.await(release);
                  return { items: [{ sender: hex(f.owner.raw), frame }], next: null };
                }),
            },
            repairStore: { path: path.join(dir, 'repair.sqlite'), mode: 'create' },
            keyStore: {
              path: path.join(dir, 'keys.sqlite'),
              mode: 'create',
              protector: synthetic().protector,
            },
          }).pipe(Effect.provideService(Scope.Scope, scope));
          const worker = yield* Effect.forkChild(Effect.result(client.fetchAndInstall()));
          yield* Deferred.await(entered);
          yield* Scope.close(scope, Exit.void);
          yield* Deferred.succeed(release, undefined);
          expect(Result.isFailure(yield* Fiber.join(worker))).toBe(true);
          expect(inspect(path.join(dir, 'receive.sqlite'))).toEqual([]);
        })
      )
    );
  });
});
