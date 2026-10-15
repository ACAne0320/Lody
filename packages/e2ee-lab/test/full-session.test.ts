import Database from 'better-sqlite3';
import { makeLabProcessActor } from '../src/platform/process-actor';
import { exportDevice } from '../src/platform/device';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect, Result } from 'effect';
import { decodeRecord } from '@lody/e2ee-core/ledger';
import { signLedgerSnapshot, type SnapshotTrust } from '@lody/e2ee-core/ledger/snapshot';
import { labSyntheticProtector } from '../src/platform/synthetic-protection';
import { openLabExistingWorkspace } from '../src/platform/workspace-session';
import { expect, it } from 'vitest';
import { makeLabScenarioFixture } from '../src/platform/scenario-fixture';
import {
  openLabWorkspaceSession,
  reauthenticateLabWorkspaceSession,
} from '../src/platform/full-session';
it('starts and reopens an authenticated workspace from an independently qualified snapshot without reading its old control prefix', async () => {
  const root = mkdtempSync(join(tmpdir(), 'lab-workspace-snapshot-origin-'));
  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const f = yield* makeLabScenarioFixture(join(root, 'fixture'));
          const signed = yield* signLedgerSnapshot({ signer: f.owner, ledger: f.ledger });
          const original = Result.getOrThrow(decodeRecord(f.records[0]!));
          if (original.body.type !== 'genesis') throw new Error('genuine genesis required');
          const trust: SnapshotTrust = {
            source: 'external-confirmation',
            genesis: f.genesis,
            head: f.point().head,
            length: f.point().length,
            endorser: f.owner.publicKey,
            membershipId: original.body.membershipId,
            role: 'owner',
            kind: 'personal',
            headSignature: signed.headSignature,
          };
          const selected = yield* Effect.tryPromise({
            try: () =>
              fetch(
                `${f.server.baseUrl}/ds/${Buffer.from(f.genesis.toBytes()).toString('hex')}/control`,
                { method: 'HEAD' }
              ),
            catch: (cause) => cause,
          });
          const offset = selected.headers.get('stream-next-offset');
          yield* Effect.promise(() => selected.body?.cancel() ?? Promise.resolve());
          if (!selected.ok || !offset) throw new Error('actual transport origin required');
          const requested: string[] = [];
          const transport: typeof fetch = (value, init) => {
            const url = new URL(value instanceof Request ? value.url : String(value));
            if (url.pathname.endsWith('/control') && (init?.method ?? 'GET') === 'GET') {
              requested.push(url.searchParams.get('offset') ?? '');
              if (url.searchParams.get('offset') === '-1')
                return Promise.reject(new Error('snapshot startup must not replay the old prefix'));
            }
            return fetch(value, init);
          };
          const config = {
            ...f.input('owner', 'create'),
            fetch: transport,
            snapshot: { bytes: signed.snapshot, trust, offset },
          };
          const first = yield* openLabExistingWorkspace(config);
          expect((yield* first.control.current()).view.head.equals(trust.head)).toBe(true);
          expect(requested).toEqual([offset]);
          yield* first.close();
          const reopened = yield* openLabExistingWorkspace({
            ...config,
            mode: 'open',
            expected: f.point(),
          });
          expect((yield* reopened.control.current()).offset).toBe(offset);
          expect(requested).toEqual([offset, offset]);
          const disk = new Database(config.path, { readonly: true });
          try {
            expect(disk.prepare('SELECT COUNT(*) AS n FROM snapshot_feed_records').get()).toEqual({
              n: 0,
            });
          } finally {
            disk.close();
          }
        })
      )
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 15000);
it('publishes and installs real new epochs, distributes them, resumes current-epoch document writes and reopens retained candidates', async () => {
  const root = mkdtempSync(join(tmpdir(), 'lab-real-epoch-publisher-'));
  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const f = yield* makeLabScenarioFixture(join(root, 'fixture'));
          const original = f.input('owner', 'create');
          const input = {
            ...original,
            epochRotation: {
              path: join(root, 'owner-candidates.sqlite'),
              mode: 'create' as const,
              protector: labSyntheticProtector,
            },
          };
          const owner = yield* openLabWorkspaceSession(input);
          const peer = yield* openLabWorkspaceSession(f.input('peer', 'create'));
          yield* owner.keyRound();
          yield* peer.keyRound();
          yield* owner.createDocument('loro');
          yield* owner.append('loro', 'epoch zero');
          yield* peer.pull('loro');

          const first = yield* owner.rotateEpoch();
          expect(first.outcome).toBe('Committed');
          expect(first.epoch).toBe(1);
          expect(first.binding).toBe('current');
          const publication = Result.getOrThrow(decodeRecord(first.record));
          expect(publication.body.type).toBe('ordinary');
          if (publication.body.type !== 'ordinary') throw new Error('ordinary publication');
          expect(publication.body.operation.type).toBe('publishEpoch');
          expect((yield* owner.resumeEpochRotation())?.record).toEqual(first.record);
          yield* owner.acknowledgeEpochRotation(first);
          yield* owner.keyRound();
          yield* peer.keyRound();
          yield* owner.append('loro', ' / epoch one');
          yield* peer.pull('loro');
          expect(yield* peer.text('loro')).toBe('epoch zero / epoch one');

          // A real device revocation requires a further publication before new
          // writes. The publisher clears that state through the existing E7.
          const revoked = yield* owner.submit({ _tag: 'RevokeDevice', target: f.peer.publicKey });
          yield* owner.acknowledge(revoked);
          expect((yield* owner.current()).view.inspectState().epoch.rotationRequired).toBe(true);
          const second = yield* owner.rotateEpoch();
          expect(second.epoch).toBe(2);
          expect(second.outcome).toBe('Committed');
          expect((yield* owner.current()).view.inspectState().epoch.rotationRequired).toBe(false);
          yield* owner.acknowledgeEpochRotation(second);
          yield* owner.append('loro', ' / epoch two');
          yield* owner.pull('loro');

          const reopened = yield* reauthenticateLabWorkspaceSession(owner, input, f.point());
          expect(yield* reopened.resumeEpochRotation()).toBeNull();
          expect(yield* reopened.text('loro')).toBe('epoch zero / epoch one / epoch two');
          expect(yield* reopened.cursor('loro')).not.toBeNull();
          const disk = new Database(input.epochRotation.path, { readonly: true });
          try {
            const rows = disk
              .prepare(
                'SELECT epoch,record,outcome,consumed FROM epoch_rotation_candidates ORDER BY epoch'
              )
              .all() as { epoch: number; record: Uint8Array; outcome: string; consumed: number }[];
            expect(rows.map((row) => [row.epoch, row.outcome, row.consumed])).toEqual([
              [1, 'Committed', 1],
              [2, 'Committed', 1],
            ]);
            expect(new Uint8Array(rows[0]!.record)).toEqual(first.record);
            expect(new Uint8Array(rows[1]!.record)).toEqual(second.record);
          } finally {
            disk.close();
          }
        })
      )
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 15000);
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

