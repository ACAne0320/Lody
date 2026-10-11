import { join } from 'node:path';
import { Effect, Result } from 'effect';
import { Bytes } from '@lody/e2ee-core';
import type { LedgerView } from '@lody/e2ee-core/ledger';
import type { DeviceSigner } from '@lody/e2ee-core/signing';
import { makeLabCredentials, labPossessionMessage } from '../src/platform/credentials';
import { makeLabHttpHost } from '../src/platform/host';
import { makeLabSdkOwner } from '../src/platform/sdk-owner';
import type { LabMailboxHost } from '../src/platform/mailbox-http';
import type { makeLabJoinMailbox } from '../src/platform/join-mailbox';
const ok = Result.getOrThrow;
const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');
/** Real challenge/bearer HTTP, native Ed proofs and SQLite credentials. Account is
 * a synthetic label, global fetch is an explicit local transport capability, not
 * a product identity system or key custody. A private harness owns the workspace.
 * Raw credential fetch AND response body are retained by a scoped native owner. */
export function makeAuthenticatedLabMailbox(input: {
  readonly directory: string;
  readonly mode: 'create' | 'open';
  readonly genesis: Bytes.GenesisHash;
  readonly ledger: () => Effect.Effect<LedgerView, never>;
  readonly mailbox?: LabMailboxHost;
  readonly joins?: Effect.Success<ReturnType<typeof makeLabJoinMailbox>>;
}) {
  return Effect.gen(function* () {
    const { directory, mode, genesis, ledger, mailbox, joins } = input;
    const credentials = yield* makeLabCredentials({
      path: join(directory, 'http-credentials.sqlite'),
      mode,
      now: () => 0,
      ledger: (anchor) => (anchor.equals(genesis) ? ledger() : Effect.fail('unknown Org')),
    });
    const host = yield* makeLabHttpHost({
      credentials,
      control: () => undefined,
      mailbox: (anchor) => (anchor.equals(genesis) ? mailbox : undefined),
      joins: (anchor) => (anchor.equals(genesis) ? joins : undefined),
    });
    const owner = yield* makeLabSdkOwner(() => ({ close: async () => undefined }));
    const url = `${host.baseUrl}/v1/spaces/${hex(genesis.toBytes())}/key-mailbox`;
    return {
      url,
      authenticate: (signer: DeviceSigner, binding: 'workspace' | 'unbound' = 'workspace') =>
        Effect.gen(function* () {
          const account = `synthetic-${hex(signer.publicKey.toBytes())}`;
          const post = (path: string, value: unknown) =>
            owner.invoke(async () => {
              const response = await fetch(host.baseUrl + path, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                signal: owner.signal,
                body: JSON.stringify(value),
              });
              if (response.status !== 200) throw new Error('synthetic credential refused');
              return await response.json();
            });
          const { nonce } = yield* post('/v1/credentials/challenge', {
            account,
            deviceHex: hex(signer.publicKey.toBytes()),
          }) as Effect.Effect<{ nonce: string }, unknown>;
          const signature = yield* signer.sign(
            ok(labPossessionMessage(account, signer.publicKey, nonce))
          );
          const { token } = yield* post('/v1/credentials', {
            account,
            deviceHex: hex(signer.publicKey.toBytes()),
            nonce,
            signature: hex(signature.toBytes()),
            genesisHex: binding === 'workspace' ? hex(genesis.toBytes()) : null,
          }) as Effect.Effect<{ token: string }, unknown>;
          const authenticatedFetch: typeof fetch = (request, init) => {
            const headers = new Headers(init?.headers);
            headers.set('authorization', `Bearer ${token}`);
            return fetch(request, { ...init, headers });
          };
          return { url, fetch: authenticatedFetch };
        }),
    };
  });
}
