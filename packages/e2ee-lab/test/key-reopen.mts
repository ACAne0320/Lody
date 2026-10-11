import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { Effect, Result } from 'effect';
import { Bytes } from '@lody/e2ee-core';
import { verifyLedger } from '@lody/e2ee-core/ledger';
import { makeSqliteRecipientMailbox } from '@lody/e2ee-core/keys/host/mailbox/sqlite';
import { makeLabMailboxRemote } from '../src/platform/key-mailbox';
import { makeLabHttpIdentity } from './authenticated-mailbox-fixture';
import { syntheticProtector } from './content-fixture';
const [directory, baseUrl] = process.argv.slice(2);
const ok = Result.getOrThrow;
// This fixture is written only by the parent test: synthetic local keys/public
// signed records in file0600, not a production credential/recovery-vault format.
const fixture = JSON.parse(readFileSync(join(directory!, 'recovery-device.json'), 'utf8')) as {
  genesis: string;
  records: string[];
  checkpoint: { head: string; length: number };
  privateKey: string;
  publicKey: string;
};
const bytes = (value: string) => new Uint8Array(Buffer.from(value, 'hex'));
const genesis = ok(Bytes.genesisHash(bytes(fixture.genesis)));
const view = ok(
  verifyLedger({
    anchor: genesis,
    records: fixture.records.map(bytes),
    checkpoint: {
      head: ok(Bytes.recordHash(bytes(fixture.checkpoint.head))),
      length: fixture.checkpoint.length,
    },
  })
);
const key = createPrivateKey({
  key: Buffer.concat([
    Buffer.from('302e020100300506032b657004220420', 'hex'),
    Buffer.alloc(32, 102),
  ]),
  format: 'der',
  type: 'pkcs8',
});
const signer = {
  publicKey: ok(
    Bytes.signingPublicKey(
      new Uint8Array(createPublicKey(key).export({ format: 'der', type: 'spki' }).subarray(-32))
    )
  ),
  sign: (message: Uint8Array) =>
    Effect.sync(() => ok(Bytes.signature(new Uint8Array(sign(null, message, key))))),
};
// Locked HPKE serializes the public handle to bind recipient bytes; private DH
// remains non-extractable. No algorithm/public-core change or custody claim.
const pair = {
  privateKey: await crypto.subtle.importKey('pkcs8', bytes(fixture.privateKey), 'X25519', false, [
    'deriveBits',
  ]),
  publicKey: await crypto.subtle.importKey('raw', bytes(fixture.publicKey), 'X25519', true, []),
};
await Effect.runPromise(
  Effect.scoped(
    Effect.gen(function* () {
      const identity = yield* makeLabHttpIdentity({ baseUrl: baseUrl!, genesis });
      const session = yield* identity.authenticate(signer);
      const remote = yield* makeLabMailboxRemote(session);
      const receiver = yield* makeSqliteRecipientMailbox({
        path: join(directory!, 'recovery-receive.sqlite'),
        mode: 'open',
        genesis,
        signer,
        pair,
        ledger: () => Effect.succeed(view),
        remote,
        keyStore: {
          path: join(directory!, 'recovery-keys.sqlite'),
          mode: 'open',
          protector: syntheticProtector,
        },
        repairStore: { path: join(directory!, 'recovery-repair.sqlite'), mode: 'open' },
      });
      const installed = yield* receiver.fetchAndInstall(); // Actual HPKE opens pending original frame and saves/readbacks.
      yield* receiver.flushReports(); // Actual protected-key read/commitment and signed HTTP report/ACK.
      const outcomes = (yield* receiver.results()).map((result) => result.outcome);
      process.stdout.write(JSON.stringify({ installed, outcomes }) + '\n');
    })
  )
);
