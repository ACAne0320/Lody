import { Result } from 'effect';
import {
  genesisHash,
  signingPublicKey,
  epochNumber,
  type SigningPublicKey,
  type GenesisHash,
  type RecordHash,
} from '../bytes';
import { bytesEqual, copyBytes } from '../cbor';
import { keyId } from '../identifiers';
import { verifySignature } from '../signature';
import { LedgerError } from './errors';
import {
  applyOperation,
  cloneState,
  genesisState,
  inspectState,
  type InternalState,
  type LedgerState,
  type HistoricalContentAuthor,
  type EpochHistoryPacket,
} from './policy';
import {
  decodeRecord,
  fail,
  hashRecordBytes,
  joinRequestSigningBytes,
  possessionSigningBytes,
  recordSigningBytes,
} from './records';

/** Independently obtained expected endpoint. Not proof of global freshness. */
export interface LedgerCheckpoint {
  readonly head: RecordHash;
  readonly length: number;
}
declare const verified: unique symbol;
export interface LedgerView {
  readonly [verified]: true;
  readonly genesis: GenesisHash;
  readonly head: RecordHash;
  readonly length: number;
  inspectState(): LedgerState;
}
// Closure-backed objects have no reflective constructor or exposed live state.
const states = new WeakMap<object, InternalState>();
function viewOf(state: InternalState): LedgerView {
  const view: LedgerView = Object.freeze(
    Object.assign(Object.create(null), {
      genesis: state.genesis,
      head: state.hashes[state.hashes.length - 1]!,
      length: state.hashes.length,
      inspectState: () => inspectState(state),
    })
  );
  states.set(view, state);
  return view;
}
const positioned = (position: number) => (error: LedgerError) =>
  new LedgerError({ code: error.code, position });
function replay(
  initial: InternalState | undefined,
  anchor: GenesisHash,
  records: readonly Uint8Array[],
  checkpoint: LedgerCheckpoint
) {
  return Result.gen(function* () {
    if (
      !Number.isSafeInteger(checkpoint.length) ||
      checkpoint.length < 1 ||
      checkpoint.length !== (initial?.hashes.length ?? 0) + records.length
    )
      return yield* fail('checkpoint-mismatch');
    let state = initial;
    for (const bytes of records) {
      const position = state?.hashes.length ?? 0;
      const step = Result.gen(function* () {
        const record = yield* decodeRecord(bytes);
        const hash = hashRecordBytes(record.recordBytes);
        const body = record.body;
        if (!state) {
          if (body.type !== 'genesis') return yield* fail('genesis-mismatch');
          if (!bytesEqual(hash.toBytes(), anchor.toBytes())) return yield* fail('wrong-anchor');
        } else {
          if (body.type !== 'ordinary') return yield* fail('genesis-mismatch');
          if (!body.previousHash.equals(state.hashes[state.hashes.length - 1]!))
            return yield* fail('wrong-parent');
        }
        yield* Result.mapError(
          verifySignature(
            body.signer.toBytes(),
            recordSigningBytes(record.bodyBytes),
            record.signature.toBytes()
          ),
          (error) => new LedgerError({ code: error.code })
        );
        if (body.type === 'genesis') return genesisState(body, anchor, hash);
        if (!state) return yield* fail('genesis-mismatch');
        const op = body.operation;
        if (op.type === 'admitMember') {
          const message = yield* joinRequestSigningBytes(anchor, op.request);
          yield* Result.mapError(
            verifySignature(
              op.request.signingPublicKey.toBytes(),
              message,
              op.request.signature.toBytes()
            ),
            () => new LedgerError({ code: 'bad-proof' })
          );
        } else if (op.type === 'admitDevice') {
          const actor = state.devices.get(keyId(body.signer.toBytes()));
          if (!actor) return yield* fail('unauthorized');
          const message = yield* possessionSigningBytes({
            genesis: anchor,
            targetMembershipId: actor.membershipId,
            signingPublicKey: op.signingPublicKey,
            encryptionPublicKey: op.encryptionPublicKey,
            kind: op.kind,
          });
          yield* Result.mapError(
            verifySignature(
              op.signingPublicKey.toBytes(),
              message,
              op.possessionSignature.toBytes()
            ),
            () => new LedgerError({ code: 'bad-proof' })
          );
        }
        yield* applyOperation(state, body);
        state.hashes.push(hash);
        return state;
      });
      state = yield* Result.mapError(step, positioned(position));
    }
    if (!state) return yield* fail('genesis-mismatch');
    if (!state.hashes[state.hashes.length - 1]!.equals(checkpoint.head))
      return yield* fail('checkpoint-mismatch');
    return viewOf(state);
  });
}
/** Full audit from a caller-pinned genesis and expected endpoint; no URL-derived trust. */
export function verifyLedger(input: {
  readonly anchor: GenesisHash;
  readonly records: readonly Uint8Array[];
  readonly checkpoint: LedgerCheckpoint;
}): Result.Result<LedgerView, LedgerError> {
  return Result.gen(function* () {
    // Revalidate/copy trusted bytes at the boundary as well.
    const anchor = yield* Result.mapError(
      genesisHash(input.anchor.toBytes()),
      (error) => new LedgerError({ code: error.code })
    );
    return yield* replay(undefined, anchor, input.records, input.checkpoint);
  });
}
/** All-or-nothing: failed suffix leaves the preceding verified view unchanged. */
export function extendLedger(
  view: LedgerView,
  records: readonly Uint8Array[],
  checkpoint: LedgerCheckpoint
): Result.Result<LedgerView, LedgerError> {
  const state = states.get(view);
  return state
    ? replay(cloneState(state), state.genesis, records, checkpoint)
    : fail('unauthorized');
}

