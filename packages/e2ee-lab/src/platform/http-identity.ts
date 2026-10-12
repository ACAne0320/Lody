import { Data, Effect, Result, Schema } from 'effect';
import { Bytes } from '@lody/e2ee-core';
import { signVerified, type DeviceSigner } from '@lody/e2ee-core/signing';
import { labPossessionMessage } from './credentials';
import { makeLabSdkOwner } from './sdk-owner';

export class LabHttpIdentityError extends Data.TaggedError('LabHttpIdentityError')<{
  readonly code: 'invalid-origin' | 'invalid-response' | 'response-too-large' | 'closed';
}> {}
const fail = (code: LabHttpIdentityError['code']) => new LabHttpIdentityError({ code });
const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');
const HashHex = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/));
const Timestamp = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(0),
  Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER)
);
const Challenge = Schema.Struct({ nonce: HashHex });
const Credential = Schema.Struct({
  token: HashHex,
  account: Schema.String,
  deviceHex: HashHex,
  genesisHex: Schema.NullOr(HashHex),
  issuedAt: Timestamp,
  expiresAt: Timestamp,
});
const maxReplyBytes = 16 * 1024;

/** Synthetic local possession/bearer client, not product identity or key custody.
 * Scope owns credential fetch AND bounded response body. Native SDK fetch ports
 * borrow its signal and remain owned by their calling transport. No Effect runner
 * or protocol EOF disposal. No strict deadline claim/ordinary leeway change. */
export const makeLabHttpIdentity = Effect.fnUntraced(function* (input: {
  readonly baseUrl: string;
  readonly genesis: Bytes.GenesisHash;
  /** Explicit native local transport/instrumentation capability. */
  readonly fetch?: typeof fetch;
}) {
  const genesis = yield* Effect.fromResult(Bytes.genesisHash(input.genesis.toBytes()));
  const origin = yield* Effect.try({
    try: () => {
      const base = new URL(input.baseUrl);
      if (
        base.protocol !== 'http:' ||
        !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname) ||
        base.username ||
        base.password ||
        base.pathname !== '/' ||
        base.search ||
        base.hash
      )
        throw fail('invalid-origin');
      return base.origin;
    },
    catch: () => fail('invalid-origin'),
  });
  const transport = input.fetch ?? fetch;
  const owner = yield* makeLabSdkOwner(() => ({ close: async () => undefined }));
  const genesisHex = hex(genesis.toBytes());
  const url = `${origin}/v1/spaces/${genesisHex}/key-mailbox`;
  const post = Effect.fnUntraced(function* (path: string, value: unknown) {
    const reply = yield* owner.invoke(async () => {
      const response = await transport(origin + path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        redirect: 'error',
        signal: owner.signal,
        body: JSON.stringify(value),
      });
      if (response.status !== 200) {
        await response.body?.cancel();
        return { refused: true as const };
      }
      const reader = response.body?.getReader();
      if (!reader) return { refused: true as const };
      let complete = false,
        count = 0;
      const chunks: Uint8Array[] = [];
      try {
        for (;;) {
          const part = await reader.read();
          if (part.done) {
            complete = true;
            break;
          }
          count += part.value.length;
          if (count > maxReplyBytes) return { oversized: true as const };
          chunks.push(new Uint8Array(part.value));
        }
        const bytes = new Uint8Array(count);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.length;
        }
        return { bytes };
      } finally {
        try {
          if (!complete) await reader.cancel();
        } finally {
          reader.releaseLock();
        }
      }
    });
    if ('refused' in reply) return yield* fail('invalid-response');
    if ('oversized' in reply) return yield* fail('response-too-large');
    return yield* Effect.try({
      try: (): unknown => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(reply.bytes)),
      catch: () => fail('invalid-response'),
    });
  });
  return Object.freeze({
    url,
    authenticate: Effect.fnUntraced(function* (
      signer: DeviceSigner,
      binding: 'workspace' | 'unbound' = 'workspace'
    ) {
      if (owner.signal.aborted) return yield* fail('closed');
      const captured = yield* Effect.try({
        try: () =>
          Object.freeze({
            publicKey: Result.getOrThrow(Bytes.signingPublicKey(signer.publicKey.toBytes())),
            sign: signer.sign.bind(signer),
          }),
        catch: () => fail('invalid-response'),
      });
      if (binding !== 'workspace' && binding !== 'unbound') return yield* fail('invalid-response');
      const deviceHex = hex(captured.publicKey.toBytes());
      const account = `synthetic-${deviceHex}`;
      const challenge = yield* Effect.fromResult(
        Result.mapError(
          Schema.decodeUnknownResult(Challenge)(
            yield* post('/v1/credentials/challenge', { account, deviceHex })
          ),
          () => fail('invalid-response')
        )
      );
      const signature = yield* signVerified(
        captured,
        yield* Effect.fromResult(labPossessionMessage(account, captured.publicKey, challenge.nonce))
      );
      const bound = binding === 'workspace' ? genesisHex : null;
      const credential = yield* Effect.fromResult(
        Result.mapError(
          Schema.decodeUnknownResult(Credential)(
            yield* post('/v1/credentials', {
              account,
              deviceHex,
              nonce: challenge.nonce,
              signature: hex(signature.toBytes()),
              genesisHex: bound,
            })
          ),
          () => fail('invalid-response')
        )
      );
      if (
        credential.account !== account ||
        credential.deviceHex !== deviceHex ||
        credential.genesisHex !== bound ||
        credential.expiresAt <= credential.issuedAt
      )
        return yield* fail('invalid-response');
      const authenticatedFetch: typeof fetch = async (request, init) => {
        if (owner.signal.aborted) throw fail('closed');
        const outgoing = new Request(request, init);
        const target = new URL(outgoing.url);
        if (target.origin !== origin || target.username || target.password)
          throw fail('invalid-origin');
        const headers = new Headers(outgoing.headers);
        headers.set('authorization', `Bearer ${credential.token}`);
        return transport(
          new Request(outgoing, {
            headers,
            redirect: 'error',
            signal: AbortSignal.any([outgoing.signal, owner.signal]),
          })
        );
      };
      return Object.freeze({ url, fetch: authenticatedFetch });
    }),
  });
});
