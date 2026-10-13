import { Effect, Result, Deferred, Fiber, Exit, Scope } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { makeSqliteProtectedEpochKeys } from '@lody/e2ee-core/keys/host/sqlite';
import { synthetic } from './protection-fixture';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeHostEpochProtection, type NativeEpochProtector } from '@lody/e2ee-core/keys/host';
import { commitEpochKey } from '../../src/keys/history';
import { contentPermissions } from '@lody/e2ee-core/ledger';
import { envelopeFixture } from './fixture';
const ok = Result.getOrThrow;
const dirs: string[] = [];
const file = () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'e2ee-protected-'));
  dirs.push(dir);
  return path.join(dir, 'keys.sqlite');
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const wiped = (buffers: Uint8Array[]) =>
  expect(buffers.every((b) => b.every((x) => x === 0))).toBe(true);
const config = (f: ReturnType<typeof envelopeFixture>, protector: NativeEpochProtector) => ({
  genesis: f.context.genesis,
  recipient: f.phone.publicKey,
  ledger: f.ledger,
  protector,
});
describe('host-only epoch protection', () => {
  it('round trips an opaque key and wipes callback buffers without exporting through ordinary keys', async () => {
    const f = envelopeFixture(),
      native = synthetic();
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const host = yield* makeHostEpochProtection(config(f, native.protector));
          const blob = yield* host.seal(0, f.secret);
          wiped(native.plains);
          const key = yield* host.open(0, blob);
          expect(ok(commitEpochKey(f.context.genesis, 0, key))).toEqual(
            ok(commitEpochKey(f.context.genesis, 0, f.secret))
          );
          wiped(native.plains);
          const bad = new Uint8Array(blob);
          bad[bad.length - 1] ^= 1;
          expect(Exit.isFailure(yield* Effect.exit(host.open(0, bad)))).toBe(true);
        })
      )
    );
    wiped(native.plains);
  });
  it('clears native failure and malformed result buffers and exposes only fixed error categories', async () => {
    const f = envelopeFixture(),
      native = synthetic();
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          let failed: Uint8Array | undefined;
          const broken = yield* makeHostEpochProtection(
            config(f, {
              ...native.protector,
              protect: async (body) => {
                failed = body;
                throw Error('synthetic sensitive native diagnostic');
              },
            })
          );
          const fault = yield* Effect.flip(broken.seal(0, f.secret));
          expect(fault.code).toBe('native-failed');
          expect(JSON.stringify(fault)).not.toContain('sensitive');
          expect(failed?.every((x) => x === 0)).toBe(true);
          const badSeal = yield* makeHostEpochProtection(
            config(f, { ...native.protector, protect: async () => new Uint8Array(8193) })
          );
          expect((yield* Effect.flip(badSeal.seal(0, f.secret))).code).toBe('invalid-input');
          const normal = yield* makeHostEpochProtection(config(f, native.protector)),
            blob = yield* normal.seal(0, f.secret);
          const malformed = new Uint8Array(162).fill(87);
          const badOpen = yield* makeHostEpochProtection(
            config(f, { ...native.protector, unprotect: async () => malformed })
          );
          expect((yield* Effect.flip(badOpen.open(0, blob))).code).toBe('binding-mismatch');
          expect(malformed.every((x) => x === 0)).toBe(true);
        })
      )
    );
    wiped(native.plains);
  });
  it('binds Org, epoch, recipient and purpose independently of a matching epoch-zero commitment', async () => {
    const f = envelopeFixture(),
      native = synthetic();
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const host = yield* makeHostEpochProtection(config(f, native.protector));
          const blob = yield* host.seal(0, f.secret);
          const wrongRecipient = yield* makeHostEpochProtection({
            ...config(f, native.protector),
            recipient: f.owner.publicKey,
          });
          expect(Exit.isFailure(yield* Effect.exit(wrongRecipient.open(0, blob)))).toBe(true);
          const other = envelopeFixture(0, 101);
          expect(ok(commitEpochKey(other.context.genesis, 0, other.secret))).toEqual(
            ok(commitEpochKey(f.context.genesis, 0, f.secret))
          );
          const wrongOrg = yield* makeHostEpochProtection(config(other, native.protector));
          expect((yield* Effect.flip(wrongOrg.open(0, blob))).code).toBe('binding-mismatch');
          for (const position of [0, 29, 61, 93, 97, 129]) {
            const body = yield* Effect.promise(() => native.protector.unprotect(blob));
            body[position] ^= 1;
            const changed = yield* Effect.promise(() => native.protector.protect(body));
            body.fill(0);
            expect((yield* Effect.flip(host.open(0, changed))).code).toBe(
              position === 129 ? 'commitment-mismatch' : 'binding-mismatch'
            );
          }
        })
      )
    );
    wiped(native.plains);
  });
  it('captures native capability once and rejects known recipient revocation', async () => {
    const f = envelopeFixture(),
      native = synthetic();
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const host = yield* makeHostEpochProtection(config(f, native.protector));
          const blob = yield* host.seal(0, f.secret);
          native.protector.unprotect = async () => {
            throw Error('mutated callback');
          };
          yield* host.open(0, blob);
          f.append([5, f.phone.raw]);
          expect(Exit.isFailure(yield* Effect.exit(host.open(0, blob)))).toBe(true);
        })
      )
    );
    wiped(native.plains);
  });
  it('scope close waits for native completion and clears plaintext before releasing the resource', async () => {
    const f = envelopeFixture(),
      native = synthetic();
    await Effect.runPromise(
      Effect.gen(function* () {
        const scope = yield* Scope.make(),
          closed = yield* Deferred.make<void>();
        let body: Uint8Array | undefined;
        let allow!: () => void, notify!: () => void;
        const wait = new Promise<void>((resolve) => {
            allow = resolve;
          }),
          entered = new Promise<void>((resolve) => {
            notify = resolve;
          });
        const protector: NativeEpochProtector = {
          ...native.protector,
          protect: (bytes) => {
            body = bytes;
            notify();
            return wait.then(() => native.protector.protect(bytes));
          },
        };
        const host = yield* makeHostEpochProtection(config(f, protector)).pipe(
          Effect.provideService(Scope.Scope, scope)
        );
        const worker = yield* Effect.forkChild(host.seal(0, f.secret));
        yield* Effect.promise(() => entered);
        const closer = yield* Effect.forkChild(
          Scope.close(scope, Exit.void).pipe(Effect.andThen(Deferred.succeed(closed, undefined)))
        );
        yield* Effect.yieldNow;
        expect(yield* Deferred.isDone(closed)).toBe(false);
        allow();
        expect(Exit.isFailure(yield* Fiber.await(worker))).toBe(true);
        yield* Fiber.join(closer);
        expect(body?.every((x) => x === 0)).toBe(true);
        expect(Exit.isFailure(yield* Effect.exit(host.seal(0, f.secret)))).toBe(true);
      })
    );
  });
  it('awaits cancelled native unprotect and wipes its late plaintext before interruption completes', async () => {
    const f = envelopeFixture(),
      native = synthetic();
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          let allow!: () => void, notify!: () => void;
          const release = new Promise<void>((resolve) => {
              allow = resolve;
            }),
            entered = new Promise<void>((resolve) => {
              notify = resolve;
            });
          let late: Uint8Array | undefined;
          const protector: NativeEpochProtector = {
            ...native.protector,
            unprotect: async (blob) => {
              late = await native.protector.unprotect(blob);
              notify();
              await release;
              return late;
            },
          };
          const host = yield* makeHostEpochProtection(config(f, protector));
          const blob = yield* host.seal(0, f.secret);
          const worker = yield* Effect.forkChild(host.open(0, blob));
          yield* Effect.promise(() => entered);
          const done = yield* Deferred.make<void>();
          const interrupt = yield* Effect.forkChild(
            Fiber.interrupt(worker).pipe(Effect.andThen(Deferred.succeed(done, undefined)))
          );
          yield* Effect.yieldNow;
          expect(yield* Deferred.isDone(done)).toBe(false);
          expect(late?.some((x) => x !== 0)).toBe(true);
          allow();
          yield* Fiber.join(interrupt);
          expect(Exit.isFailure(yield* Fiber.await(worker))).toBe(true);
          expect(late?.every((x) => x === 0)).toBe(true);
        })
      )
    );
  });
  it('saves protected bytes and reopens with fresh decrypt/commitment checks; retains uncertain failed readback', async () => {
    const f = envelopeFixture(),
      native = synthetic(),
      dbPath = file();
    const create = () =>
      makeSqliteProtectedEpochKeys({
        ...config(f, native.protector),
        path: dbPath,
        mode: 'create',
      });
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const store = yield* create();
          yield* store.saveAndReload(0, f.secret);
        })
      )
    );
    const inspect = new Database(dbPath);
    const blob = inspect.prepare('SELECT blob FROM protected_epoch_keys').get() as {
      blob: Uint8Array;
    };
    expect(blob.blob.length).toBeGreaterThan(32);
    inspect.close();
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const store = yield* makeSqliteProtectedEpochKeys({
            ...config(f, native.protector),
            path: dbPath,
            mode: 'open',
          });
          const key = yield* store.read(0);
          expect(ok(commitEpochKey(f.context.genesis, 0, key))).toEqual(
            ok(commitEpochKey(f.context.genesis, 0, f.secret))
          );
          yield* store.saveAndReload(0, f.secret);
        })
      )
    );
    const child = execFileSync(
      process.execPath,
      [
        '--import',
        'tsx',
        fileURLToPath(new URL('./protected-reopen.mts', import.meta.url)),
        dbPath,
      ],
      { encoding: 'utf8', timeout: 20_000 }
    );
    expect(child.trim()).toBe(
      Buffer.from(ok(commitEpochKey(f.context.genesis, 0, f.secret)).toBytes()).toString('hex')
    );
    f.append([5, f.owner.raw]);
    expect(ok(contentPermissions(f.view(), f.owner.publicKey))).toMatchObject({
      mayWriteDocument: false,
      maySealNewContent: false,
    });
    expect(Result.isFailure(await Effect.runPromise(Effect.result(f.prepare())))).toBe(true);
    const revokedChild = execFileSync(
      process.execPath,
      [
        '--import',
        'tsx',
        fileURLToPath(new URL('./protected-reopen.mts', import.meta.url)),
        dbPath,
        'sender-revoked',
      ],
      { encoding: 'utf8', timeout: 20_000 }
    );
    expect(revokedChild.trim()).toBe(
      Buffer.from(ok(commitEpochKey(f.context.genesis, 0, f.secret)).toBytes()).toString('hex')
    );
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const store = yield* makeSqliteProtectedEpochKeys({
            ...config(f, native.protector),
            path: dbPath,
            mode: 'open',
          });
          const restored = yield* store.read(0);
          expect(ok(commitEpochKey(f.context.genesis, 0, restored))).toEqual(
            ok(commitEpochKey(f.context.genesis, 0, f.secret))
          );
        })
      )
    );

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const store = yield* makeSqliteProtectedEpochKeys({
            ...config(f, {
              ...native.protector,
              unprotect: async () => {
                throw Error('locked');
              },
            }),
            path: dbPath,
            mode: 'open',
          });
          expect(Exit.isFailure(yield* Effect.exit(store.saveAndReload(0, f.secret)))).toBe(true);
        })
      )
    );
    const after = new Database(dbPath);
    expect(
      (after.prepare('SELECT blob FROM protected_epoch_keys').get() as { blob: Uint8Array }).blob
    ).toEqual(blob.blob);
    after.close();
    wiped(native.plains);
  });
  it('rejects foreign stores before mutation, storage failure before installation and persisted authority rollback', async () => {
    const f = envelopeFixture(),
      native = synthetic(),
      dbPath = file(),
      old = f.view();
    const foreign = new Database(dbPath);
    foreign.exec('CREATE TABLE original(x);PRAGMA application_id=123');
    foreign.close();
    const before = readFileSync(dbPath);
    const bad = await Effect.runPromise(
      Effect.scoped(
        Effect.exit(
          makeSqliteProtectedEpochKeys({
            ...config(f, native.protector),
            path: dbPath,
            mode: 'open',
          })
        )
      )
    );
    expect(Exit.isFailure(bad)).toBe(true);
    expect(readFileSync(dbPath)).toEqual(before);
    const actual = file();
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const store = yield* makeSqliteProtectedEpochKeys({
            ...config(f, native.protector),
            path: actual,
            mode: 'create',
          });
          const db = new Database(actual);
          db.exec(
            "CREATE TRIGGER reject_key BEFORE INSERT ON protected_epoch_keys BEGIN SELECT RAISE(ABORT,'synthetic disk failure'); END"
          );
          db.close();
          expect(Exit.isFailure(yield* Effect.exit(store.saveAndReload(0, f.secret)))).toBe(true);
          const check = new Database(actual);
          expect(check.prepare('SELECT count(*) AS n FROM protected_epoch_keys').get()).toEqual({
            n: 0,
          });
          check.exec('DROP TRIGGER reject_key');
          check.close();
          yield* store.saveAndReload(0, f.secret);
          f.append([5, f.phone.raw]);
          expect(Exit.isFailure(yield* Effect.exit(store.read(0)))).toBe(true);
        })
      )
    );
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const store = yield* makeSqliteProtectedEpochKeys({
            ...config(f, native.protector),
            path: actual,
            mode: 'open',
            ledger: () => Effect.succeed(old),
          });
          expect(Exit.isFailure(yield* Effect.exit(store.read(0)))).toBe(true);
        })
      )
    );
    wiped(native.plains);
  });
});

