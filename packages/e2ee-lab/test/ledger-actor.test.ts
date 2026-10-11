import { runOwnedChild } from './native-child';
import { writeFileSync } from 'node:fs';
import { createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { Effect, Result } from 'effect';
import { Bytes } from '@lody/e2ee-core';
import { prepareDeviceAdmission } from '@lody/e2ee-core/ledger/admission';
import { hashRecordBytes, verifyLedger } from '@lody/e2ee-core/ledger';
import type { LedgerSubmissionStream } from '@lody/e2ee-core/submission/streams';
import { expect, it } from 'vitest';
import { makeLabLedgerActor } from '../src/platform/ledger-actor';
import { fixture, options } from './ledger-fixture';
const ok = Result.getOrThrow;
async function admission(f: Awaited<ReturnType<typeof fixture>>) {
  const key = createPrivateKey({
    key: Buffer.concat([
      Buffer.from('302e020100300506032b657004220420', 'hex'),
      Buffer.alloc(32, 61),
    ]),
    format: 'der',
    type: 'pkcs8',
  });
  const publicKey = ok(
    Bytes.signingPublicKey(
      new Uint8Array(createPublicKey(key).export({ format: 'der', type: 'spki' }).subarray(-32))
    )
  );
  return Effect.runPromise(
    prepareDeviceAdmission({
      genesis: f.anchor,
      membershipId: f.membership,
      encryptionPublicKey: ok(Bytes.encryptionPublicKey(new Uint8Array(32).fill(62))),
      kind: 'personal',
      signer: {
        publicKey,
        sign: (message) =>
          Effect.sync(() => ok(Bytes.signature(new Uint8Array(sign(null, message, key))))),
      },
    })
  );
}
function checkpoint(records: readonly Uint8Array[]) {
  return { head: hashRecordBytes(records[records.length - 1]!), length: records.length };
}
it('uses public proposal/signing and unchanged P09; an unacknowledged result forbids new signing', async () => {
  const f = await fixture();
  try {
    const command = await admission(f);
    const originals = [...f.records];
    let signs = 0;
    const stream = {
      read: f.sdk.read.bind(f.sdk),
      appendCas: async (input: Parameters<LedgerSubmissionStream['appendCas']>[0]) => {
        const output = await f.sdk.appendCas(input);
        if (output.ok && output.result.kind === 'ok')
          originals.push(new Uint8Array(input.part.body.subarray(4)));
        return output;
      },
    };
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const actor = yield* makeLabLedgerActor({
            ...options(f, 'create'),
            stream,
            journalPath: join(f.dir, 'pending.sqlite'),
            checkpoint: () => Effect.sync(() => checkpoint(originals)),
            signer: {
              publicKey: f.owner.publicKey,
              sign: (message) => {
                signs++;
                return f.owner.sign(message);
              },
            },
          });
          const result = yield* actor.execute(command);
          expect(result.outcome).toBe('Committed');
          expect(signs).toBe(1);
          expect((yield* actor.current()).view.length).toBe(3);
          const blocked = yield* Effect.result(actor.execute(command));
          expect(Result.isFailure(blocked)).toBe(true);
          expect(signs).toBe(1);
          yield* actor.acknowledge(result);
          expect(yield* actor.resume()).toBeNull();
        })
      )
    );
    expect(
      ok(verifyLedger({ anchor: f.anchor, records: originals, checkpoint: checkpoint(originals) }))
        .length
    ).toBe(3);
  } finally {
    await f.close();
  }
});
it('retains the exact terminal result when feed persistence fails, then resumes without another signature', async () => {
  const f = await fixture();
  try {
    const command = await admission(f);
    const originals = [...f.records];
    let signs = 0;
    let failFeed: () => void = () => {};
    const stream = {
      read: f.sdk.read.bind(f.sdk),
      appendCas: async (input: Parameters<LedgerSubmissionStream['appendCas']>[0]) => {
        const output = await f.sdk.appendCas(input);
        if (output.ok && output.result.kind === 'ok') {
          originals.push(new Uint8Array(input.part.body.subarray(4)));
          failFeed();
        }
        return output;
      },
    };
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const actor = yield* makeLabLedgerActor({
            ...options(f, 'create'),
            stream,
            journalPath: join(f.dir, 'pending.sqlite'),
            checkpoint: () => Effect.sync(() => checkpoint(originals)),
            signer: {
              publicKey: f.owner.publicKey,
              sign: (message) => {
                signs++;
                return f.owner.sign(message);
              },
            },
          });
          yield* actor.refresh();
          const db = new Database(f.path);
          try {
            failFeed = () => {
              db.exec(
                'CREATE TRIGGER deny_feed BEFORE UPDATE ON ledger_feed_meta BEGIN SELECT RAISE(IGNORE); END'
              );
            };
            expect(Result.isFailure(yield* Effect.result(actor.execute(command)))).toBe(true);
            // The unchanged P09 terminal row remains present while feed/cursor stays older.
            const result = { outcome: 'Committed' as const, record: originals[2]! };
            expect(Result.isFailure(yield* Effect.result(actor.acknowledge(result)))).toBe(true);
            expect((yield* actor.current()).view.length).toBe(2);
            db.exec('DROP TRIGGER deny_feed');
            expect(signs).toBe(1);
          } finally {
            db.close();
          }
        })
      )
    );
    const config = join(f.dir, 'actor-child.json');
    const endpoint = checkpoint(originals);
    writeFileSync(
      config,
      JSON.stringify({
        path: f.path,
        journalPath: join(f.dir, 'pending.sqlite'),
        url: `${f.server.baseUrl}/ds/synthetic/control`,
        genesis: Buffer.from(f.genesis).toString('hex'),
        anchor: Buffer.from(f.anchor.toBytes()).toString('hex'),
        localHead: Buffer.from(f.checkpoint.head.toBytes()).toString('hex'),
        head: Buffer.from(endpoint.head.toBytes()).toString('hex'),
        length: endpoint.length,
        publicKey: Buffer.from(f.owner.publicKey.toBytes()).toString('hex'),
      }),
      { mode: 0o600 }
    );
    const stdout = await Effect.runPromise(
      runOwnedChild(['--import', 'tsx', 'test/ledger-actor-reopen.mts', config])
    );
    expect(JSON.parse(stdout)).toEqual({
      outcome: 'Committed',
      record: Buffer.from(originals[2]!).toString('hex'),
      length: 3,
      empty: true,
    });
  } finally {
    await f.close();
  }
});
