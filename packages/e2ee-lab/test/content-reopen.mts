import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Effect, Result } from 'effect';
import { LoroDoc } from 'loro-crdt';
import { StreamsCrdt, createLoroDocAdapter } from '@loro-dev/streams-crdt/loro';
import { Bytes } from '@lody/e2ee-core';
import { hashRecordBytes, verifyLedger } from '@lody/e2ee-core/ledger';
import { makeSqliteProtectedEpochKeys } from '@lody/e2ee-core/keys/host/sqlite';
import { makeLabSdkOwner } from '../src/platform/sdk-owner';
import { makeLabUpdateProvider } from '../src/platform/content-provider';
import { makeLabDocumentStore } from '../src/platform/document-sqlite';
import { syntheticProtector } from './content-fixture';
const [dir, url, genesisHex, publicKeyHex] = process.argv.slice(2);
const ok = Result.getOrThrow;
await Effect.runPromise(
  Effect.scoped(
    Effect.gen(function* () {
      const genesis = ok(Bytes.genesisHash(new Uint8Array(Buffer.from(genesisHex!, 'hex'))));
      const publicKey = ok(
        Bytes.signingPublicKey(new Uint8Array(Buffer.from(publicKeyHex!, 'hex')))
      );
      const record = new Uint8Array(readFileSync(join(dir!, 'content-genesis.cbor')));
      const view = ok(
        verifyLedger({
          anchor: genesis,
          records: [record],
          checkpoint: { head: hashRecordBytes(record), length: 1 },
        })
      );
      const keys = yield* makeSqliteProtectedEpochKeys({
        path: join(dir!, 'content-keys.sqlite'),
        mode: 'open',
        genesis,
        recipient: publicKey,
        ledger: () => Effect.succeed(view),
        protector: syntheticProtector,
      });
      const provider = yield* makeLabUpdateProvider({
        genesis,
        resource: 'document-A',
        model: 'loro',
        writeEpoch: 0,
        signer: { publicKey, sign: () => Effect.die('reopened reader has no signer') },
        ledger: () => Effect.succeed(view),
        readEpochKey: keys.read,
      });
      const doc = yield* Effect.acquireRelease(
        Effect.sync(() => new LoroDoc()),
        (value) => Effect.sync(() => value.free())
      );
      const store = yield* makeLabDocumentStore({
        path: join(dir!, 'document-A.sqlite'),
        mode: 'open',
        genesis: genesisHex!,
        resource: 'document-A',
        model: 'loro',
        streamUrl: url!,
      });
      const state = yield* store.restore();
      if (!state) throw new Error('missing durable CRDT');
      doc.import(state);
      const reader = yield* makeLabSdkOwner(
        ({ assertOpen }) =>
          new StreamsCrdt({
            streamUrl: url!,
            adapter: createLoroDocAdapter(doc),
            remoteCursorStore: store.cursorStore,
            beforeRemoteCursorSave: async () => {
              assertOpen();
              ok(store.stage(doc.export({ mode: 'snapshot' })));
            },
            payloadProtectionRequired: true,
            e2ee: { provider, readPolicy: 'encrypted-only', writePolicy: 'encrypt' },
          })
      );
      const pulled = yield* reader.invoke((sdk) => sdk.catchup());
      if (!pulled.ok)
        throw new Error(`real reopened SDK catchup failed: ${JSON.stringify(pulled)}`);
      const cursor = yield* store.inspectCursor();
      process.stdout.write(JSON.stringify({ text: doc.getText('text').toString(), cursor }) + '\n');
    })
  )
);
