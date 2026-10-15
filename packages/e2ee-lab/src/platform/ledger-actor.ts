import { Context, Data, Effect, Layer, Result, Semaphore } from 'effect';
import { Bytes } from '@lody/e2ee-core';
import { prepareLedgerCommand, type LedgerCommand } from '@lody/e2ee-core/ledger/admission';
import { signLedgerRecord } from '@lody/e2ee-core/ledger/signing';
import { decodeRecord, hasVerifiedCheckpoint, type LedgerCheckpoint } from '@lody/e2ee-core/ledger';
import type { DeviceSigner } from '@lody/e2ee-core/signing';
import { makeSqliteEpochRotation } from '@lody/e2ee-core/keys/host/rotation/sqlite';
import {
  SubmissionJournal,
  SubmissionRemote,
  submitRecord,
  resumeSubmission,
  acknowledgeSubmission,
  type SubmissionResult,
} from '@lody/e2ee-core/submission';
import { sqliteSubmissionJournal } from '@lody/e2ee-core/submission/sqlite';
import {
  makeStreamsSubmissionRemote,
  type LedgerSubmissionStream,
} from '@lody/e2ee-core/submission/streams';
import { type LedgerFeedError } from '@lody/e2ee-core/ledger/feed';
import { makeLabLedgerClient } from './ledger-client';

export class LabLedgerActorError extends Data.TaggedError('LabLedgerActorError')<{
  readonly code: 'pending' | 'closed' | 'feed-not-persisted' | 'invalid-command';
}> {}
function captureCommand(command: LedgerCommand) {
  return Result.gen(function* () {
    switch (command._tag) {
      case 'AdmitMember': {
        const r = command.request;
        return Object.freeze({
          _tag: command._tag,
          membershipId: yield* Bytes.membershipId(command.membershipId.toBytes()),
          request: Object.freeze({
            requestId: yield* Bytes.requestId(r.requestId.toBytes()),
            userId: yield* Bytes.userId(r.userId.toBytes()),
            signingPublicKey: yield* Bytes.signingPublicKey(r.signingPublicKey.toBytes()),
            encryptionPublicKey: yield* Bytes.encryptionPublicKey(r.encryptionPublicKey.toBytes()),
            expiresAt: r.expiresAt,
            signature: yield* Bytes.signature(r.signature.toBytes()),
          }),
        });
      }
      case 'AdmitDevice':
        return Object.freeze({
          _tag: command._tag,
          kind: command.kind,
          signingPublicKey: yield* Bytes.signingPublicKey(command.signingPublicKey.toBytes()),
          encryptionPublicKey: yield* Bytes.encryptionPublicKey(
            command.encryptionPublicKey.toBytes()
          ),
          possessionSignature: yield* Bytes.signature(command.possessionSignature.toBytes()),
        });
      case 'SetRole':
        return Object.freeze({
          _tag: command._tag,
          role: command.role,
          membershipId: yield* Bytes.membershipId(command.membershipId.toBytes()),
        });
      case 'RevokeDevice':
        return Object.freeze({
          _tag: command._tag,
          target: yield* Bytes.signingPublicKey(command.target.toBytes()),
        });
      case 'TransferOwner':
        return Object.freeze({
          _tag: command._tag,
          successorMembershipId: yield* Bytes.membershipId(command.successorMembershipId.toBytes()),
        });
    }
    return yield* Result.fail(new LabLedgerActorError({ code: 'invalid-command' }));
  });
}
/** Lab orchestration only: existing public proposal/signing and unchanged P09.
 * No key creation, auto-rebase/re-sign, recovery import or remote ACK commit. */
