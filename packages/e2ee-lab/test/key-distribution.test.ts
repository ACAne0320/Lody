import { createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect, Result } from 'effect';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { Bytes } from '@lody/e2ee-core';
import { hashRecordBytes, verifyLedger } from '@lody/e2ee-core/ledger';
import {
  signGenesisRecord,
  prepareDeviceAdmission,
  prepareLedgerCommand,
} from '@lody/e2ee-core/ledger/admission';
import { signLedgerRecord } from '@lody/e2ee-core/ledger/signing';
import { makeSqliteKeyMailbox } from '@lody/e2ee-core/keys/mailbox/sqlite';
import { makeSqliteProtectedEpochKeys } from '@lody/e2ee-core/keys/host/sqlite';
import { makeSqliteKeyDistribution } from '@lody/e2ee-core/keys/host/distribution/sqlite';
import { makeSqliteRecipientMailbox } from '@lody/e2ee-core/keys/host/mailbox/sqlite';
import { makeLabMailboxRemote } from '../src/platform/key-mailbox';
import { makeSyntheticMailboxHttp } from './mailbox-http-fixture';
import { syntheticProtector } from './content-fixture';
const ok = Result.getOrThrow;
const signer = (seed: number) => {
  const privateKey = createPrivateKey({
    key: Buffer.concat([
      Buffer.from('302e020100300506032b657004220420', 'hex'),
      Buffer.alloc(32, seed),
    ]),
    format: 'der',
    type: 'pkcs8',
  });
  return {
    publicKey: ok(
      Bytes.signingPublicKey(
        new Uint8Array(
          createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).subarray(-32)
        )
      )
    ),
    sign: (message: Uint8Array) =>
      Effect.sync(() => ok(Bytes.signature(new Uint8Array(sign(null, message, privateKey))))),
  };
};
describe('Lab finite key rounds using public HPKE/SQLite/HTTP owners', () => {
  it('delivers original envelopes, installs with real save/readback and reports over HTTP; reopened Recovery cannot send', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lab-key-round-'));
    // Test-only native device creation. No production key store, replay entropy override or real account.
    const pair = (await crypto.subtle.generateKey('X25519', true, ['deriveBits'])) as CryptoKeyPair;
    const ownerPair = (await crypto.subtle.generateKey('X25519', true, [
      'deriveBits',
    ])) as CryptoKeyPair;
    const ownerEncryptionPublicKey = ok(
      Bytes.encryptionPublicKey(
        new Uint8Array(await crypto.subtle.exportKey('raw', ownerPair.publicKey))
      )
    );
    const encryptionPublicKey = ok(
      Bytes.encryptionPublicKey(
        new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
      )
    );
    const owner = signer(101),
      recovery = signer(102),
      membershipId = ok(Bytes.membershipId(new Uint8Array(16).fill(103)));
    const key = ok(Bytes.epochKey(new Uint8Array(32).fill(104)));
    const file = (name: string) => join(dir, `${name}.sqlite`);
    try {
      const genesis = await Effect.runPromise(
        signGenesisRecord({
          userId: ok(Bytes.userId(new Uint8Array(32).fill(105))),
          membershipId,
          encryptionPublicKey: ownerEncryptionPublicKey,
          initialKey: key,
          signer: owner,
        })
      );
      const records: Uint8Array[] = [genesis.record];
      const view = () =>
        ok(
          verifyLedger({
            anchor: genesis.genesis,
            records,
            checkpoint: { head: hashRecordBytes(records.at(-1)!), length: records.length },
          })
        );
      const command = await Effect.runPromise(
        prepareDeviceAdmission({
          genesis: genesis.genesis,
          membershipId,
          encryptionPublicKey,
          kind: 'recovery',
          signer: recovery,
        })
      );
      records.push(
        await Effect.runPromise(
          signLedgerRecord(ok(prepareLedgerCommand(view(), owner.publicKey, command)), owner)
        )
      );
      const ledger = () => Effect.sync(view);
      const slot = {
        genesis: Buffer.from(genesis.genesis.toBytes()).toString('hex'),
        epoch: 0,
        recipient: Buffer.from(recovery.publicKey.toBytes()).toString('hex'),
      };
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const keys = yield* makeSqliteProtectedEpochKeys({
              path: file('owner-keys'),
              mode: 'create',
              genesis: genesis.genesis,
              recipient: owner.publicKey,
              ledger,
              protector: syntheticProtector,
            });
            yield* keys.saveAndReload(0, key);
            const host = yield* makeSqliteKeyMailbox({
              path: file('host'),
              mode: 'create',
              genesis: genesis.genesis,
              ledger,
            });
            const ownerUrl = yield* makeSyntheticMailboxHttp(ok(host.bind(owner.publicKey)));
            const receiverUrl = yield* makeSyntheticMailboxHttp(ok(host.bind(recovery.publicKey)));
            const remote = yield* makeLabMailboxRemote({ url: ownerUrl, fetch });
            let tamper = false;
            const receiverRemote = yield* makeLabMailboxRemote({
              url: receiverUrl,
              fetch: async (input, init) => {
                const response = await fetch(input, init);
                if (!tamper || JSON.parse(String(init?.body)).op !== 'fetch') return response;
                const page = (await response.json()) as {
                  items: { sender: string; frame: string }[];
                  next: string | null;
                };
                const bytes = Buffer.from(page.items[0]!.frame, 'hex');
                bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 1;
                page.items[0]!.frame = bytes.toString('hex');
                return new Response(JSON.stringify(page), { status: response.status });
              },
            });
            const distributor = yield* makeSqliteKeyDistribution({
              path: file('owner-receive'),
              mode: 'create',
              genesis: genesis.genesis,
              signer: owner,
              pair: ownerPair,
              ledger,
              remote,
              keyStore: { path: file('owner-keys'), mode: 'open', protector: syntheticProtector },
              repairStore: { path: file('owner-repair'), mode: 'create' },
              sendStore: { path: file('owner-send'), mode: 'create' },
              outboxStore: { path: file('owner-outbox'), mode: 'create' },
              currentPublication: () => Effect.succeed(genesis.record),
            });
            expect(yield* distributor.reconcileCurrentEpoch()).toEqual({
              scheduled: 1,
              next: null,
              blocked: [],
            });
            expect((yield* distributor.resumePendingDeliveries()).blocked).toEqual([]);
            expect((yield* remote.status(slot)).status).toBe('EnvelopeStored');
            const before = yield* receiverRemote.fetch(0, null, 100);
            expect(before.items).toHaveLength(1);
            const receiver = yield* makeSqliteRecipientMailbox({
              path: file('recovery-receive'),
              mode: 'create',
              genesis: genesis.genesis,
              signer: recovery,
              pair,
              ledger,
              remote: receiverRemote,
              keyStore: {
                path: file('recovery-keys'),
                mode: 'create',
                protector: syntheticProtector,
              },
              repairStore: { path: file('recovery-repair'), mode: 'create' },
            });
            tamper = true;
            expect(Result.isFailure(yield* Effect.result(receiver.fetchAndInstall()))).toBe(true);
            expect((yield* remote.status(slot)).status).toBe('EnvelopeStored');
            const db = new Database(file('recovery-keys'), { fileMustExist: true });
            try {
              expect(db.prepare('SELECT count(*) AS n FROM protected_epoch_keys').get()).toEqual({
                n: 0,
              });
            } finally {
              db.close();
            }
            tamper = false;
            expect(yield* receiver.fetchAndInstall()).toEqual({ processed: 1, next: null });
            yield* receiver.flushReports();
            expect((yield* remote.status(slot)).status).toBe('InstallationReported');
            expect((yield* receiver.results()).map((item) => item.outcome)).toEqual(['Reported']);
            expect((yield* distributor.reconcileCurrentEpoch()).scheduled).toBe(0);
            expect((yield* receiverRemote.fetch(0, null, 100)).items[0]!.frame).toEqual(
              before.items[0]!.frame
            );
          })
        )
      );
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const host = yield* makeSqliteKeyMailbox({
              path: file('host'),
              mode: 'open',
              genesis: genesis.genesis,
              ledger,
            });
            const url = yield* makeSyntheticMailboxHttp(ok(host.bind(recovery.publicKey)));
            const remote = yield* makeLabMailboxRemote({ url, fetch });
            const reopened = yield* makeSqliteKeyDistribution({
              path: file('recovery-receive'),
              mode: 'open',
              genesis: genesis.genesis,
              signer: recovery,
              pair,
              ledger,
              remote,
              keyStore: {
                path: file('recovery-keys'),
                mode: 'open',
                protector: syntheticProtector,
              },
              repairStore: { path: file('recovery-repair'), mode: 'open' },
              sendStore: { path: file('recovery-send'), mode: 'create' },
              outboxStore: { path: file('recovery-outbox'), mode: 'create' },
              currentPublication: () => Effect.succeed(null),
            });
            expect((yield* reopened.results()).map((item) => item.outcome)).toEqual(['Reported']);
            expect(yield* reopened.reconcileCurrentEpoch()).toEqual({
              scheduled: 0,
              next: null,
              blocked: [],
            });
            expect((yield* remote.status(slot)).status).toBe('InstallationReported');
          })
        )
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
