import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { Effect, Result, type Scope } from 'effect';
import { describe, expect, it } from 'vitest';
import { makeSqliteSnapshotPublication } from '@lody/e2ee-core/content/snapshot/sqlite';
import { envelopeFixture } from './keys/fixture';

const run = <A, E>(work: Effect.Effect<A, E, Scope.Scope>) =>
  Effect.runPromise(Effect.scoped(work));
function fixture() {
  const f = envelopeFixture(),
    dir = mkdtempSync(join(tmpdir(), 'snapshot-publication-'));
  const config = (path = join(dir, 'snapshot.sqlite')) => ({
    path,
    mode: 'create' as 'create' | 'open',
    genesis: f.context.genesis,
    resource: 'document-A',
    model: 'loro' as const,
  });
  const original = (offset = 'opaque/a', signer = f.owner.publicKey) => ({
    offset,
    signer: Buffer.from(signer.toBytes()).toString('hex'),
    body: new Uint8Array([1, 2, 3, 4]),
    issuedAt: 10,
    expiresAt: 20,
  });
  return { f, dir, config, original };
}
const stored = (db: Database.Database) => ({
  meta: db.prepare('SELECT * FROM snapshot_publication_meta').all(),
  rows: db.prepare('SELECT * FROM snapshot_publications ORDER BY offset').all(),
});

