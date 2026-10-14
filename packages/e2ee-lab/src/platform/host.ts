import { LabContentGatewayError, type makeLabContentGateway } from './content-gateway';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { Data, Effect, Result, Semaphore } from 'effect';
import { Bytes } from '@lody/e2ee-core';
import type { makeLabCredentials } from './credentials';
import type { makeLabControlGateway } from './control-gateway';
import { makeLabOperations } from './operation-scope';
import { LabCallbackRunner } from './run';
import { dispatchLabMailbox, type LabMailboxHost } from './mailbox-http';
import { LabJoinError, parseLabJoin, type makeLabJoinMailbox } from './join-mailbox';
import { LabWorkspaceError, type makeLabWorkspaceRegistry } from './workspace-registry';
import { LabStreamReply, LabStreamReadError, type makeLabStreamReader } from './stream-read';

type Credentials = Effect.Success<ReturnType<typeof makeLabCredentials>>;
type Control = Effect.Success<ReturnType<typeof makeLabControlGateway>>;
type Joins = Effect.Success<ReturnType<typeof makeLabJoinMailbox>>;
class LabHttpError extends Data.TaggedError('LabHttpError')<{ readonly status: number }> {}
const reject = (status: number) => new LabHttpError({ status });
const hex = (value: unknown, length: number) => {
  if (typeof value !== 'string' || value.length !== length * 2 || !/^[0-9a-f]+$/.test(value))
    throw reject(400);
  return new Uint8Array(Buffer.from(value, 'hex'));
};
const respond = (response: ServerResponse, status: number, value: unknown) => {
  if (response.destroyed) return;
  if (value instanceof LabStreamReply) {
    for (const [name, header] of value.headers) response.setHeader(name, header);
    response.setHeader('cache-control', 'no-store');
    response.writeHead(value.status);
    response.end(Buffer.from(value.body));
    return;
  }
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
/** Local HTTP composition, currently credential, control, mailbox, joins, genesis discovery and finite SDK reads only. Workspace
 * registration/checkpoint selection is an independent harness capability. HTTP JSON,
 * headers and offsets cannot select it. No generic proxy or production account auth.
 * Caller creates credentials/control owners in the same enclosing Scope first. */
export function makeLabHttpHost(input: {
  readonly credentials: Credentials;
  readonly contents?: (
    genesis: Bytes.GenesisHash,
    model: 'loro' | 'flock'
  ) => Effect.Success<ReturnType<typeof makeLabContentGateway>> | undefined;
  readonly streams?: (
    genesis: Bytes.GenesisHash
  ) => Effect.Success<ReturnType<typeof makeLabStreamReader>> | undefined;
  readonly workspaces?: Effect.Success<ReturnType<typeof makeLabWorkspaceRegistry>>;
  readonly control: (genesis: Bytes.GenesisHash) => Control | undefined;
  readonly mailbox?: (genesis: Bytes.GenesisHash) => LabMailboxHost | undefined;
  readonly joins?: (genesis: Bytes.GenesisHash) => Joins | undefined;
}) {
  return Effect.gen(function* () {
    const credentials = input.credentials,
      contents = input.contents,
      streams = input.streams,
      workspaces = input.workspaces,
      control = input.control,
      mailbox = input.mailbox,
      joins = input.joins;
    const active = new Set<Promise<void>>();
    // Same-Org control and content admissions linearize at this host; a queued
    // write checks permission only after earlier control CAS has actually settled.
    // This is a semaphore, never a SQLite transaction held during native IO.
    const writeLocks = new Map<string, { lock: Semaphore.Semaphore; users: number }>();
    const write = <A, E, R>(anchor: Bytes.GenesisHash, work: Effect.Effect<A, E, R>) =>
      Effect.acquireUseRelease(
        Effect.sync(() => {
          const id = Buffer.from(anchor.toBytes()).toString('hex');
          let slot = writeLocks.get(id);
          if (!slot) {
            slot = { lock: Semaphore.makeUnsafe(1), users: 0 };
            writeLocks.set(id, slot);
          }
          slot.users++;
          return { id, slot };
        }),
        ({ slot }) => slot.lock.withPermit(work),
        ({ id, slot }) =>
          Effect.sync(() => {
            if (--slot.users === 0) writeLocks.delete(id);
          })
      );
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
    // Registered Node HTTP callback bridge, owned by this host Scope.
    const callbacks = yield* Effect.acquireRelease(
      Effect.sync(() => new LabCallbackRunner()),
      (owner) => Effect.promise(() => owner.close())
    );
    // Scope closes in reverse: abort request bodies before joining callbacks.
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
    const json = (request: IncomingMessage, maxBytes = 8192) =>
      body(request, maxBytes).pipe(
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
        const readMatch =
          /^\/ds\/([0-9a-f]{64})\/(control|loro|flock)(?:\/(snapshot|bootstrap)(?:\/([^/?#]+))?)?(?:\?([^#]*))?$/.exec(
            path
          );
        if (readMatch && (request.method === 'GET' || request.method === 'HEAD')) {
          const authorization = request.headers.authorization;
          if (typeof authorization !== 'string' || !/^Bearer [0-9a-f]{64}$/.test(authorization))
            return yield* reject(401);
          const credential = yield* credentials.authenticate(authorization.slice(7));
          const anchor = yield* Effect.fromResult(Bytes.genesisHash(hex(readMatch[1], 32)));
          const reader = streams?.(anchor);
          if (!reader) return yield* reject(404);
          const snapshotOffset = yield* Effect.try({
            try: () => (readMatch[4] === undefined ? undefined : decodeURIComponent(readMatch[4])),
            catch: () => reject(400),
          });
          return yield* reader.read({
            credential,
            method: request.method,
            stream: readMatch[2]!,
            sub: readMatch[3],
            query: readMatch[5] ?? '',
            snapshotOffset,
          });
        }
        const genesisMatch = /^\/v1\/spaces\/([0-9a-f]{64})\/genesis$/.exec(path);
        if (genesisMatch && request.method === 'GET') {
          const authorization = request.headers.authorization;
          if (typeof authorization !== 'string' || !/^Bearer [0-9a-f]{64}$/.test(authorization))
            return yield* reject(401);
          yield* credentials.authenticate(authorization.slice(7));
          const anchor = yield* Effect.fromResult(Bytes.genesisHash(hex(genesisMatch[1], 32)));
          const saved = workspaces ? yield* workspaces.get(anchor) : undefined;
          if (!saved) return yield* reject(404);
          // Original authenticated discovery permits unbound joiners. This returns
          // only reverified genesis bytes, never a current trusted endpoint/view.
          return { genesis: Buffer.from(saved.record).toString('hex') };
        }
        const joinsMatch = /^\/v1\/spaces\/([0-9a-f]{64})\/joins$/.exec(path);
        if (joinsMatch && (request.method === 'GET' || request.method === 'POST')) {
          const authorization = request.headers.authorization;
          if (typeof authorization !== 'string' || !/^Bearer [0-9a-f]{64}$/.test(authorization))
            return yield* reject(401);
          const credential = yield* credentials.authenticate(authorization.slice(7));
          const anchor = yield* Effect.fromResult(Bytes.genesisHash(hex(joinsMatch[1], 32)));
          const owner = joins?.(anchor);
          if (!owner) return yield* reject(404);
          if (request.method === 'GET') return { requests: yield* owner.list(credential) };
          const candidate = yield* Effect.fromResult(parseLabJoin(yield* json(request)));
          yield* owner.put(credential, candidate);
          return { ok: true };
        }
        const contentMatch = /^\/ds\/([0-9a-f]{64})\/(loro|flock)$/.exec(path);
        if (contentMatch && (request.method === 'PUT' || request.method === 'POST')) {
          const authorization = request.headers.authorization;
          if (typeof authorization !== 'string' || !/^Bearer [0-9a-f]{64}$/.test(authorization))
            return yield* reject(401);
          const credential = yield* credentials.authenticate(authorization.slice(7));
          const anchor = yield* Effect.fromResult(Bytes.genesisHash(hex(contentMatch[1], 32)));
          if (!credential.genesis?.equals(anchor)) return yield* reject(403);
          const gateway = contents?.(anchor, contentMatch[2] as 'loro' | 'flock');
          if (!gateway) return yield* reject(404);
          const original = yield* body(request, request.method === 'PUT' ? 0 : 16 * 1024 * 1024);
          return yield* write(
            anchor,
            gateway.write({
              credential,
              requestGenesis: anchor,
              method: request.method,
              body: original,
            })
          );
        }
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
        const mailboxMatch = /^\/v1\/spaces\/([0-9a-f]{64})\/key-mailbox$/.exec(path);
        if (mailboxMatch) {
          const authorization = request.headers.authorization;
          if (typeof authorization !== 'string' || !/^Bearer [0-9a-f]{64}$/.test(authorization))
            return yield* reject(401);
          const credential = yield* credentials.authenticate(authorization.slice(7));
          const anchor = yield* Effect.fromResult(Bytes.genesisHash(hex(mailboxMatch[1], 32)));
          if (!credential.genesis?.equals(anchor)) return yield* reject(403);
          const owner = mailbox?.(anchor);
          if (!owner) return yield* reject(404);
          const remote = yield* Effect.fromResult(owner.bind(credential.device));
          return yield* dispatchLabMailbox(remote, yield* json(request, 20480), mailboxMatch[1]!);
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
        return yield* write(
          genesis,
          gateway.append({
            authenticatedCredential: credential,
            requestGenesis: genesis,
            record: framed.subarray(4),
          })
        );
      });
    accept = (request, response) => {
      const abort = () => request.destroy();
      operations.signal.addEventListener('abort', abort, { once: true });
      if (operations.signal.aborted) {
        abort();
        return;
      }
      const raw = callbacks
        .run(Effect.result(operations.run(route(request))))
        .then(
          (result) => {
            if (Result.isSuccess(result)) respond(response, 200, result.success);
            else
              respond(
                response,
                result.failure instanceof LabHttpError ||
                  result.failure instanceof LabStreamReadError ||
                  result.failure instanceof LabContentGatewayError
                  ? result.failure.status
                  : result.failure instanceof LabJoinError ||
                      result.failure instanceof LabWorkspaceError
                    ? result.failure.code === 'conflict'
                      ? 409
                      : result.failure.code === 'invalid-input'
                        ? 400
                        : ['storage', 'corrupt'].includes(result.failure.code)
                          ? 500
                          : result.failure.code === 'closed'
                            ? 503
                            : 403
                    : 403,
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
