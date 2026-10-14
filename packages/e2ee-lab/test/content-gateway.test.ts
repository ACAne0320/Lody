import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Deferred, Effect, Fiber, Result } from 'effect';
import { expect, it, vi } from 'vitest';
import { Bytes } from '@lody/e2ee-core';
import { contentPermissions } from '@lody/e2ee-core/ledger';
import { makeStreamsUpdateBinding } from '@lody/e2ee-core/content/streams';
import { makeLabContentGateway } from '../src/platform/content-gateway';
import { makeLabScenarioFixture } from '../src/platform/scenario-fixture';
import { openLabExistingWorkspace } from '../src/platform/workspace-session';

const ok = Result.getOrThrow;

it('rechecks genuine current permission after native verification settles and never forwards a writer revoked during the await', async () => {
  const root = mkdtempSync(join(tmpdir(), 'lab-content-admission-revoke-'));
  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const f = yield* makeLabScenarioFixture(join(root, 'fixture'));
          const control = yield* openLabExistingWorkspace(f.input('owner', 'create'));
          const gateway = yield* makeLabContentGateway({
            genesis: f.genesis,
            resource: 'document-A',
            model: 'loro',
            baseUrl: f.server.baseUrl,
            ledger: f.ledger,
          });
          // Explicit pre-authenticated principal; this test owns current write
          // admission, while the fixture's real control path authenticates CAS.
          const credential = {
            account: 'synthetic-peer',
            token: '',
            issuedAt: 0,
            expiresAt: 1,
            device: f.peer.publicKey,
            genesis: f.genesis,
          };
          const request = { credential, requestGenesis: f.genesis };
          expect(
            (yield* gateway.write({ ...request, method: 'PUT', body: new Uint8Array() })).status
          ).toBe(201);
          const org = Buffer.from(f.genesis.toBytes()).toString('hex');
          const remote = yield* Effect.acquireRelease(
            Effect.sync(
              () =>
                new Database(join(f.directory, 'riverrun.sqlite'), {
                  readonly: true,
                  fileMustExist: true,
                })
            ),
            (db) => Effect.sync(() => db.close())
          );
          const disk = () =>
            remote
              .prepare(`
            SELECT s.next_offset, count(e.id) AS entries,
              coalesce(sum(length(e.body)),0) AS bytes
            FROM streams s LEFT JOIN entries e ON e.stream_id_fk=s.id
            WHERE s.bucket_id=? AND s.stream_id='loro' GROUP BY s.id
          `)
              .get(org);
          const read = async () => {
            const response = await fetch(`${f.server.baseUrl}/ds/${org}/loro?offset=-1`);
            return {
              status: response.status,
              offset: response.headers.get('stream-next-offset'),
              body: new Uint8Array(await response.arrayBuffer()),
            };
          };
          const before = disk(),
            beforeBody = yield* Effect.promise(read);
          expect(before).toEqual({ next_offset: 0, entries: 0, bytes: 0 });
          expect(beforeBody.status).toBe(200);
          expect(beforeBody.body).toEqual(new Uint8Array());
          expect(ok(contentPermissions(f.view(), f.peer.publicKey)).maySealNewContent).toBe(true);

          const prefix = new Uint8Array([76, 83, 67, 69, 2, 1, 0, 1, 0, 0, 3]);
          const domain = new TextEncoder().encode('loro-streams-crdt-payload-protection/v2\0');
          const aad = new Uint8Array(domain.length + prefix.length);
          aad.set(domain);
          aad.set(prefix, domain.length);
          const binding = yield* makeStreamsUpdateBinding({
            genesis: f.genesis,
            resource: 'document-A',
            model: 'loro',
            writeEpoch: 0,
            signer: f.peer,
            ledger: f.ledger,
            readEpochKey: () => Effect.sync(() => ok(Bytes.epochKey(new Uint8Array(32).fill(117)))),
          });
          const sealed = yield* binding.seal({
            context: {
              protocol: 'loro-streams-crdt-payload-protection',
              version: 2,
              kind: 'update_batch',
            },
            // Bypass the <=8192-byte mathematical tuple cache, including the
            // successful fixed verification already performed while signing.
            plaintext: new Uint8Array(9000).fill(104),
            additionalData: () => aad,
          });
          const body = new Uint8Array(4 + prefix.length + sealed.sealed.length);
          new DataView(body.buffer).setUint32(0, body.length - 4, false);
          body.set(prefix, 4);
          body.set(sealed.sealed, 4 + prefix.length);

          const verified = yield* Deferred.make<boolean>();
          let release!: () => void;
          const gate = new Promise<void>((resolve) => {
            release = resolve;
          });
          const verifyNative = crypto.subtle.verify.bind(crypto.subtle);
          const spy = vi.spyOn(crypto.subtle, 'verify').mockImplementation(async (...args) => {
            const valid = await verifyNative(...args);
            if (args[3].byteLength > 8192) {
              Deferred.doneUnsafe(verified, Effect.succeed(valid));
              await gate;
            }
            return valid;
          });
          yield* Effect.addFinalizer(() => Effect.sync(() => spy.mockRestore()));
          const pending = yield* Effect.forkChild(
            Effect.result(gateway.write({ ...request, method: 'POST', body }))
          );
          // Registered after the worker: assertion failure releases its actual
          // native completion gate before Scope waits for that worker to close.
          yield* Effect.addFinalizer(() => Effect.sync(release));
          expect(yield* Deferred.await(verified)).toBe(true);
          expect(pending.pollUnsafe()).toBeUndefined();
          expect(disk()).toEqual(before);

          const revoked = yield* control.control.execute({
            _tag: 'RevokeDevice',
            target: f.peer.publicKey,
          });
          expect(revoked.outcome).toBe('Committed');
          yield* control.control.acknowledge(revoked);
          expect(ok(contentPermissions(f.view(), f.peer.publicKey)).maySealNewContent).toBe(false);
          release();
          const result = yield* Fiber.join(pending);
          expect(Result.isFailure(result)).toBe(true);
          if (Result.isFailure(result))
            expect(result.failure).toMatchObject({ _tag: 'LabContentGatewayError', status: 403 });
          expect(disk()).toEqual(before);
          expect(yield* Effect.promise(read)).toEqual(beforeBody);
        })
      )
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
