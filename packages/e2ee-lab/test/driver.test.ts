import { Deferred, Effect, Fiber, Result } from 'effect';
import Database from 'better-sqlite3';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { driveLabPermits, LabDriverError } from '../src/platform/driver';
import { makeLabRuntime } from '../src/platform/runtime';
import type { ScheduleChoice } from '../src/pure/schedule';
import { identityKey } from '../src/pure/schedule';
import { fixture } from './ledger-fixture';
const bridge = <A>(work: () => Promise<A>) =>
  Effect.tryPromise({ try: work, catch: (error) => error });
const choice = (actor: string, occurrence = 0, parent?: string): ScheduleChoice => ({
  kind: 'permit',
  identity: { actor, operation: 'persist', phase: 'save', parent },
  occurrence,
});
const latch = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

describe('strict finite permit driver', () => {
  it('records and replays real SQLite writes in recorded order despite reversed request order, including nested repeats', async () => {
    const f = await fixture();
    const db = new Database(join(f.dir, 'schedule.sqlite'));
    db.exec('CREATE TABLE effects (actor TEXT NOT NULL)');
    try {
      const recorded = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const runtime = yield* makeLabRuntime({ mode: 'manual', time: 0, fetch });
            const work = bridge(() =>
              Promise.all(
                ['alice', 'bob'].map((actor) =>
                  runtime.phase(actor, 'persist', 'save', async () => {
                    for (let index = 0; index < 2; index++)
                      await runtime.phase(actor, 'persist', 'save', async () => {
                        db.prepare('INSERT INTO effects VALUES (?)').run(`${actor}:${index}`);
                      });
                  })
                )
              )
            );
            yield* driveLabPermits(runtime, 'record', work, { maxSteps: 6 });
            return runtime.permitLog.map((entry) => ({
              ...entry,
              identity: { ...entry.identity },
            }));
          })
        )
      );
      expect(db.prepare('SELECT actor FROM effects ORDER BY rowid').all()).toEqual([
        { actor: 'alice:0' },
        { actor: 'alice:1' },
        { actor: 'bob:0' },
        { actor: 'bob:1' },
      ]);
      expect(recorded.map((row) => row.occurrence)).toEqual([0, 0, 1, 0, 0, 1]);
      db.exec('DELETE FROM effects');
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const runtime = yield* makeLabRuntime({ mode: 'manual', time: 0, fetch });
            yield* driveLabPermits(
              runtime,
              recorded,
              bridge(() =>
                Promise.all(
                  ['bob', 'alice'].map((actor) =>
                    runtime.phase(actor, 'persist', 'save', async () => {
                      for (let index = 0; index < 2; index++)
                        await runtime.phase(actor, 'persist', 'save', async () => {
                          db.prepare('INSERT INTO effects VALUES (?)').run(`${actor}:${index}`);
                        });
                    })
                  )
                )
              ),
              { maxSteps: 6 }
            );
            expect(runtime.permitLog.map(({ eventId: _id, ...entry }) => entry)).toEqual(
              recorded.map(({ eventId: _id, ...entry }) => entry)
            );
          })
        )
      );
      expect(db.prepare('SELECT actor FROM effects ORDER BY rowid').all()).toEqual([
        { actor: 'alice:0' },
        { actor: 'alice:1' },
        { actor: 'bob:0' },
        { actor: 'bob:1' },
      ]);
    } finally {
      db.close();
      await f.close();
    }
  });

  it('does not pull later choices forward or skip missing identity, parent or occurrence; explicit stop leaves native rows unchanged', async () => {
    const f = await fixture();
    const db = new Database(join(f.dir, 'refused.sqlite'));
    db.exec('CREATE TABLE effects (actor TEXT NOT NULL)');
    try {
      for (const schedule of [
        [choice('missing'), choice('alice')],
        [choice('alice', 0, 'different|parent|phase')],
        [choice('alice', 1)],
        [],
      ])
        await Effect.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              const runtime = yield* makeLabRuntime({ mode: 'manual', time: 0, fetch });
              const stop = yield* Deferred.make<void>();
              const result = yield* Effect.forkChild(
                Effect.result(
                  driveLabPermits(
                    runtime,
                    schedule,
                    bridge(() =>
                      runtime.phase('alice', 'persist', 'save', async () => {
                        db.prepare('INSERT INTO effects VALUES (?)').run('alice');
                      })
                    ),
                    { maxSteps: 10, stop: Deferred.await(stop) }
                  )
                )
              );
              yield* Effect.promise(() => runtime.whenRequested(1));
              yield* Deferred.succeed(stop, undefined);
              const outcome = yield* Fiber.join(result);
              expect(Result.isFailure(outcome)).toBe(true);
              if (Result.isFailure(outcome)) {
                expect(outcome.failure).toBeInstanceOf(LabDriverError);
                expect((outcome.failure as LabDriverError).divergence?.field).toBe(
                  schedule.length ? 'schedule.missing' : 'schedule.extra'
                );
              }
              expect(runtime.permitLog).toEqual([]);
              expect(db.prepare('SELECT actor FROM effects').all()).toEqual([]);
            })
          )
        );
    } finally {
      db.close();
      await f.close();
    }
  });

  it('checks the exact permit budget before native work and refuses unused recorded entries on normal completion', async () => {
    const f = await fixture();
    const db = new Database(join(f.dir, 'budget.sqlite'));
    db.exec('CREATE TABLE effects (actor TEXT NOT NULL)');
    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const runtime = yield* makeLabRuntime({ mode: 'manual', time: 0, fetch });
            const result = yield* Effect.result(
              driveLabPermits(
                runtime,
                'record',
                bridge(async () => {
                  for (const actor of ['alice', 'bob'])
                    await runtime.phase(actor, 'persist', 'save', async () => {
                      db.prepare('INSERT INTO effects VALUES (?)').run(actor);
                    });
                }),
                { maxSteps: 1 }
              )
            );
            expect(Result.isFailure(result)).toBe(true);
            if (Result.isFailure(result)) expect(result.failure).toMatchObject({ code: 'budget' });
            expect(runtime.permitLog).toHaveLength(1);
            expect(db.prepare('SELECT actor FROM effects').all()).toEqual([{ actor: 'alice' }]);
          })
        )
      );
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const runtime = yield* makeLabRuntime({ mode: 'manual', time: 0, fetch });
            const result = yield* Effect.result(
              driveLabPermits(runtime, [choice('alice')], Effect.void, { maxSteps: 1 })
            );
            expect(Result.isFailure(result)).toBe(true);
            if (Result.isFailure(result))
              expect(result.failure).toMatchObject({
                code: 'divergence',
                divergence: { field: 'schedule.missing', actual: 'missing' },
              });
          })
        )
      );
    } finally {
      db.close();
      await f.close();
    }
  });

  it.each(['stop', 'interrupt'] as const)(
    '%s aborts and waits an actual HTTP borrower before closing native SQLite and refuses the late response',
    async (ending) => {
      const f = await fixture();
      const db = new Database(join(f.dir, 'settlement.sqlite'));
      db.exec('CREATE TABLE effects (body BLOB NOT NULL)');
      const entered = latch(),
        aborted = latch(),
        release = latch();
      let settled = false,
        closedEarly = false;
      try {
        await Effect.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              // Explicit abort-ignoring gate around an actual native HTTP read/body/SQLite write.
              const runtime = yield* makeLabRuntime({
                mode: 'manual',
                time: 0,
                fetch: async (input) => {
                  const request = input as Request;
                  request.signal.addEventListener('abort', aborted.resolve, { once: true });
                  entered.resolve();
                  await release.promise;
                  const response = await fetch(request.url);
                  const bytes = new Uint8Array(await response.arrayBuffer());
                  db.prepare('INSERT INTO effects VALUES (?)').run(bytes);
                  settled = true;
                  return new Response(bytes, {
                    status: response.status,
                    headers: response.headers,
                  });
                },
              });
              runtime.addFinalizer(
                Effect.sync(() => {
                  closedEarly = !settled;
                  db.close();
                })
              );
              const stop = yield* Deferred.make<void>();
              const worker = yield* Effect.forkChild(
                Effect.result(
                  driveLabPermits(
                    runtime,
                    'record',
                    bridge(() =>
                      runtime.gatedFetch('alice')(
                        `${f.server.baseUrl}/ds/synthetic/control?offset=-1`
                      )
                    ).pipe(Effect.uninterruptible),
                    { maxSteps: 10, stop: Deferred.await(stop) }
                  )
                )
              );
              yield* Effect.promise(() => entered.promise);
              const endingFiber = yield* Effect.forkChild(
                ending === 'stop'
                  ? Deferred.succeed(stop, undefined).pipe(Effect.asVoid)
                  : Fiber.interrupt(worker).pipe(Effect.asVoid)
              );
              yield* Effect.promise(() => aborted.promise);
              const premature = worker.pollUnsafe();
              const openBeforeRelease = db.open;
              release.resolve();
              yield* Fiber.join(endingFiber);
              const outcome = yield* Effect.exit(Fiber.join(worker));
              expect(premature).toBeUndefined();
              expect(openBeforeRelease).toBe(true);
              if (ending === 'interrupt') expect(outcome._tag).toBe('Failure');
              else {
                expect(outcome._tag).toBe('Success');
                if (outcome._tag === 'Success') {
                  expect(Result.isFailure(outcome.value)).toBe(true);
                  if (Result.isFailure(outcome.value))
                    expect(outcome.value.failure).toMatchObject({ code: 'stopped' });
                }
              }
              expect(settled).toBe(true);
              expect(closedEarly).toBe(false);
              expect(db.open).toBe(false);
              expect(runtime.frames).toEqual([]);
              const reopened = new Database(join(f.dir, 'settlement.sqlite'));
              try {
                expect(
                  (reopened.prepare('SELECT body FROM effects').get() as { body: Buffer }).body
                    .byteLength
                ).toBeGreaterThan(0);
              } finally {
                reopened.close();
              }
            })
          )
        );
      } finally {
        release.resolve();
        if (db.open) db.close();
        await f.close();
      }
    }
  );

  it('rejects auto grants, unsupported actions and ambiguous parent labels before starting work; counter keys do not alias', async () => {
    expect(identityKey({ actor: 'a|b', operation: 'c', phase: 'd' })).not.toBe(
      identityKey({ actor: 'a', operation: 'b|c', phase: 'd' })
    );
    for (const input of [
      { mode: 'auto' as const, choices: [] },
      { mode: 'manual' as const, choices: [{ ...choice('alice'), kind: 'attack' as const }] },
      { mode: 'manual' as const, choices: [choice('alice|bob')] },
    ])
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const runtime = yield* makeLabRuntime({ mode: input.mode, time: 0, fetch });
            const result = yield* Effect.result(
              driveLabPermits(runtime, input.choices, Effect.die('work must not run'), {
                maxSteps: 1,
              })
            );
            expect(Result.isFailure(result)).toBe(true);
            if (Result.isFailure(result))
              expect(result.failure).toMatchObject({ code: 'configuration' });
            expect(runtime.events()).toEqual([]);
          })
        )
      );
  });
});