describe('durable current snapshot publication identities', () => {
  it('retains uncertain originals, refuses replacement and concurrent new snapshots, and never revives an older accepted position', async () => {
    const f = fixture(),
      config = f.config();
    let late: Effect.Success<ReturnType<typeof makeSqliteSnapshotPublication>> | undefined;
    try {
      await run(
        Effect.gen(function* () {
          const store = yield* makeSqliteSnapshotPublication(config);
          late = store;
          expect(yield* store.current()).toBeNull();
          const input = f.original(),
            pending = yield* store.reserve(input);
          input.body.fill(0);
          expect(pending.phase).toBe('Pending');
          expect((yield* store.pending())?.body).toEqual(new Uint8Array([1, 2, 3, 4]));
          const exposed = yield* store.lookup(pending.offset);
          exposed!.body.fill(0);
          expect((yield* store.lookup(pending.offset))?.body).toEqual(new Uint8Array([1, 2, 3, 4]));
          for (const conflicting of [
            { ...f.original(), body: new Uint8Array([4, 3, 2, 1]) },
            f.original('opaque/a', f.f.phone.publicKey),
            f.original('opaque/b'),
          ])
            expect(Result.isFailure(yield* Effect.result(store.reserve(conflicting)))).toBe(true);
          yield* store.accept(pending);
          const first = yield* store.current();
          expect(first?.phase).toBe('Accepted');
          expect(first?.offset).toBe('opaque/a');
          const second = yield* store.reserve(f.original('opaque/z'));
          yield* store.accept(second);
          expect((yield* store.current())?.offset).toBe('opaque/z');
          const db = new Database(config.path);
          try {
            const baseline = stored(db);
            db.exec(
              "CREATE TRIGGER no_insert BEFORE INSERT ON snapshot_publications BEGIN SELECT RAISE(ABORT,'must not rewrite originals'); END; CREATE TRIGGER no_update BEFORE UPDATE ON snapshot_publications BEGIN SELECT RAISE(ABORT,'must not change receipts'); END; CREATE TRIGGER no_meta BEFORE UPDATE ON snapshot_publication_meta BEGIN SELECT RAISE(ABORT,'must not revive old current'); END;"
            );
            const retried = yield* store.reserve(f.original('opaque/a'));
            expect(retried.phase).toBe('Accepted');
            yield* store.accept(pending); // An uncertain caller may still hold the former Pending row.
            yield* store.accept(retried);
            expect((yield* store.current())?.offset).toBe('opaque/z');
            expect(stored(db)).toEqual(baseline);
          } finally {
            db.close();
          }
        })
      );
      expect(Result.isFailure(await run(Effect.result(late!.current())))).toBe(true);
      await run(
        Effect.gen(function* () {
          const store = yield* makeSqliteSnapshotPublication({ ...config, mode: 'open' });
          expect((yield* store.current())?.offset).toBe('opaque/z');
          expect((yield* store.lookup('opaque/a'))?.phase).toBe('Accepted');
          expect(yield* store.pending()).toBeNull();
        })
      );
    } finally {
      rmSync(f.dir, { recursive: true, force: true });
    }
  });

  it('rolls back ignored and trigger-rewritten reserve or acceptance mutations, retaining current and exact old ciphertexts', async () => {
    const f = fixture();
    const reserveFaults = [
      'CREATE TRIGGER fault BEFORE INSERT ON snapshot_publications BEGIN SELECT RAISE(IGNORE); END',
      'CREATE TRIGGER fault AFTER INSERT ON snapshot_publications BEGIN UPDATE snapshot_publications SET body=zeroblob(length(body)) WHERE offset=NEW.offset; END',
      'CREATE TRIGGER fault BEFORE UPDATE ON snapshot_publication_meta BEGIN SELECT RAISE(IGNORE); END',
      "CREATE TRIGGER fault AFTER UPDATE ON snapshot_publication_meta BEGIN UPDATE snapshot_publication_meta SET resource='other'; END",
      "CREATE TRIGGER fault AFTER UPDATE ON snapshot_publication_meta BEGIN UPDATE snapshot_publications SET body=zeroblob(length(body)) WHERE offset='opaque/a'; END",
      'CREATE TRIGGER fault AFTER INSERT ON snapshot_publications BEGIN UPDATE snapshot_publications SET expiresAt=expiresAt+1 WHERE offset=NEW.offset; END',
      "CREATE TRIGGER fault AFTER UPDATE ON snapshot_publication_meta BEGIN UPDATE snapshot_publications SET issuedAt=issuedAt+1,expiresAt=expiresAt+1 WHERE offset='opaque/a'; END",
    ];
    const acceptFaults = [
      'CREATE TRIGGER fault BEFORE UPDATE ON snapshot_publications BEGIN SELECT RAISE(IGNORE); END',
      'CREATE TRIGGER fault AFTER UPDATE ON snapshot_publications BEGIN UPDATE snapshot_publications SET body=zeroblob(length(body)) WHERE offset=NEW.offset; END',
      'CREATE TRIGGER fault BEFORE UPDATE ON snapshot_publication_meta BEGIN SELECT RAISE(IGNORE); END',
      "CREATE TRIGGER fault AFTER UPDATE ON snapshot_publication_meta BEGIN UPDATE snapshot_publication_meta SET currentOffset='opaque/a'; END",
      "CREATE TRIGGER fault AFTER UPDATE ON snapshot_publication_meta BEGIN UPDATE snapshot_publications SET signer='0000000000000000000000000000000000000000000000000000000000000000' WHERE offset='opaque/a'; END",
      "CREATE TRIGGER fault AFTER UPDATE ON snapshot_publication_meta BEGIN UPDATE snapshot_publications SET body=zeroblob(length(body)) WHERE offset='opaque/a'; END",
      "CREATE TRIGGER fault BEFORE UPDATE ON snapshot_publication_meta BEGIN SELECT RAISE(ABORT,'injected storage failure'); END",
      'CREATE TRIGGER fault AFTER UPDATE ON snapshot_publications BEGIN UPDATE snapshot_publications SET expiresAt=expiresAt+1 WHERE offset=NEW.offset; END',
      "CREATE TRIGGER fault AFTER UPDATE ON snapshot_publication_meta BEGIN UPDATE snapshot_publications SET issuedAt=issuedAt+1,expiresAt=expiresAt+1 WHERE offset='opaque/a'; END",
    ];
    try {
      for (const [kind, faults] of [
        ['reserve', reserveFaults],
        ['accept', acceptFaults],
      ] as const) {
        for (let index = 0; index < faults.length; index++) {
          const config = f.config(join(f.dir, `${kind}-${index}.sqlite`));
          await run(
            Effect.gen(function* () {
              const store = yield* makeSqliteSnapshotPublication(config);
              yield* store.accept(yield* store.reserve(f.original()));
              const pending =
                kind === 'accept' ? yield* store.reserve(f.original('opaque/b')) : null;
              const db = new Database(config.path);
              try {
                const before = stored(db);
                db.exec(faults[index]!);
                const rejected = yield* Effect.result(
                  kind === 'accept' ? store.accept(pending!) : store.reserve(f.original('opaque/b'))
                );
                expect(Result.isFailure(rejected)).toBe(true);
                expect(stored(db)).toEqual(before);
                expect((yield* store.current())?.offset).toBe('opaque/a');
                db.exec('DROP TRIGGER fault');
                const resumed = pending ?? (yield* store.reserve(f.original('opaque/b')));
                yield* store.accept(resumed);
                expect((yield* store.current())?.offset).toBe('opaque/b');
              } finally {
                db.close();
              }
            })
          );
          await run(
            Effect.gen(function* () {
              const reopened = yield* makeSqliteSnapshotPublication({ ...config, mode: 'open' });
              expect((yield* reopened.current())?.offset).toBe('opaque/b');
            })
          );
        }
      }
    } finally {
      rmSync(f.dir, { recursive: true, force: true });
    }
  });

  it('reopens an uncertain original in another OS process and still keeps the previous current identity', async () => {
    const f = fixture(),
      config = f.config();
    try {
      await run(
        Effect.gen(function* () {
          const store = yield* makeSqliteSnapshotPublication(config);
          yield* store.accept(yield* store.reserve(f.original()));
          yield* store.reserve({ ...f.original('opaque/pending'), issuedAt: 30, expiresAt: 40 });
        })
      );
      const input = join(f.dir, 'child.json');
      writeFileSync(
        input,
        JSON.stringify({
          ...config,
          genesis: Buffer.from(config.genesis.toBytes()).toString('hex'),
        })
      );
      const output = execFileSync(
        process.execPath,
        [
          '--import',
          'tsx',
          fileURLToPath(new URL('./snapshot-publication-reopen.mts', import.meta.url)),
          input,
        ],
        { cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8' }
      );
      const observed = JSON.parse(output);
      expect(observed).toEqual({
        pid: expect.any(Number),
        current: 'opaque/a',
        pending: 'opaque/pending',
        body: '01020304',
        oldPhase: 'Accepted',
        newPhase: 'Pending',
        currentLease: [10, 20],
        pendingLease: [30, 40],
      });
      expect(observed.pid).not.toBe(process.pid);
    } finally {
      rmSync(f.dir, { recursive: true, force: true });
    }
  });

  it('keeps the first authorization deadline across reopen and fresh-credential retries without renewing Pending or reviving Accepted originals', async () => {
    const f = fixture(),
      config = f.config();
    try {
      await run(
        Effect.gen(function* () {
          const store = yield* makeSqliteSnapshotPublication(config);
          yield* store.reserve(f.original());
        })
      );
      await run(
        Effect.gen(function* () {
          const store = yield* makeSqliteSnapshotPublication({ ...config, mode: 'open' });
          const db = new Database(config.path);
          try {
            const initial = stored(db);
            const first = yield* store.reserve({
              ...f.original(),
              issuedAt: 1000,
              expiresAt: 2000,
            });
            expect(first).toMatchObject({ issuedAt: 10, expiresAt: 20, phase: 'Pending' });
            expect(stored(db)).toEqual(initial);
            expect((yield* store.pending())?.expiresAt).toBe(20);
            expect(
              Result.isFailure(
                yield* Effect.result(store.accept({ ...first, issuedAt: 1000, expiresAt: 2000 }))
              )
            ).toBe(true);
            expect(stored(db)).toEqual(initial);
            yield* store.accept(first);
            yield* store.accept(yield* store.reserve(f.original('opaque/later')));
            const accepted = stored(db);
            db.exec(
              "CREATE TRIGGER no_insert BEFORE INSERT ON snapshot_publications BEGIN SELECT RAISE(ABORT,'must retain first lease'); END; CREATE TRIGGER no_update BEFORE UPDATE ON snapshot_publications BEGIN SELECT RAISE(ABORT,'must not renew lease'); END; CREATE TRIGGER no_meta BEFORE UPDATE ON snapshot_publication_meta BEGIN SELECT RAISE(ABORT,'must not revive old current'); END;"
            );
            const retried = yield* store.reserve({
              ...f.original(),
              issuedAt: 3000,
              expiresAt: 4000,
            });
            expect(retried).toMatchObject({ issuedAt: 10, expiresAt: 20, phase: 'Accepted' });
            yield* store.accept(retried);
            expect((yield* store.current())?.offset).toBe('opaque/later');
            expect(stored(db)).toEqual(accepted);
          } finally {
            db.close();
          }
        })
      );
    } finally {
      rmSync(f.dir, { recursive: true, force: true });
    }
  });

  it('refuses fixed-context changes, corrupted reopen and stale handles; capacity does not block recovery or exact retry', async () => {
    const f = fixture(),
      config = f.config();
    try {
      await run(
        Effect.gen(function* () {
          const store = yield* makeSqliteSnapshotPublication({
            ...config,
            budget: { maxSnapshots: 1, maxBytes: 4 },
          });
          const stale = yield* makeSqliteSnapshotPublication({ ...config, mode: 'open' });
          const row = yield* store.reserve(f.original());
          expect(Result.isFailure(yield* Effect.result(stale.pending()))).toBe(true);
          yield* store.accept(row);
          expect((yield* store.reserve(f.original())).phase).toBe('Accepted');
          expect(
            Result.isFailure(yield* Effect.result(store.reserve(f.original('opaque/new'))))
          ).toBe(true);
          expect((yield* store.current())?.offset).toBe('opaque/a');
        })
      );
      for (const wrong of [
        { resource: 'other' },
        { model: 'flock' as const },
        { genesis: envelopeFixture(0, 199).context.genesis },
      ]) {
        expect(
          Result.isFailure(
            await run(
              Effect.result(makeSqliteSnapshotPublication({ ...config, ...wrong, mode: 'open' }))
            )
          )
        ).toBe(true);
      }
      const db = new Database(config.path);
      db.prepare('UPDATE snapshot_publications SET phase=?').run('Pending');
      db.close();
      expect(
        Result.isFailure(
          await run(Effect.result(makeSqliteSnapshotPublication({ ...config, mode: 'open' })))
        )
      ).toBe(true);
    } finally {
      rmSync(f.dir, { recursive: true, force: true });
    }
  });
});
