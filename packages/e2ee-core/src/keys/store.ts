import { Effect, Result } from 'effect';
import * as Bytes from '../bytes';
import { copyEpochKeyBytes } from '../epoch-key';
import { keyId } from '../identifiers';
import { epochHistoryPacket, requireLedgerContinuation, type LedgerView } from '../ledger';
import { EpochKeyError, commitEpochKey } from './history';

export interface VerifiedEpochKeys {
  install(view: LedgerView, epoch: number, key: Bytes.EpochKey): Result.Result<void, EpochKeyError>;
  read(view: LedgerView, epoch: number): Result.Result<Bytes.EpochKey, EpochKeyError>;
  clear(): void;
}
/** Scoped volatile copies only; no backup, file format, platform store or implicit rotation. */
export function makeVerifiedEpochKeys(
  genesis: Bytes.GenesisHash,
  recipient: Bytes.SigningPublicKey
) {
  return Effect.gen(function* () {
    const anchor = yield* Effect.fromResult(Bytes.genesisHash(genesis.toBytes()));
    const device = yield* Effect.fromResult(Bytes.signingPublicKey(recipient.toBytes()));
    const keys = new Map<number, { bytes: Uint8Array; commitment: Bytes.EpochCommitment }>();
    let closed = false;
    let observed: LedgerView | undefined;
    const clear = () => {
      for (const row of keys.values()) row.bytes.fill(0);
      keys.clear();
    };
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        closed = true;
        clear();
        observed = undefined;
      })
    );
    const expected = (view: LedgerView, epoch: number) =>
      Result.gen(function* () {
        if (closed) return yield* Result.fail(new EpochKeyError({ code: 'closed' }));
        yield* Result.mapError(
          epochHistoryPacket(view, 0),
          () => new EpochKeyError({ code: 'unauthorized' })
        );
        if (!anchor.equals(view.genesis))
          return yield* Result.fail(new EpochKeyError({ code: 'unauthorized' }));
        if (observed && Result.isFailure(requireLedgerContinuation(observed, view)))
          return yield* Result.fail(new EpochKeyError({ code: 'unauthorized' }));
        // Independently verified revocation remains observed even when the local key is unavailable.
        observed = view;
        const state = view.inspectState();
        const active = state.devices.get(keyId(device.toBytes()));
        if (!active || !state.members.has(keyId(active.membershipId.toBytes())))
          return yield* Result.fail(new EpochKeyError({ code: 'unauthorized' }));
        const row = yield* Result.mapError(
          epochHistoryPacket(view, epoch),
          () => new EpochKeyError({ code: 'unauthorized' })
        );
        return row.commitment;
      });
    return Object.freeze({
      clear,
      install(view: LedgerView, epoch: number, key: Bytes.EpochKey) {
        return Result.gen(function* () {
          const commitment = yield* expected(view, epoch);
          const actual = yield* commitEpochKey(anchor, epoch, key);
          if (!commitment.equals(actual))
            return yield* Result.fail(new EpochKeyError({ code: 'commitment-mismatch' }));
          const existing = keys.get(epoch);
          if (existing && !existing.commitment.equals(commitment))
            return yield* Result.fail(new EpochKeyError({ code: 'commitment-mismatch' }));
          if (!existing) keys.set(epoch, { commitment, bytes: copyEpochKeyBytes(key) });
          return undefined;
        });
      },
      read(view: LedgerView, epoch: number) {
        return Result.gen(function* () {
          const commitment = yield* expected(view, epoch);
          const row = keys.get(epoch);
          if (!row) return yield* Result.fail(new EpochKeyError({ code: 'missing-key' }));
          if (!row.commitment.equals(commitment))
            return yield* Result.fail(new EpochKeyError({ code: 'commitment-mismatch' }));
          return yield* Result.mapError(
            Bytes.epochKey(row.bytes),
            () => new EpochKeyError({ code: 'invalid-input' })
          );
        });
      },
    } satisfies VerifiedEpochKeys);
  });
}
