import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { Data, Effect, Result } from 'effect';
import { Bytes } from '@lody/e2ee-core';
import type { makeLabCredentials } from './credentials';
import type { makeLabControlGateway } from './control-gateway';
import { makeLabOperations } from './operation-scope';

type Credentials = Effect.Success<ReturnType<typeof makeLabCredentials>>;
type Control = Effect.Success<ReturnType<typeof makeLabControlGateway>>;
class LabHttpError extends Data.TaggedError('LabHttpError')<{ readonly status: number }> {}
const reject = (status: number) => new LabHttpError({ status });
const hex = (value: unknown, length: number) => {
  if (typeof value !== 'string' || value.length !== length * 2 || !/^[0-9a-f]+$/.test(value))
    throw reject(400);
  return new Uint8Array(Buffer.from(value, 'hex'));
};
const respond = (response: ServerResponse, status: number, value: unknown) => {
  if (response.destroyed) return;
  if (
    status === 200 &&
    value &&
    typeof value === 'object' &&
    'nextOffset' in value &&
    typeof value.nextOffset === 'string'
  )
    response.setHeader('Stream-Next-Offset', value.nextOffset);
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(value));
};
/** Local HTTP composition, currently credential and control routes only. Workspace
 * registration/checkpoint selection is an independent harness capability. HTTP JSON,
 * headers and offsets cannot select it. No generic proxy or production account auth.
 * Caller creates credentials/control owners in the same enclosing Scope first. */
export function makeLabHttpHost(input: {
  readonly credentials: Credentials;
  readonly control: (genesis: Bytes.GenesisHash) => Control | undefined;
}) {
  return Effect.gen(function* () {
    const credentials = input.credentials,
      control = input.control;
    const active = new Set<Promise<void>>();
    let accept: ((request: IncomingMessage, response: ServerResponse) => void) | undefined;
    const server = createServer((request, response) => {
      if (!accept) return respond(response, 503, { error: 'unavailable' });
      accept(request, response);
    });
    yield* Effect.acquireRelease(
      Effect.uninterruptible(
        Effect.promise(
          () =>
            new Promise<void>((resolve, refuse) => {
              const failed = (error: Error) => refuse(error);
              server.once('error', failed);
              server.listen(0, '127.0.0.1', () => {
                server.removeListener('error', failed);
                resolve();
              });
            })
        )
      ),
      () =>
        Effect.promise(async () => {
          accept = undefined;
          const closed = new Promise<void>((resolve, refuse) =>
            server.close((error) => (error ? refuse(error) : resolve()))
          );
          server.closeAllConnections();
          await Promise.allSettled([...active]);
          await closed;
        })
    );
    const operations = yield* makeLabOperations();
    const address = server.address();
    if (!address || typeof address === 'string') return yield* reject(500);
    const body = (request: IncomingMessage, limit: number) =>
      Effect.uninterruptible(
        Effect.tryPromise({
          try: async () => {
            const chunks: Buffer[] = [];
            let size = 0;
            for await (const chunk of request) {
              const bytes = Buffer.from(chunk);
              size += bytes.length;
              if (size > limit) throw reject(413);
              chunks.push(bytes);
            }
            return new Uint8Array(Buffer.concat(chunks));
          },
          catch: (error) => (error instanceof LabHttpError ? error : reject(400)),
        })
      );
    const json = (request: IncomingMessage) =>
      body(request, 8192).pipe(
        Effect.flatMap((bytes) =>
          Effect.try({
            try: () => {
              const value: unknown = JSON.parse(
                new TextDecoder('utf-8', { fatal: true }).decode(bytes)
              );
              if (!value || typeof value !== 'object' || Array.isArray(value)) throw reject(400);
              return value as Record<string, unknown>;
            },
            catch: () => reject(400),
          })
        )
      );
    const route = (request: IncomingMessage) =>
      Effect.gen(function* () {
        const path = request.url ?? '';
        if (request.method === 'GET' && (path === '/healthz' || path === '/readyz'))
          return { ok: true };
        if (request.method !== 'POST') return yield* reject(404);
        if (path === '/v1/credentials/challenge') {
          const value = yield* json(request);
          const device = yield* Effect.try({
            try: () => Result.getOrThrow(Bytes.signingPublicKey(hex(value.deviceHex, 32))),
            catch: () => reject(400),
          });
          if (typeof value.account !== 'string') return yield* reject(400);
          return { nonce: yield* credentials.issueChallenge(value.account, device) };
        }
        if (path === '/v1/credentials') {
          const value = yield* json(request);
          const captured = yield* Effect.try({
            try: () => {
              if (
                typeof value.account !== 'string' ||
                typeof value.nonce !== 'string' ||
                (value.ttlMs !== undefined && typeof value.ttlMs !== 'number')
              )
                throw reject(400);
              return {
                account: value.account,
                nonce: value.nonce,
                device: Result.getOrThrow(Bytes.signingPublicKey(hex(value.deviceHex, 32))),
                signature: Result.getOrThrow(Bytes.signature(hex(value.signature, 64))),
                genesis:
                  value.genesisHex == null
                    ? null
                    : Result.getOrThrow(Bytes.genesisHash(hex(value.genesisHex, 32))),
                ttlMs: value.ttlMs as number | undefined,
              };
            },
            catch: () => reject(400),
          });
          const credential = yield* credentials.completeChallenge(captured);
          return {
            token: credential.token,
            account: credential.account,
            deviceHex: Buffer.from(credential.device.toBytes()).toString('hex'),
            genesisHex:
              credential.genesis === null
                ? null
                : Buffer.from(credential.genesis.toBytes()).toString('hex'),
            issuedAt: credential.issuedAt,
            expiresAt: credential.expiresAt,
          };
        }
        const match = /^\/ds\/([0-9a-f]{64})\/control\/append-cas$/.exec(path);
        if (!match) return yield* reject(404);
        const authorization = request.headers.authorization;
        if (typeof authorization !== 'string' || !/^Bearer [0-9a-f]{64}$/.test(authorization))
          return yield* reject(401);
        const credential = yield* credentials.authenticate(authorization.slice(7));
        const genesis = yield* Effect.fromResult(Bytes.genesisHash(hex(match[1], 32)));
        const gateway = control(genesis);
        if (!gateway) return yield* reject(404);
        const framed = yield* body(request, 8196);
        if (
          framed.length < 5 ||
          new DataView(framed.buffer, framed.byteOffset, 4).getUint32(0) !== framed.length - 4
        )
          return yield* reject(400);
        // No caller headers enter the public SDK CAS capability. Exactly one original
        // record; candidate validation and trusted tail pinning belong to public core.
        return yield* gateway.append({
          authenticatedCredential: credential,
          requestGenesis: genesis,
          record: framed.subarray(4),
        });
      });
    accept = (request, response) => {
      const abort = () => request.destroy();
      operations.signal.addEventListener('abort', abort, { once: true });
      if (operations.signal.aborted) {
        abort();
        return;
      }
      const raw = Effect.runPromise(Effect.result(operations.run(route(request))))
        .then(
          (result) => {
            if (Result.isSuccess(result)) respond(response, 200, result.success);
            else
              respond(
                response,
                result.failure instanceof LabHttpError ? result.failure.status : 403,
                { error: 'refused' }
              );
          },
          () => respond(response, 503, { error: 'unavailable' })
        )
        .finally(() => {
          operations.signal.removeEventListener('abort', abort);
        });
      active.add(raw);
      void raw.then(
        () => active.delete(raw),
        () => active.delete(raw)
      );
    };
    return Object.freeze({ baseUrl: `http://127.0.0.1:${address.port}` });
  });
}
