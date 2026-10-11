import { Data, Result } from 'effect';
import { Bytes } from '@lody/e2ee-core';
import { contentPermissions, type LedgerView } from '@lody/e2ee-core/ledger';

export type GatewayAction = 'read' | 'control-cas' | 'keys-cas' | 'content-cas' | 'snapshot-put';
export class LabGatewayError extends Data.TaggedError('LabGatewayError')<{
  readonly status: 403 | 404;
  readonly code: 'unauthorized' | 'unknown-stream' | 'method-not-allowed';
}> {}
const hex = (value: { toBytes(): Uint8Array }) => Buffer.from(value.toBytes()).toString('hex');
const deny = (code: LabGatewayError['code'], status: 403 | 404 = 403) =>
  Result.fail(new LabGatewayError({ status, code }));
/** Policy gate only, not bearer authentication or URL parsing. The actual host must
 * authenticate the credential and select its genuine current checkpoint independently
 * before calling. Payload verification, pinned CAS and snapshot admission follow this
 * gate; a route permission is never record/content/snapshot acceptance. */
export function authorizeLabStream(input: {
  readonly view: LedgerView;
  readonly authenticatedCredential: {
    readonly device: Bytes.SigningPublicKey;
    readonly genesis: Bytes.GenesisHash | null;
  };
  readonly requestGenesis: Bytes.GenesisHash;
  readonly stream: string;
  readonly method: string;
  readonly sub?: string;
}) {
  return Result.try({
    try: () =>
      Result.gen(function* () {
        const { stream, method, sub, view, authenticatedCredential, requestGenesis } = input;
        if (!['control', 'keys', 'loro', 'flock'].includes(stream))
          return yield* deny('unknown-stream', 404);
        const device = yield* Result.mapError(
          Bytes.signingPublicKey(authenticatedCredential.device.toBytes()),
          () => new LabGatewayError({ status: 403, code: 'unauthorized' })
        );
        // This genuine-view query checks the public core's private registration before any
        // caller-visible state/method is used. Forged structural LedgerViews are rejected.
        const permissions = yield* Result.mapError(
          contentPermissions(view, device),
          () => new LabGatewayError({ status: 403, code: 'unauthorized' })
        );
        const request = yield* Result.mapError(
          Bytes.genesisHash(requestGenesis.toBytes()),
          () => new LabGatewayError({ status: 403, code: 'unauthorized' })
        );
        const borrowedBound = authenticatedCredential.genesis;
        const bound =
          borrowedBound === null
            ? null
            : yield* Result.mapError(
                Bytes.genesisHash(borrowedBound.toBytes()),
                () => new LabGatewayError({ status: 403, code: 'unauthorized' })
              );
        if (!view.genesis.equals(request) || (bound !== null && !bound.equals(request)))
          return yield* deny('unauthorized');
        const state = view.inspectState();
        const active = state.devices.get(hex(device));
        if (!active || !state.members.has(hex(active.membershipId)))
          return yield* deny('unauthorized');
        if (
          (method === 'GET' || method === 'HEAD') &&
          (sub === undefined || sub === 'snapshot' || sub === 'bootstrap')
        )
          return { action: 'read' as const };
        // Registered R receives/repairs only, never ordinary control/content writes or sends.
        if (active.kind === 'recovery') return yield* deny('unauthorized');
        if (method === 'POST' && sub === 'append-cas' && stream === 'control')
          return { action: 'control-cas' as const };
        if (method === 'POST' && sub === 'append-cas' && stream === 'keys')
          return { action: 'keys-cas' as const };
        const content = stream === 'loro' || stream === 'flock';
        if (permissions.mayWriteDocument && content) {
          if (method === 'PUT' && sub === 'snapshot') return { action: 'snapshot-put' as const };
          if (method === 'POST' && (sub === undefined || sub === 'append-cas'))
            return { action: 'content-cas' as const };
        }
        return yield* deny('method-not-allowed');
      }),
    catch: () => new LabGatewayError({ status: 403, code: 'unauthorized' }),
  }).pipe(Result.flatMap((value) => value));
}
