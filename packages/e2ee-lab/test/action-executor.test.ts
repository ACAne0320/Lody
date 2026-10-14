import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { Effect, Result } from 'effect';
import { expect, it } from 'vitest';
import { runLabScenario } from '../src/platform/scenario-runner';
import { executeLabActions } from '../src/platform/action-executor';
import { makeLabScenarioFixture } from '../src/platform/scenario-fixture';
import { makeLabProcessActor } from '../src/platform/process-actor';
import { exportDevice } from '../src/platform/device';
import type { LabProcessReply } from '../src/platform/process-actor';
it('executes all finite kinds on real OS/HPKE/SQLite/SDK actors; bad cipher/storage retain the measured durable pair and lost ACK retries original bytes', async () => {
  const root = mkdtempSync(join(tmpdir(), 'lab-action-complete-'));
  try {
    const artifact = await Effect.runPromise(runLabScenario({ directory: root }));
    expect(artifact.run.verdict).toBe('pass');
    expect(artifact.run.observations).toHaveLength(39);
    expect(artifact.run.observations[18]!.reply.ok).toBe(false);
    expect(artifact.run.observations[18]!.reply.trace!.cipherChanged).toBeGreaterThan(0);
    expect(artifact.run.observations[32]!.reply.trace!.ackDropped).toBe(1);
    expect(artifact.run.observations[19]!.durability).toBe('pass');
    expect(artifact.run.observations[26]!.reply.ok).toBe(false);
    expect(artifact.run.observations[27]!.durability).toBe('pass');
    expect(artifact.run.observations[35]!.reply.value).toEqual({
      outcome: 'Committed',
      recordHex: artifact.originals[2]!.hex,
    });
    expect(artifact.originals).toHaveLength(3); // resume did not append/re-sign another record
    expect(
      artifact.ciphertext.every((stream) => stream.status === 200 && stream.bodyHex.length > 0)
    ).toBe(true);
    expect(artifact.implementation.releases.effect).toBe('4.0.2');
    expect(artifact.run.coverage.exactCiphertextReplay).toBe('unavailable');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 15000);
it('a known durable-loss defect is measured after actual SIGKILL/reopen, not timeout or a fake boolean', async () => {
  const root = mkdtempSync(join(tmpdir(), 'lab-action-negative-'));
  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const f = yield* makeLabScenarioFixture(join(root, 'fixture'));
          const device = yield* exportDevice(f.owner);
          const config = (mode: 'create' | 'open') =>
            Effect.sync(() => ({
              syntheticOnly: true as const,
              device,
              peerSigningKey: Buffer.from(f.peer.publicKey.toBytes()).toString('hex'),
              baseUrl: f.host.baseUrl,
              directory: f.directory,
              actor: 'owner' as const,
              mode,
              genesis: Buffer.from(f.genesis.toBytes()).toString('hex'),
              records: f.records.map((r) => Buffer.from(r).toString('hex')),
              point: {
                head: Buffer.from(f.point().head.toBytes()).toString('hex'),
                length: f.point().length,
              },
            }));
          const actual = yield* makeLabProcessActor(config);
          const defective = {
            ...actual,
            crash: () =>
              actual.crash().pipe(
                Effect.tap(() =>
                  Effect.acquireUseRelease(
                    Effect.sync(
                      () =>
                        new Database(join(f.directory, 'owner-loro.sqlite'), {
                          fileMustExist: true,
                        })
                    ),
                    (db) => Effect.sync(() => db.exec('DELETE FROM lab_document_state')),
                    (db) => Effect.sync(() => db.close())
                  )
                )
              ),
          };
          const result = yield* executeLabActions({
            actors: { owner: defective },
            maxSteps: 20,
            actions: [
              { kind: 'start', actor: 'owner', mode: 'create', expect: { ok: true } },
              {
                kind: 'call',
                actor: 'owner',
                operation: 'create',
                document: 'loro',
                expect: { ok: true },
              },
              {
                kind: 'call',
                actor: 'owner',
                operation: 'append',
                document: 'loro',
                text: 'persist me',
                expect: { ok: true },
              },
              { kind: 'crash', actor: 'owner', expect: { ok: true } },
              { kind: 'start', actor: 'owner', mode: 'open', expect: { ok: true } },
              {
                kind: 'call',
                actor: 'owner',
                operation: 'observe',
                document: 'loro',
                expect: { ok: true, text: 'persist me' },
              },
            ],
          });
          expect(result.observations.at(-1)!.reply.value).toMatchObject({ text: '' });
          expect(result.observations.at(-1)!.durability).toBe('violation');
          expect(result.verdict).toBe('violation');
        })
      )
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 10000);
it('preflights every initial action before any effect, ignores caller map override, and refuses unknown actors/kinds and forward observations', async () => {
  let started = false;
  const actor = {
    start: () =>
      Effect.sync(() => {
        started = true;
        return { ok: true } as LabProcessReply;
      }),
    call: () => Effect.succeed({ ok: true } as LabProcessReply),
    crash: () => Effect.succeed({ code: null, signal: 'SIGKILL' as const }),
    shutdown: () => Effect.void,
    pid: () => undefined,
    diagnostics: () => '',
  };
  for (const actions of [
    [{ kind: 'new-unknown', actor: 'owner' }],
    [
      {
        kind: 'call',
        actor: 'owner',
        operation: 'resume',
        expect: { ok: false, outcome: 'Committed' },
      },
    ],
    [{ kind: 'start', actor: 'missing', mode: 'create' }],
    [
      {
        kind: 'call',
        actor: 'owner',
        operation: 'observe',
        expect: { ok: true, unchangedFrom: 2 },
      },
    ],
  ]) {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.result(executeLabActions({ actors: { owner: actor }, actions, maxSteps: 10 }))
      )
    );
    expect(Result.isFailure(result)).toBe(true);
    expect(started).toBe(false);
  }
  const rows: unknown[] = [
    { kind: 'start', actor: 'owner', mode: 'create' },
    { kind: 'bad', actor: 'owner' },
  ];
  Object.defineProperty(rows, 0, {
    get() {
      rows.length = 1;
      return { kind: 'start', actor: 'owner', mode: 'create' };
    },
  });
  const result = await Effect.runPromise(
    Effect.scoped(
      Effect.result(executeLabActions({ actors: { owner: actor }, actions: rows, maxSteps: 10 }))
    )
  );
  expect(Result.isFailure(result)).toBe(true);
  expect(started).toBe(false);
});

