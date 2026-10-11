import { StreamsClient } from '@loro-dev/streams-client';
import { createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { join } from 'node:path';
import { Effect, Result } from 'effect';
import { describe, expect, it } from 'vitest';
import { Bytes } from '@lody/e2ee-core';
import { hashRecordBytes } from '@lody/e2ee-core/ledger';
import { prepareDeviceAdmission, prepareLedgerCommand } from '@lody/e2ee-core/ledger/admission';
import { signLedgerRecord } from '@lody/e2ee-core/ledger/signing';
import { frameLedgerRecord } from '@lody/e2ee-core/ledger/feed';
import { fixture } from './ledger-fixture';
import { makeLabCredentials, labPossessionMessage } from '../src/platform/credentials';
import { makeLabControlGateway } from '../src/platform/control-gateway';
import { makeLabHttpHost } from '../src/platform/host';
const ok = Result.getOrThrow;
const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');
describe('real loopback Lab credentials and control HTTP composition', () => {
  it('authenticates possession and current Org, rejects malformed routes/records, pins actual SDK CAS despite hostile headers and refuses replay/expired tokens', async () => {
    const f = await fixture();
    let now = 10;
    const originals = [...f.records];
    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const credentials = yield* makeLabCredentials({
              path: join(f.dir, 'http-credentials.sqlite'),
              mode: 'create',
              now: () => now,
              ledger: (anchor) =>
                anchor.equals(f.anchor) ? Effect.succeed(f.view) : Effect.fail('unknown Org'),
            });
            const gateway = yield* makeLabControlGateway({
              genesis: f.anchor,
              now: () => now,
              checkpoint: () =>
                Effect.sync(() => ({
                  head: hashRecordBytes(originals.at(-1)!),
                  length: originals.length,
                })),
              budget: { maxRecords: 100, maxBytes: 1024 * 1024 },
              stream: {
                read: f.sdk.read.bind(f.sdk),
                appendCas: async (request) => {
                  const result = await f.sdk.appendCas(request);
                  if (result.ok && result.result.kind === 'ok')
                    originals.push(new Uint8Array(request.part.body.subarray(4)));
                  return result;
                },
              },
            });
            const host = yield* makeLabHttpHost({
              credentials,
              control: (anchor) => (anchor.equals(f.anchor) ? gateway : undefined),
            });
            const post = (path: string, value: unknown) =>
              Effect.promise(() =>
                fetch(host.baseUrl + path, {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify(value),
                })
              );
            const deviceHex = hex(f.owner.publicKey.toBytes()),
              account = 'synthetic-http-alice';
            const challenge = yield* post('/v1/credentials/challenge', { account, deviceHex });
            expect(challenge.status).toBe(200);
            const { nonce } = (yield* Effect.promise(() => challenge.json())) as { nonce: string };
            const proof = {
              account,
              deviceHex,
              nonce,
              genesisHex: hex(f.anchor.toBytes()),
              ttlMs: 100,
              signature: hex(
                (yield* f.owner.sign(
                  ok(labPossessionMessage(account, f.owner.publicKey, nonce))
                )).toBytes()
              ),
            };
            const minted = yield* post('/v1/credentials', proof);
            expect(minted.status).toBe(200);
            const { token } = (yield* Effect.promise(() => minted.json())) as { token: string };
            expect((yield* post('/v1/credentials', proof)).status).toBe(403);
            const privateKey = createPrivateKey({
              key: Buffer.concat([
                Buffer.from('302e020100300506032b657004220420', 'hex'),
                Buffer.alloc(32, 119),
              ]),
              format: 'der',
              type: 'pkcs8',
            });
            const signer = {
              publicKey: ok(
                Bytes.signingPublicKey(
                  new Uint8Array(
                    createPublicKey(privateKey)
                      .export({ format: 'der', type: 'spki' })
                      .subarray(-32)
                  )
                )
              ),
              sign: (message: Uint8Array) =>
                Effect.sync(() =>
                  ok(Bytes.signature(new Uint8Array(sign(null, message, privateKey))))
                ),
            };
            const command = yield* prepareDeviceAdmission({
              genesis: f.anchor,
              membershipId: f.membership,
              encryptionPublicKey: ok(Bytes.encryptionPublicKey(new Uint8Array(32).fill(120))),
              kind: 'personal',
              signer,
            });
            const record = yield* signLedgerRecord(
              ok(prepareLedgerCommand(f.view, f.owner.publicKey, command)),
              f.owner
            );
            const frame = ok(frameLedgerRecord(record));
            const path = `/ds/${hex(f.anchor.toBytes())}/control/append-cas`;
            const append = (route: string, bytes: Uint8Array, credential?: string) =>
              Effect.promise(() =>
                fetch(host.baseUrl + route, {
                  method: 'POST',
                  headers: {
                    ...(credential ? { authorization: `Bearer ${credential}` } : {}),
                    'Stream-Expected-Offset': '0',
                    'Stream-Closed': 'true',
                    'Stream-TTL': '1',
                    'Stream-Seq': 'hostile',
                    'content-type': 'application/octet-stream',
                  },
                  body: Buffer.from(bytes),
                })
              );
            expect((yield* append(path, frame)).status).toBe(401);
            expect((yield* append(path + '?offset=0', frame, token)).status).toBe(404);
            expect(
              (yield* append(path.replace(hex(f.anchor.toBytes()), 'aa'.repeat(32)), frame, token))
                .status
            ).toBe(404);
            expect((yield* append(path, new Uint8Array([...frame, ...frame]), token)).status).toBe(
              400
            );
            const bad = frame.slice();
            bad[bad.length - 1] ^= 1;
            expect((yield* append(path, bad, token)).status).toBe(403);
            expect(originals.length).toBe(2);
            const consumer = new StreamsClient({
              url: host.baseUrl + path.replace('/append-cas', ''),
              auth: token,
              headers: { 'Stream-Closed': 'true', 'Stream-TTL': '1' },
              retry: { maxAttempts: 1 },
            });
            const accepted = yield* Effect.promise(() =>
              consumer.appendCas({
                expectedOffset: '0',
                part: { contentType: 'application/octet-stream', body: frame },
              })
            );
            expect(accepted.ok).toBe(true);
            if (!accepted.ok || accepted.result.kind !== 'ok')
              throw new Error('published SDK rejected host acknowledgement');
            expect(typeof accepted.result.value.nextOffset).toBe('string');
            expect(originals.length).toBe(3);
            expect(originals.at(-1)).toEqual(record);
            expect((yield* append(path, frame, token)).status).toBe(403);
            // A real SDK read proves hostile lifecycle headers did not close/delete the stream.
            const readable = yield* Effect.promise(() => f.sdk.read({ offset: '0' }));
            expect(readable.ok).toBe(true);
            now = 110;
            expect((yield* append(path, frame, token)).status).toBe(403);
            expect(originals.length).toBe(3);
          })
        )
      );
    } finally {
      await f.close();
    }
  });
});