it('continues blocked repair pages, retries a lost HTTP ACK after reopen and explicitly frees sender capacity without deleting originals', async () => {
  const root = mkdtempSync(join(tmpdir(), 'lab-key-results-'));
  const rows = (file: string, table: string) => {
    const db = new Database(file, { readonly: true, fileMustExist: true });
    try {
      return db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all() as Record<string, unknown>[];
    } finally {
      db.close();
    }
  };
  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const f = yield* makeLabScenarioFixture(join(root, 'fixture'));
          const ownerInput = f.input('owner', 'create');
          const owner = yield* openLabWorkspaceSession({
            ...ownerInput,
            documents: [],
            keys: {
              ...ownerInput.keys,
              sendStore: { ...ownerInput.keys.sendStore, maxTasks: 1 },
            },
          });
          let drop = true;
          const repairTransport: typeof fetch = async (input, init) => {
            const request = new Request(input, init);
            const body =
              request.method === 'POST' && request.url.endsWith('/key-mailbox')
                ? ((await request.clone().json()) as { op: string })
                : undefined;
            const response = await fetch(request);
            if (drop && body?.op === 'repair' && response.ok) {
              drop = false;
              await response.body?.cancel();
              throw new Error('lost-committed-repair-ack');
            }
            return response;
          };
          const peerInput = { ...f.input('peer', 'create'), documents: [], fetch: repairTransport };
          const peer = yield* openLabWorkspaceSession(peerInput);
          const sent = yield* owner.keyRound(1);
          expect(sent.deliveryResults.items).toHaveLength(1);
          const firstDelivery = sent.deliveryResults.items[0]!;
          expect(firstDelivery.outcome).toBe('Observed');
          yield* peer.keyRound(1);
          const originalOutbox = rows(ownerInput.keys.outboxStore.path, 'epoch_delivery');
          const installed = rows(peerInput.keys.keyStore.path, 'protected_epoch_keys');
          expect(installed).toHaveLength(1);
          yield* peer.enqueueRepair('000-blocked', 'ff'.repeat(32));
          yield* peer.enqueueRepair('001-lost');
          yield* peer.enqueueRepair('002-next');
          const first = yield* peer.keyRound(1);
          expect(first.repairs).toEqual({
            processed: 1,
            blocked: ['000-blocked'],
            next: '000-blocked',
          });
          const lost = yield* peer.keyRound(1, { repairs: first.repairs.next });
          expect(lost.repairs).toEqual({ processed: 1, blocked: ['001-lost'], next: '001-lost' });
          expect(rows(join(f.directory, 'mailbox.sqlite'), 'mailbox_repairs')).toHaveLength(1);
          const pending = rows(peerInput.keys.repairStore.path, 'repair_tasks');
          expect(pending.find((row) => row.id === '001-lost')?.phase).toBe('Pending');
          const reopened = yield* reauthenticateLabWorkspaceSession(peer, peerInput, f.point());
          const retried = yield* reopened.keyRound(1, { repairs: first.repairs.next });
          expect(retried.repairs).toEqual({ processed: 1, blocked: [], next: '001-lost' });
          expect(rows(join(f.directory, 'mailbox.sqlite'), 'mailbox_repairs')).toHaveLength(1);
          const next = yield* reopened.keyRound(1, { repairs: retried.repairs.next });
          expect(next.repairs).toEqual({ processed: 1, blocked: [], next: null });
          const remoteRepairs = rows(join(f.directory, 'mailbox.sqlite'), 'mailbox_repairs');
          expect(remoteRepairs.map((row) => row.id)).toEqual(['001-lost', '002-next']);
          const results = yield* reopened.repairResults(1);
          expect(results.items).toEqual([{ id: '001-lost', outcome: 'Repaired' }]);
          expect(results.next).toBe('001-lost');
          expect((yield* reopened.repairResults(1, results.next)).items).toEqual([
            { id: '002-next', outcome: 'Repaired' },
          ]);
          const blocked = yield* owner.keyRound(1);
          expect(blocked.reconciliation.scheduled).toBe(0);
          expect(blocked.reconciliation.blocked).toEqual([
            Buffer.from(f.peer.publicKey.toBytes()).toString('hex'),
          ]);
          expect((yield* owner.deliveryResults()).items).toEqual([firstDelivery]);
          yield* owner.acknowledgeDelivery(firstDelivery.id);
          expect((yield* owner.deliveryResults()).items).toEqual([]);
          const resent = yield* owner.keyRound(1);
          expect(resent.reconciliation.scheduled).toBe(1);
          expect(resent.deliveryResults.items[0]!.revision).toBe(2);
          expect(rows(ownerInput.keys.sendStore.path, 'distribution_tasks')).toHaveLength(2);
          expect(rows(ownerInput.keys.outboxStore.path, 'epoch_delivery')).toEqual(originalOutbox);
          const received = yield* reopened.keyRound(1);
          expect(received.results.length).toBeGreaterThan(0);
          for (const result of yield* reopened.receiveResults())
            yield* reopened.acknowledgeReceive(result.id);
          yield* reopened.acknowledgeRepair('001-lost');
          yield* reopened.acknowledgeRepair('002-next');
          expect((yield* reopened.repairResults()).items).toEqual([]);
          expect(yield* reopened.receiveResults()).toEqual([]);
          expect(rows(peerInput.keys.repairStore.path, 'repair_tasks')).toEqual([
            pending[0],
            { ...pending[1], phase: 'Repaired', consumed: 1 },
            { ...pending[2], phase: 'Repaired', consumed: 1 },
          ]);
          expect(rows(peerInput.keys.keyStore.path, 'protected_epoch_keys')).toEqual(installed);
          expect(rows(join(f.directory, 'mailbox.sqlite'), 'mailbox_repairs')).toEqual(
            remoteRepairs
          );
          const receiveHistory = rows(peerInput.keys.path, 'receive_tasks');
          expect(receiveHistory.every((row) => row.frame !== null && row.report !== null)).toBe(
            true
          );
          yield* reopened.close();
          expect(Result.isFailure(yield* Effect.result(reopened.enqueueRepair('closed')))).toBe(
            true
          );
          expect(
            Result.isFailure(yield* Effect.result(reopened.acknowledgeRepair('001-lost')))
          ).toBe(true);
        })
      )
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 0);
