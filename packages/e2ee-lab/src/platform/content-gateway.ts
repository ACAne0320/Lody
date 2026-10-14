import { Data, Effect } from 'effect';
import { Bytes } from '@lody/e2ee-core';
import {
  contentPermissions,
  requireLedgerContinuation,
  type LedgerView,
} from '@lody/e2ee-core/ledger';
import { admitStreamsUpdateBatchEffect } from '@lody/e2ee-core/content/streams';
import type { LabCredential } from './credentials';
import { makeLabOperations } from './operation-scope';
import { makeLabSdkOwner } from './sdk-owner';
import { LabStreamReply } from './stream-read';
import { readBoundedBody } from './bounded-body';
export class LabContentGatewayError extends Data.TaggedError('LabContentGatewayError')<{
  readonly status: 400 | 403 | 413 | 502;
}> {}
/** Fixed local host resource/model, header3 only. No snapshot PUT, arbitrary
 * proxy, content decryption, endpoint-derived authority or caller-header forwarding. */
export const makeLabContentGateway = Effect.fnUntraced(function* (input: {
  readonly genesis: Bytes.GenesisHash;
  readonly resource: string;
  readonly model: 'loro' | 'flock';
  readonly baseUrl: string;
  readonly ledger: () => Effect.Effect<LedgerView, unknown>;
  readonly fetch?: typeof fetch;
}) {
  const anchor = yield* Effect.fromResult(Bytes.genesisHash(input.genesis.toBytes()));
  const resource = input.resource,
    model = input.model,
    ledger = input.ledger,
    transport = input.fetch ?? fetch;
  const url = yield* Effect.try({
    try: () => {
      const origin = new URL(input.baseUrl);
      if (
        origin.protocol !== 'http:' ||
        !['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname) ||
        origin.username ||
        origin.password ||
        origin.pathname !== '/' ||
        origin.search ||
        origin.hash ||
        !resource ||
        !['loro', 'flock'].includes(model)
      )
        throw new Error('configuration');
      return `${origin.origin}/ds/${Buffer.from(anchor.toBytes()).toString('hex')}/${model}`;
    },
    catch: () => new LabContentGatewayError({ status: 400 }),
  });
  const native = yield* makeLabSdkOwner(() => ({ close: async () => undefined }));
  const operations = yield* makeLabOperations();
  let observed: LedgerView | undefined;
  const write = (request: {
    readonly credential: LabCredential;
    readonly requestGenesis: Bytes.GenesisHash;
    readonly method: 'PUT' | 'POST';
    readonly body: Uint8Array;
  }) =>
    operations.run(
      Effect.gen(function* () {
        const principal = yield* Effect.fromResult(
          Bytes.signingPublicKey(request.credential.device.toBytes())
        );
        const requested = yield* Effect.fromResult(
          Bytes.genesisHash(request.requestGenesis.toBytes())
        );
        const bound = request.credential.genesis;
        const method = request.method;
        if (!(request.body instanceof Uint8Array) || request.body.length > 16 * 1024 * 1024)
          return yield* new LabContentGatewayError({ status: 413 });
        const body = new Uint8Array(request.body);
        if (
          !requested.equals(anchor) ||
          !bound?.equals(anchor) ||
          !['PUT', 'POST'].includes(method) ||
          (method === 'PUT' && body.length)
        )
          return yield* new LabContentGatewayError({ status: 403 });
        const authorize = (admitBody: boolean) =>
          Effect.gen(function* () {
            const view = yield* ledger();
            const permission = yield* Effect.fromResult(contentPermissions(view, principal));
            if (!view.genesis.equals(anchor))
              return yield* new LabContentGatewayError({ status: 403 });
            if (observed) yield* Effect.fromResult(requireLedgerContinuation(observed, view));
            observed = view;
            if (!permission.maySealNewContent)
              return yield* new LabContentGatewayError({ status: 403 });
            if (method === 'POST' && admitBody)
              yield* admitStreamsUpdateBatchEffect({
                genesis: anchor,
                resource,
                model,
                view,
                device: principal,
                body,
              });
            return undefined;
          });
        yield* authorize(true);
        // Native verification awaited: reselect current genuine authority before send.
        yield* authorize(false);
        return yield* native.invoke(async () => {
          const reply = await transport(url, {
            method,
            headers: { 'content-type': 'application/octet-stream' },
            body: method === 'POST' ? Buffer.from(body) : undefined,
            redirect: 'manual',
            signal: AbortSignal.any([native.signal, operations.signal]),
          });
          const bytes = reply.body
            ? await readBoundedBody(reply.body, 64 * 1024)
            : new Uint8Array();
          if (bytes === undefined) throw new LabContentGatewayError({ status: 502 });
          return new LabStreamReply({
            status: reply.status,
            body: bytes,
            headers: ['content-type', 'stream-next-offset', 'stream-closed'].flatMap((name) => {
              const value = reply.headers.get(name);
              return value === null ? [] : [[name, value] as const];
            }),
          });
        });
      })
    );
  return Object.freeze({ write });
});
