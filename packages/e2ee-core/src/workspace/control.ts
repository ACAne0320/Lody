import { Data, Effect, Result, Semaphore } from 'effect';
import * as Bytes from '../bytes';
import { prepareLedgerCommand, type LedgerCommand } from '../ledger/admission';
import { signLedgerRecord } from '../ledger/signing';
import { decodeRecord, hasVerifiedCheckpoint, type LedgerCheckpoint } from '../ledger';
import type { DeviceSigner } from '../signing';
import {
  SubmissionJournal,
  SubmissionRemote,
  submitRecord,
  resumeSubmission,
  acknowledgeSubmission,
  type SubmissionResult,
} from '../submission';
import { type LedgerFeedError } from '../ledger/feed';
import type { LedgerFeedState } from '../ledger/feed';

export interface WorkspaceLedgerClient {
  current(): Effect.Effect<LedgerFeedState, unknown>;
  read(checkpoint: LedgerCheckpoint): Effect.Effect<LedgerFeedState, unknown>;
}
export interface WorkspaceControlInput {
  readonly genesis: Bytes.GenesisHash;
  readonly signer: DeviceSigner;
  readonly checkpoint: () => Effect.Effect<LedgerCheckpoint, LedgerFeedError>;
  readonly client: WorkspaceLedgerClient;
  readonly journal: SubmissionJournal['Service'];
  readonly remote: SubmissionRemote['Service'];
}

export class WorkspaceControlError extends Data.TaggedError('WorkspaceControlError')<{
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
    return yield* Result.fail(new WorkspaceControlError({ code: 'invalid-command' }));
  });
}
/** Lab orchestration only: existing public proposal/signing and unchanged P09.
 * No key creation, auto-rebase/re-sign, recovery import or remote ACK commit. */
export function makeWorkspaceControl(input: WorkspaceControlInput) {
  return Effect.gen(function* () {
    const anchor = yield* Effect.fromResult(Bytes.genesisHash(input.genesis.toBytes()));
    const signer = Object.freeze({
      publicKey: yield* Effect.fromResult(Bytes.signingPublicKey(input.signer.publicKey.toBytes())),
      sign: input.signer.sign.bind(input.signer),
    });
    const checkpoint = input.checkpoint;
    const client = input.client;
    const journal = input.journal;
    const remote = input.remote;
    const serial = yield* Semaphore.make(1);
    let closed = false;
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        closed = true;
      })
    );
    const guard = () =>
      closed ? Effect.fail(new WorkspaceControlError({ code: 'closed' })) : Effect.void;
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
      executeOriginal: (source: Uint8Array) =>
        Effect.gen(function* () {
          const parsed = yield* Effect.fromResult(decodeRecord(new Uint8Array(source)));
          return yield* serial.withPermit(
            Effect.gen(function* () {
              yield* guard();
              if ((yield* journal.load(anchor)).record)
                return yield* new WorkspaceControlError({ code: 'pending' });
              if (parsed.body.type !== 'ordinary' || !parsed.body.signer.equals(signer.publicKey))
                return yield* new WorkspaceControlError({ code: 'invalid-command' });
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
                return yield* new WorkspaceControlError({ code: 'pending' });
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
              return yield* new WorkspaceControlError({ code: 'feed-not-persisted' });
            return yield* provide(acknowledgeSubmission(anchor, result));
          })
        ),
    });
  });
}
