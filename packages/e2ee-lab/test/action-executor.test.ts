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