/** An admitted historical signer is not necessarily a current writer. */
export function historicalContentAuthor(
  view: LedgerView,
  device: SigningPublicKey
): Result.Result<HistoricalContentAuthor, LedgerError> {
  return Result.gen(function* () {
    const state = states.get(view);
    if (!state) return yield* fail('unauthorized');
    const key = yield* Result.mapError(
      signingPublicKey(device.toBytes()),
      (error) => new LedgerError({ code: error.code })
    );
    const author = state.contentAuthors.get(keyId(key.toBytes()));
    return author ? author : yield* fail('unauthorized');
  });
}
export interface ContentPermissions {
  /** Host admission: active personal/machine device of a non-Guest member. */
  readonly mayWriteDocument: boolean;
  /** Honest seal gate additionally waits for any required epoch rotation. */
  readonly maySealNewContent: boolean;
}
/** Current permissions at this caller-selected verified endpoint, not freshness proof. */
export function contentPermissions(
  view: LedgerView,
  device: SigningPublicKey
): Result.Result<ContentPermissions, LedgerError> {
  return Result.gen(function* () {
    const state = states.get(view);
    if (!state) return yield* fail('unauthorized');
    const key = yield* Result.mapError(
      signingPublicKey(device.toBytes()),
      (error) => new LedgerError({ code: error.code })
    );
    const active = state.devices.get(keyId(key.toBytes()));
    const member = active && state.members.get(keyId(active.membershipId.toBytes()));
    const mayWriteDocument = !!(
      active &&
      active.kind !== 'recovery' &&
      member &&
      member.role !== 'guest'
    );
    return Object.freeze({
      mayWriteDocument,
      maySealNewContent: mayWriteDocument && !state.epoch.rotationRequired,
    });
  });
}
/** Owns a detached packet copy. Signed publication is not authenticated decryption. */
export function epochHistoryPacket(
  view: LedgerView,
  epoch: number
): Result.Result<EpochHistoryPacket, LedgerError> {
  return Result.gen(function* () {
    const state = states.get(view);
    if (!state) return yield* fail('unauthorized');
    const number = yield* Result.mapError(
      epochNumber(epoch),
      (error) => new LedgerError({ code: error.code })
    );
    const row = state.historyPackets.get(number);
    return row
      ? Object.freeze({ ...row, packet: copyBytes(row.packet) })
      : yield* fail('unauthorized');
  });
}

/** Verified-prefix relation only; no claim about the globally latest ledger. */
export function requireLedgerContinuation(
  previous: LedgerView,
  next: LedgerView
): Result.Result<void, LedgerError> {
  const before = states.get(previous),
    after = states.get(next);
  if (!before || !after) return fail('unauthorized');
  if (!bytesEqual(before.genesis.toBytes(), after.genesis.toBytes()))
    return fail('genesis-mismatch');
  const head = after.hashes[before.hashes.length - 1];
  return head && bytesEqual(head.toBytes(), before.hashes[before.hashes.length - 1]!.toBytes())
    ? Result.succeed(undefined)
    : fail('checkpoint-mismatch');
}
