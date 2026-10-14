import Database from 'better-sqlite3';
import { makeLabProcessActor } from '../src/platform/process-actor';
import { exportDevice } from '../src/platform/device';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect, Result } from 'effect';
import { expect, it } from 'vitest';
import { makeLabScenarioFixture } from '../src/platform/scenario-fixture';
import {
  openLabWorkspaceSession,
  reauthenticateLabWorkspaceSession,
} from '../src/platform/full-session';
it('starts real admitted peers, installs HPKE keys/reports, syncs both SDK models and reauthenticates one common owner', async () => {
  const root = mkdtempSync(join(tmpdir(), 'lab-full-session-'));
  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fixture = yield* makeLabScenarioFixture(join(root, 'fixture'));
          const input = fixture.input('owner', 'create');
          const owner = yield* openLabWorkspaceSession(input);
          const peer = yield* openLabWorkspaceSession(fixture.input('peer', 'create'));
          yield* owner.keyRound();
          yield* peer.keyRound();
          yield* owner.createDocument('loro');
          yield* owner.createDocument('flock');
          yield* owner.append('loro', 'original loro');
          yield* owner.append('flock', 'original flock');
          yield* peer.pull('loro');
          yield* peer.pull('flock');
          expect(yield* peer.text('loro')).toBe('original loro');
          expect(yield* peer.text('flock')).toBe('original flock');
          expect(yield* peer.cursor('loro')).not.toBeNull();
          expect(yield* peer.cursor('flock')).not.toBeNull();
          yield* owner.persist('loro');
          const reopened = yield* reauthenticateLabWorkspaceSession(owner, input, fixture.point());
          expect(Result.isFailure(yield* Effect.result(owner.text('loro')))).toBe(true);
          expect(yield* reopened.text('loro')).toBe('original loro');
          expect(yield* reopened.text('flock')).toBe('original flock');
          yield* reopened.append('loro', ' after reauth');
          yield* peer.pull('loro');
          expect(yield* peer.text('loro')).toBe('original loro after reauth');
          yield* reopened.close();
          yield* reopened.close();
          expect(Result.isFailure(yield* Effect.result(reopened.keyRound()))).toBe(true);
          // One actor closes without EOF publication or closing another peer's stores.
          expect(yield* peer.text('flock')).toBe('original flock');
        })
      )
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 15000);
it('closes the two original Lab2 behaviors through the complete session: genuine records at wrong offsets cannot duplicate history or rewind the durable feed', async () => {
  const root = mkdtempSync(join(tmpdir(), 'lab2-full-consumer-'));
  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const f = yield* makeLabScenarioFixture(join(root, 'fixture'));
          let attack: 'duplicate' | 'rollback' | undefined;
          const original = f.input('owner', 'create');
          const transport: typeof fetch = async (input, init) => {
            const url = new URL(input instanceof Request ? input.url : String(input));
            const response = await fetch(input, init);
            if (
              !attack ||
              url.pathname !== `/ds/${Buffer.from(f.genesis.toBytes()).toString('hex')}/control` ||
              (init?.method ?? 'GET') !== 'GET'
            )
              return response;
            const framing = await import('@lody/e2ee-core/ledger/feed');
            const values = attack === 'duplicate' ? [f.records[1]!] : f.records;
            const bytes = Buffer.concat(
              values.map((record) =>
                Buffer.from(Result.getOrThrow(framing.frameLedgerRecord(record)))
              )
            );
            await response.body?.cancel();
            const headers = new Headers(response.headers);
            headers.set('content-type', 'application/octet-stream');
            const at = url.searchParams.get('offset') ?? '0';
            headers.set(
              'stream-next-offset',
              String(Number(at) + bytes.length).padStart(at.length, '0')
            );
            headers.set('stream-up-to-date', 'true');
            return new Response(bytes, { status: 200, headers });
          };
          const owner = yield* openLabWorkspaceSession({ ...original, fetch: transport });
          const peer = yield* openLabWorkspaceSession(f.input('peer', 'create'));
          const before = yield* owner.current();
          const persisted = () => {
            const db = new Database(original.path, { readonly: true, fileMustExist: true });
            try {
              return db.transaction(() => ({
                meta: db
                  .prepare(
                    'SELECT hex(genesis) AS genesis,hex(head) AS head,count,offset,bootstrap,bytes FROM ledger_feed_meta'
                  )
                  .all(),
                records: db
                  .prepare(
                    'SELECT position,hex(record) AS record FROM ledger_feed_records ORDER BY position'
                  )
                  .all(),
              }))();
            } finally {
              db.close();
            }
          };
          const originalDisk = persisted(),
            device = yield* exportDevice(f.owner);
          for (const kind of ['duplicate', 'rollback'] as const) {
            attack = kind;
            const failed = yield* Effect.result(owner.refresh());
            expect(Result.isFailure(failed)).toBe(true);
            const after = yield* owner.current();
            expect(after.offset).toBe(before.offset);
            expect(after.view.head.equals(before.view.head)).toBe(true);
            expect(after.view.length).toBe(before.view.length);
            expect((yield* peer.refresh()).view.head.equals(before.view.head)).toBe(true);
            expect(persisted()).toEqual(originalDisk);
            const os = yield* makeLabProcessActor((mode) =>
              Effect.succeed({
                syntheticOnly: true,
                device,
                peerSigningKey: Buffer.from(f.peer.publicKey.toBytes()).toString('hex'),
                baseUrl: f.host.baseUrl,
                directory: f.directory,
                actor: 'owner',
                mode,
                genesis: Buffer.from(f.genesis.toBytes()).toString('hex'),
                records: f.records.map((record) => Buffer.from(record).toString('hex')),
                point: {
                  head: Buffer.from(f.point().head.toBytes()).toString('hex'),
                  length: f.point().length,
                },
              })
            );
            expect((yield* os.start('open')).ok).toBe(true);
            expect((yield* os.call('refresh')).value).toEqual({
              head: Buffer.from(before.view.head.toBytes()).toString('hex'),
              length: before.view.length,
            });
            yield* os.shutdown();
            expect(persisted()).toEqual(originalDisk);
          }
          attack = undefined;
          expect((yield* owner.refresh()).offset).toBe(before.offset);
        })
      )
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 10000);
it('durably retries an unadmitted join original after a lost receipt, then starts key/content only after genuine admission', async () => {
  const root = mkdtempSync(join(tmpdir(), 'lab-join-complete-'));
  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const { openLabJoinSession } = yield* Effect.promise(
            () => import('../src/platform/join-session')
          );
          const { generateDevice } = yield* Effect.promise(() => import('../src/platform/device'));
          const { Bytes } = yield* Effect.promise(() => import('@lody/e2ee-core'));
          const f = yield* makeLabScenarioFixture(join(root, 'fixture')),
            device = yield* generateDevice();
          let drop = true;
          const transport: typeof fetch = async (input, init) => {
            const request = new Request(input, init);
            const response = await fetch(request);
            if (
              drop &&
              request.method === 'POST' &&
              request.url.endsWith('/joins') &&
              response.ok
            ) {
              drop = false;
              await response.body?.cancel();
              throw new Error('lost-join-receipt');
            }
            return response;
          };
          const joinInput = {
            path: join(f.directory, 'pending-join.sqlite'),
            baseUrl: f.host.baseUrl,
            genesis: f.genesis,
            signer: device,
            encryptionPublicKey: device.enc,
            requestId: Result.getOrThrow(Bytes.requestId(new Uint8Array(16).fill(123))),
            userId: Result.getOrThrow(Bytes.userId(new Uint8Array(32).fill(124))),
            expiresAt: null,
            fetch: transport,
          };
          const joining = yield* openLabJoinSession({ ...joinInput, mode: 'create' });
          const original = joining.original();
          expect(Result.isFailure(yield* Effect.result(joining.submit()))).toBe(true);
          const keyRequest = yield* Effect.promise(() =>
            joining.discovery.fetch(joining.discovery.url, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ op: 'fetch', epoch: 0, cursor: null, limit: 100 }),
            })
          );
          expect(keyRequest.status).toBe(403);
          yield* Effect.promise(() => keyRequest.body?.cancel() ?? Promise.resolve());
          const reopened = yield* openLabJoinSession({ ...joinInput, mode: 'open' });
          expect(reopened.original()).toEqual(original);
          const submitted = yield* reopened.submit();
          const owner = yield* openLabWorkspaceSession(f.input('owner', 'create'));
          const requests = yield* owner.listJoins();
          expect(requests).toHaveLength(1);
          expect(requests[0]!.requestId.equals(submitted.requestId)).toBe(true);
          const result = yield* owner.approveJoin(
            submitted,
            Result.getOrThrow(Bytes.membershipId(new Uint8Array(16).fill(125)))
          );
          expect(result.outcome).toBe('Committed');
          yield* owner.acknowledge(result);
          yield* owner.keyRound();
          yield* owner.createDocument('loro');
          yield* owner.append('loro', 'only admitted readers');
          const base = f.input('peer', 'create'),
            file = (name: string) => join(f.directory, `joiner-${name}.sqlite`);
          const session = yield* openLabWorkspaceSession({
            ...base,
            signer: device,
            path: file('feed'),
            journalPath: file('journal'),
            keys: {
              ...base.keys,
              pair: device.encryption,
              path: file('receive'),
              keyStore: { ...base.keys.keyStore, path: file('keys') },
              repairStore: { ...base.keys.repairStore, path: file('repair') },
              sendStore: { ...base.keys.sendStore, path: file('send') },
              outboxStore: { ...base.keys.outboxStore, path: file('outbox') },
            },
            documents: base.documents.map((doc) => ({ ...doc, path: file(doc.id) })),
          });
          yield* session.keyRound();
          yield* session.pull('loro');
          expect(yield* session.text('loro')).toBe('only admitted readers');
        })
      )
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 15000);

it('revalidates changed signed fixture originals before reusing synthetic authority', async () => {
  const root = mkdtempSync(join(tmpdir(), 'lab-fixture-originals-'));
  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fixture = yield* makeLabScenarioFixture(join(root, 'fixture'));
          const before = fixture.view();
          const record = fixture.records[0]!;
          const original = new Uint8Array(record);
          record[record.length - 1] = record[record.length - 1]! ^ 1;
          expect(() => fixture.view()).toThrow();
          record.set(original);
          expect(fixture.view().inspectState()).toEqual(before.inspectState());
        })
      )
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 10000);