describe('verified host observations and durable authority readback', () => {
  it('does not pin a cloned view and remembers genuine revocation before missing-epoch rejection', async () => {
    const f = envelopeFixture(),
      native = synthetic(),
      old = f.view();
    let current = old;
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const host = yield* makeHostEpochProtection({
            ...config(f, native.protector),
            ledger: () => Effect.succeed(current),
          });
          const blob = yield* host.seal(0, f.secret);
          current = { ...old } as typeof old;
          expect(Exit.isFailure(yield* Effect.exit(host.open(1, blob)))).toBe(true);
          current = old;
          expect(ok(commitEpochKey(f.context.genesis, 0, yield* host.open(0, blob)))).toEqual(
            ok(commitEpochKey(f.context.genesis, 0, f.secret))
          );
          f.append([5, f.phone.raw]);
          current = f.view();
          expect(Exit.isFailure(yield* Effect.exit(host.open(1, blob)))).toBe(true);
          current = old;
          expect(
            Exit.isFailure(yield* Effect.exit(host.open(0, blob))),
            'known genuine revocation cannot be forgotten due to unavailable epoch'
          ).toBe(true);
        })
      )
    );
  });
  it.each(['none', 'abort', 'ignore', 'rewrite-head', 'rewrite-context'] as const)(
    'successful reads persist fixed authority; %s faults fail and retain knowledge',
    async (fault) => {
      const f = envelopeFixture(),
        native = synthetic(),
        old = f.view(),
        dbPath = file();
      let current = old;
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const store = yield* makeSqliteProtectedEpochKeys({
              ...config(f, native.protector),
              ledger: () => Effect.succeed(current),
              path: dbPath,
              mode: 'create',
            });
            yield* store.saveAndReload(0, f.secret);
            const db = new Database(dbPath);
            try {
              const original = db
                .prepare('SELECT blob FROM protected_epoch_keys WHERE epoch=0')
                .get() as { blob: Uint8Array };
              if (fault === 'abort' || fault === 'ignore')
                db.exec(
                  `CREATE TRIGGER fail_pin BEFORE UPDATE ON protected_key_meta BEGIN SELECT RAISE(${fault === 'abort' ? "ABORT,'fault'" : 'IGNORE'}); END`
                );
              if (fault === 'rewrite-head' || fault === 'rewrite-context')
                db.exec(
                  `CREATE TRIGGER fail_pin AFTER UPDATE ON protected_key_meta BEGIN UPDATE protected_key_meta SET ${fault === 'rewrite-head' ? `head=x'${Buffer.from(old.head.toBytes()).toString('hex')}',count=2` : "recipient='" + '00'.repeat(32) + "'"} WHERE id=1; END`
                );
              f.append([5, f.owner.raw]);
              const high = f.view();
              current = high;
              const read = yield* Effect.exit(store.read(0));
              const pin = db
                .prepare('SELECT genesis,recipient,count FROM protected_key_meta WHERE id=1')
                .get();
              expect(
                !Exit.isSuccess(read) || (pin as { count: number }).count === 3,
                'a successful key read must not silently drop the durable authority pin'
              ).toBe(true);
              expect(Exit.isSuccess(read)).toBe(fault === 'none');
              expect(pin).toEqual({
                genesis: Buffer.from(f.context.genesis.toBytes()).toString('hex'),
                recipient: Buffer.from(f.phone.raw).toString('hex'),
                count: fault === 'none' ? 3 : 2,
              });
              if (fault !== 'none') {
                db.exec('DROP TRIGGER fail_pin');
                current = old;
                expect(Exit.isFailure(yield* Effect.exit(store.read(0)))).toBe(true);
                current = high;
                const recovered = yield* store.read(0);
                expect(ok(commitEpochKey(f.context.genesis, 0, recovered))).toEqual(
                  ok(commitEpochKey(f.context.genesis, 0, f.secret))
                );
                expect(db.prepare('SELECT count FROM protected_key_meta WHERE id=1').get()).toEqual(
                  { count: 3 }
                );
              }
              expect(
                (
                  db.prepare('SELECT blob FROM protected_epoch_keys WHERE epoch=0').get() as {
                    blob: Uint8Array;
                  }
                ).blob
              ).toEqual(original.blob);
            } finally {
              db.close();
            }
          })
        )
      );
      // Success, including retry after a failed write, must reject old authority in another OS process.
      const child = spawnSync(
        process.execPath,
        [
          '--import',
          'tsx',
          fileURLToPath(new URL('./protected-reopen.mts', import.meta.url)),
          dbPath,
        ],
        { encoding: 'utf8', timeout: 20_000 }
      );
      expect(child.error).toBeUndefined();
      expect(child.status).not.toBeNull();
      expect(child.status).not.toBe(0);
      expect(child.stderr).toContain('unauthorized');
      const allowed = execFileSync(
        process.execPath,
        [
          '--import',
          'tsx',
          fileURLToPath(new URL('./protected-reopen.mts', import.meta.url)),
          dbPath,
          'sender-revoked',
        ],
        { encoding: 'utf8', timeout: 20_000 }
      );
      expect(allowed.trim()).toBe(
        Buffer.from(ok(commitEpochKey(f.context.genesis, 0, f.secret)).toBytes()).toString('hex')
      );
    }
  );
});