export function makeLabLedgerActor(
  input: Parameters<typeof makeLabLedgerClient>[0] & {
    readonly journalPath: string;
    readonly stream: LedgerSubmissionStream;
    readonly signer: DeviceSigner;
    readonly checkpoint: () => Effect.Effect<LedgerCheckpoint, LedgerFeedError>;
  }
) {
  return Effect.gen(function* () {
    const anchor = yield* Effect.fromResult(Bytes.genesisHash(input.genesis.toBytes()));
    const signer = Object.freeze({
      publicKey: yield* Effect.fromResult(Bytes.signingPublicKey(input.signer.publicKey.toBytes())),
      sign: input.signer.sign.bind(input.signer),
    });
    const checkpoint = input.checkpoint;
    const client = yield* makeLabLedgerClient(input);
    const context = yield* Layer.build(sqliteSubmissionJournal(input.journalPath));
    const journal = Context.get(context, SubmissionJournal);
    const remote = yield* makeStreamsSubmissionRemote({
      genesis: anchor,
      stream: input.stream,
      checkpoint,
      budget: input.budget,
    });
    const serial = yield* Semaphore.make(1);
    let closed = false;
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        closed = true;
      })
    );
    const guard = () =>
      closed ? Effect.fail(new LabLedgerActorError({ code: 'closed' })) : Effect.void;
    const provide = <A, E, R>(
      work: Effect.Effect<A, E, R | SubmissionJournal | SubmissionRemote>
    ) =>
      work.pipe(
        Effect.provideService(SubmissionJournal, journal),
        Effect.provideService(SubmissionRemote, remote)
      );
    const refresh = () =>
      Effect.gen(function* () {
        yield* guard();
        const selected = yield* checkpoint();
        return yield* client.read(selected);
      });
    return Object.freeze({
      current: client.current,
      refresh: () => serial.withPermit(refresh()),
      /** Shares this actor's P09 journal and persisted genuine feed. Candidate
       * protection is a separate explicit host capability, never installed-key A. */
      makeEpochRotation: (
        config: Pick<
          Parameters<typeof makeSqliteEpochRotation>[0],
          'path' | 'mode' | 'installed' | 'protector' | 'staging'
        >
      ) =>
        Effect.gen(function* () {
          yield* guard();
          const publisher = yield* provide(
            makeSqliteEpochRotation({
              ...config,
              genesis: anchor,
              signer,
              ledger: () => refresh().pipe(Effect.map((current) => current.view)),
            })
          );
          // The publisher serializes itself. Do not hold the actor permit while
          // it borrows installed-key reads: their genuine lookup refreshes this
          // same actor. P09 still rejects any competing original atomically.
          return Object.freeze({
            publish: () => guard().pipe(Effect.andThen(publisher.publish())),
            publishRemoving: (membership: Bytes.MembershipId) =>
              guard().pipe(Effect.andThen(publisher.publishRemoving(membership))),
            resume: () => guard().pipe(Effect.andThen(publisher.resume())),
            result: () => guard().pipe(Effect.andThen(publisher.result())),
            cleanupStaged: () => guard().pipe(Effect.andThen(publisher.cleanupStaged())),
            acknowledge: (result: Parameters<typeof publisher.acknowledge>[0]) =>
              guard().pipe(Effect.andThen(publisher.acknowledge(result))),
          });
        }),
      executeOriginal: (source: Uint8Array) =>
        Effect.gen(function* () {
          const parsed = yield* Effect.fromResult(decodeRecord(new Uint8Array(source)));
          return yield* serial.withPermit(
            Effect.gen(function* () {
              yield* guard();
              if ((yield* journal.load(anchor)).record)
                return yield* new LabLedgerActorError({ code: 'pending' });
              if (parsed.body.type !== 'ordinary' || !parsed.body.signer.equals(signer.publicKey))
                return yield* new LabLedgerActorError({ code: 'invalid-command' });
              yield* refresh();
              const result = yield* provide(submitRecord(anchor, parsed.recordBytes));
              yield* refresh();
              return result;
            })
          );
        }),
      execute: (command: LedgerCommand) =>
        Effect.gen(function* () {
          const owned = yield* Effect.fromResult(captureCommand(command));
          return yield* serial.withPermit(
            Effect.gen(function* () {
              yield* guard();
              // A retained pending or unacknowledged result forbids all new signing.
              if ((yield* journal.load(anchor)).record)
                return yield* new LabLedgerActorError({ code: 'pending' });
              const current = yield* refresh();
              const proposal = yield* Effect.fromResult(
                prepareLedgerCommand(current.view, signer.publicKey, owned)
              );
              const record = yield* signLedgerRecord(proposal, signer);
              yield* guard();
              const result = yield* provide(submitRecord(anchor, record));
              yield* refresh();
              return result;
            })
          );
        }),
      resume: () =>
        serial.withPermit(
          Effect.gen(function* () {
            yield* guard();
            const result = yield* provide(resumeSubmission(anchor));
            if (result) yield* refresh();
            return result;
          })
        ),
      acknowledge: (result: SubmissionResult) =>
        serial.withPermit(
          Effect.gen(function* () {
            yield* guard();
            const entry = yield* journal.load(anchor);
            const current = yield* client.current();
            if (
              !entry.checkpoint ||
              !(yield* Effect.fromResult(hasVerifiedCheckpoint(current.view, entry.checkpoint)))
            )
              return yield* new LabLedgerActorError({ code: 'feed-not-persisted' });
            return yield* provide(acknowledgeSubmission(anchor, result));
          })
        ),
    });
  });
}