it.each([
  { name: 'wrong text with unchanged actual SQL pair', wrongText: true, changed: false },
  { name: 'correct text with changed actual SQL pair', wrongText: false, changed: true },
  { name: 'correct text with unchanged actual SQL pair', wrongText: false, changed: false },
])(
  'aggregates both durable expectations: $name',
  async ({ wrongText, changed }) => {
    const root = mkdtempSync(join(tmpdir(), 'lab-action-conjunction-'));
    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const f = yield* makeLabScenarioFixture(join(root, 'fixture'));
            const device = yield* exportDevice(f.owner);
            const actor = yield* makeLabProcessActor((mode) =>
              Effect.sync(() => ({
                syntheticOnly: true as const,
                device,
                peerSigningKey: Buffer.from(f.peer.publicKey.toBytes()).toString('hex'),
                baseUrl: f.host.baseUrl,
                directory: f.directory,
                actor: 'owner' as const,
                mode,
                genesis: Buffer.from(f.genesis.toBytes()).toString('hex'),
                records: f.records.map((record) => Buffer.from(record).toString('hex')),
                point: {
                  head: Buffer.from(f.point().head.toBytes()).toString('hex'),
                  length: f.point().length,
                },
              }))
            );
            let observed = 0;
            // Only the wrong-text negative control projects a defective observation.
            // The OS actor supplies the actual SQL digests; the changed-pair case
            // performs a real additional edit and durable write instead of faking them.
            const measured = {
              ...actor,
              call: (...args: Parameters<typeof actor.call>) =>
                actor.call(...args).pipe(
                  Effect.map((reply) => {
                    if (args[0] === 'observe' && ++observed === 2 && wrongText)
                      return {
                        ...reply,
                        value: { ...(reply.value as object), text: 'wrong observed text' },
                      };
                    return reply;
                  })
                ),
            };
            const result = yield* executeLabActions({
              actors: { owner: measured },
              maxSteps: 20,
              actions: [
                { kind: 'start', actor: 'owner', mode: 'create', expect: { ok: true } },
                {
                  kind: 'call',
                  actor: 'owner',
                  operation: 'create',
                  document: 'loro',
                  expect: { ok: true },
                },
                {
                  kind: 'call',
                  actor: 'owner',
                  operation: 'append',
                  document: 'loro',
                  text: 'expected original',
                  expect: { ok: true },
                },
                {
                  kind: 'call',
                  actor: 'owner',
                  operation: 'observe',
                  document: 'loro',
                  expect: { ok: true, text: 'expected original' },
                },
                ...(changed
                  ? [
                      {
                        kind: 'call',
                        actor: 'owner',
                        operation: 'append',
                        document: 'loro',
                        text: '+',
                        expect: { ok: true },
                      },
                    ]
                  : []),
                {
                  kind: 'call',
                  actor: 'owner',
                  operation: 'observe',
                  document: 'loro',
                  expect: {
                    ok: true,
                    text: changed ? 'expected original+' : 'expected original',
                    unchangedFrom: 3,
                  },
                },
              ],
            });
            const prior = result.observations[3]!.reply.value as { persisted: unknown };
            const last = result.observations.at(-1)!;
            const value = last.reply.value as { persisted: unknown; text: string };
            if (changed) expect(value.persisted).not.toEqual(prior.persisted);
            else expect(value.persisted).toEqual(prior.persisted);
            expect(value.text).toBe(
              wrongText
                ? 'wrong observed text'
                : changed
                  ? 'expected original+'
                  : 'expected original'
            );
            expect(last.checks.text).toBe(wrongText ? 'violation' : 'pass');
            expect(last.checks.unchangedFrom).toBe(changed ? 'violation' : 'pass');
            const verdict = wrongText || changed ? 'violation' : 'pass';
            expect(last.durability).toBe(verdict);
            expect(result.verdict).toBe(verdict);
          })
        )
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
  15000
);

