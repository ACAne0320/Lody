import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Effect, Exit, Result } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';
import { Bytes, encodeCbor } from '@lody/e2ee-core';
import {
  extendLedger,
  hashRecordBytes,
  verifyLedger,
  type LedgerView,
} from '@lody/e2ee-core/ledger';
import { prepareLedgerRecord, signLedgerRecord } from '@lody/e2ee-core/ledger/signing';
import { commitEpochKey, sealHistoryPacket } from '@lody/e2ee-core/keys';
import { prepareEpochEnvelope } from '@lody/e2ee-core/keys/envelope';
import {
  ownEpochStagedGroup,
  obsoleteEpochStagedGroup,
  sameEpochStagedGroup,
  type EpochStagedGroup,
} from '@lody/e2ee-core/keys/staging';
import {
  signGenesisRecord,
  prepareDeviceAdmission,
  prepareLedgerCommand,
} from '@lody/e2ee-core/ledger/admission';
import { generateDevice } from '../src/platform/device';
import { makeLabEpochStaging } from '../src/platform/epoch-staging';
const ok = Result.getOrThrow;
const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const fixture = async () => {
  const f = await Effect.runPromise(
    Effect.gen(function* () {
      const owner = yield* generateDevice(),
        recipient = yield* generateDevice();
      const secret = ok(Bytes.epochKey(new Uint8Array(32).fill(39)));
      const membershipId = ok(Bytes.membershipId(new Uint8Array(16).fill(38)));
      const genesis = yield* signGenesisRecord({
        userId: ok(Bytes.userId(new Uint8Array(32).fill(37))),
        membershipId,
        encryptionPublicKey: owner.enc,
        initialKey: secret,
        signer: owner,
      });
      const initial = ok(
        verifyLedger({
          anchor: genesis.genesis,
          records: [genesis.record],
          checkpoint: { head: hashRecordBytes(genesis.record), length: 1 },
        })
      );
      const admission = yield* prepareDeviceAdmission({
        genesis: genesis.genesis,
        membershipId,
        encryptionPublicKey: recipient.enc,
        kind: 'personal',
        signer: recipient,
      });
      const record = yield* signLedgerRecord(
        ok(prepareLedgerCommand(initial, owner.publicKey, admission)),
        owner
      );
      const before = ok(
        extendLedger(initial, [record], { head: hashRecordBytes(record), length: 2 })
      );
      return {
        context: { genesis: genesis.genesis },
        owner: { publicKey: owner.publicKey, signer: owner },
        secret,
        before,
      };
    })
  );
  const before = f.before;
  const groups: EpochStagedGroup[] = [],
    views: LedgerView[] = [];
  for (const seed of [40, 41]) {
    const key = ok(Bytes.epochKey(new Uint8Array(32).fill(seed)));
    const group = await Effect.runPromise(
      Effect.gen(function* () {
        const epoch = ok(Bytes.epochNumber(1));
        const commitment = ok(commitEpochKey(f.context.genesis, epoch, key));
        const packet = ok(
          sealHistoryPacket({
            genesis: f.context.genesis,
            epoch,
            currentKey: key,
            previousKey: f.secret,
          })
        );
        const record = yield* signLedgerRecord(
          ok(
            prepareLedgerRecord(
              before,
              ok(
                encodeCbor([
                  before.head.toBytes(),
                  f.owner.publicKey.toBytes(),
                  [7, epoch, commitment.toBytes(), packet],
                ])
              )
            )
          ),
          f.owner.signer
        );
        const view = ok(
          extendLedger(before, [record], {
            head: hashRecordBytes(record),
            length: before.length + 1,
          })
        );
        views.push(view);
        const envelopes = [];
        for (const recipient of view.inspectState().devices.keys())
          envelopes.push({
            recipient,
            frame: yield* prepareEpochEnvelope({
              context: {
                genesis: f.context.genesis,
                epoch,
                sender: f.owner.publicKey,
                recipient: ok(
                  Bytes.signingPublicKey(new Uint8Array(Buffer.from(recipient, 'hex')))
                ),
              },
              key,
              signer: f.owner.signer,
              ledger: () => Effect.succeed(before),
              candidate: { before, record },
            }),
          });
        return ok(
          ownEpochStagedGroup({
            genesis: hex(f.context.genesis.toBytes()),
            epoch,
            commitment: hex(commitment.toBytes()),
            recordHash: hex(hashRecordBytes(record).toBytes()),
            record,
            envelopes,
          })
        );
      })
    );
    groups.push(group);
  }
  const dir = mkdtempSync(path.join(tmpdir(), 'e2ee-stage-'));
  dirs.push(dir);
  return { path: path.join(dir, 'stage.sqlite'), before, groups, views };
};
const count = (file: string) => {
  const db = new Database(file);
  try {
    return {
      groups: (db.prepare('SELECT count(*) n FROM staged_groups').get() as { n: number }).n,
      envelopes: (db.prepare('SELECT count(*) n FROM staged_envelopes').get() as { n: number }).n,
    };
  } finally {
    db.close();
  }
};
describe('transactional complete epoch staging', () => {
  it('rolls back whole groups on ignored or rewritten rows and retains exact ciphertext across reopen', async () => {
    for (const fault of ['ignore-group', 'ignore-envelope', 'rewrite-envelope'] as const) {
      const f = await fixture(),
        group = f.groups[0]!;
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const store = yield* makeLabEpochStaging({
              path: f.path,
              mode: 'create',
              ledger: () => Effect.succeed(f.before),
            });
            const db = new Database(f.path);
            try {
              db.exec(
                fault === 'ignore-group'
                  ? 'CREATE TRIGGER stage_fault BEFORE INSERT ON staged_groups BEGIN SELECT RAISE(IGNORE);END'
                  : fault === 'ignore-envelope'
                    ? `CREATE TRIGGER stage_fault BEFORE INSERT ON staged_envelopes WHEN NEW.recipient='${group.envelopes[1]!.recipient}' BEGIN SELECT RAISE(IGNORE);END`
                    : `CREATE TRIGGER stage_fault AFTER INSERT ON staged_envelopes WHEN NEW.recipient='${group.envelopes[1]!.recipient}' BEGIN UPDATE staged_envelopes SET frame=x'01' WHERE recipient=NEW.recipient;END`
              );
              expect(Exit.isFailure(yield* Effect.exit(store.stageGroup(group)))).toBe(true);
              expect(count(f.path)).toEqual({ groups: 0, envelopes: 0 });
              expect(yield* store.readGroup(group)).toBeNull();
              db.exec('DROP TRIGGER stage_fault');
              yield* store.stageGroup(group);
              yield* store.stageGroup(group);
              expect(count(f.path)).toEqual({ groups: 1, envelopes: 2 });
            } finally {
              db.close();
            }
          })
        )
      );
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const reopened = yield* makeLabEpochStaging({
              path: f.path,
              mode: 'open',
              ledger: () => Effect.succeed(f.before),
            });
            const actual = yield* reopened.readGroup(group);
            expect(actual && sameEpochStagedGroup(group, actual)).toBe(true);
            const changed = {
              ...group,
              envelopes: group.envelopes.map((row, i) => ({
                ...row,
                frame: i ? new Uint8Array([1]) : row.frame,
              })),
            };
            const result = yield* Effect.exit(reopened.stageGroup(changed));
            expect(Exit.isFailure(result)).toBe(true);
            expect(yield* reopened.readGroup(group)).toEqual(group);
          })
        )
      );
    }
  });
  it('keeps uncommitted groups and the committed winner; deletes only a verified losing same-epoch commitment', async () => {
    const f = await fixture(),
      [winner, loser] = f.groups;
    let view = f.before;
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const store = yield* makeLabEpochStaging({
            path: f.path,
            mode: 'create',
            ledger: () => Effect.sync(() => view),
          });
          yield* store.stageGroup(winner!);
          yield* store.stageGroup(loser!);
          expect(
            Exit.isFailure(
              yield* Effect.exit(
                store.deleteGroup(loser!, { epoch: 1, commitment: winner!.commitment })
              )
            )
          ).toBe(true);
          expect(count(f.path)).toEqual({ groups: 2, envelopes: 4 });
          view = f.views[0]!;
          expect(
            Exit.isFailure(
              yield* Effect.exit(
                store.deleteGroup(winner!, { epoch: 1, commitment: loser!.commitment })
              )
            )
          ).toBe(true);
          expect(
            Exit.isFailure(
              yield* Effect.exit(
                store.deleteGroup(loser!, { epoch: 2, commitment: winner!.commitment })
              )
            )
          ).toBe(true);
          yield* store.deleteGroup(loser!, ok(obsoleteEpochStagedGroup(view, loser!)));
          expect(yield* store.readGroup(loser!)).toBeNull();
          expect(yield* store.readGroup(winner!)).toEqual(winner);
          expect(count(f.path)).toEqual({ groups: 1, envelopes: 2 });
        })
      )
    );
  });
});