it('preserves ok/outcome failures and missing measurements instead of turning them into passes', async () => {
  for (const { reply, expected, verdict } of [
    {
      reply: { ok: false, value: { outcome: 'Committed' } },
      expected: { ok: true, outcome: 'Committed' },
      verdict: 'harness-error',
    },
    {
      reply: { ok: true, value: { outcome: 'Conflicted' } },
      expected: { ok: true, outcome: 'Committed' },
      verdict: 'harness-error',
    },
    {
      reply: { ok: true, value: { outcome: 'Committed' } },
      expected: { ok: true, outcome: 'Committed' },
      verdict: 'pass',
    },
    { reply: { ok: true }, expected: { ok: false }, verdict: 'violation' },
    {
      reply: { ok: false },
      expected: { ok: true, text: 'not observed' },
      verdict: 'harness-error',
    },
    { reply: { ok: true }, expected: undefined, verdict: 'unavailable' },
  ]) {
    const actor = {
      start: () => Effect.succeed(reply as LabProcessReply),
      // This reply fixture has the same asynchronous IPC boundary as an actor.
      call: () => Effect.promise(() => Promise.resolve(reply as LabProcessReply)),
      crash: () => Effect.succeed({ code: null, signal: 'SIGKILL' as const }),
      shutdown: () => Effect.void,
      pid: () => undefined,
      diagnostics: () => '',
    };
    const result = await Effect.runPromise(
      Effect.scoped(
        executeLabActions({
          actors: { owner: actor },
          maxSteps: 5,
          actions: [{ kind: 'call', actor: 'owner', operation: 'resume', expect: expected }],
        })
      )
    );
    expect(result.verdict).toBe(verdict);
    expect(result.observations[0]!.integrity).toBe(verdict);
    if (expected?.text) expect(result.observations[0]!.checks.text).toBe('harness-error');
  }
});
