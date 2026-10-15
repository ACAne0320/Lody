import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Effect, Result } from 'effect';
import { StreamsClient } from '@loro-dev/streams-client';
import { startDevServer } from '@loro-dev/sqlite-riverrun';
import { Bytes } from '@lody/e2ee-core';
import {
  signGenesisRecord,
  prepareDeviceAdmission,
  prepareLedgerCommand,
} from '@lody/e2ee-core/ledger/admission';
import { signLedgerRecord } from '@lody/e2ee-core/ledger/signing';
import { decodeRecord, hashRecordBytes, verifyLedger } from '@lody/e2ee-core/ledger';
import { frameLedgerRecord } from '@lody/e2ee-core/ledger/feed';
import { makeSqliteKeyMailbox } from '@lody/e2ee-core/keys/mailbox/sqlite';
import { makeSqliteProtectedEpochKeys } from '@lody/e2ee-core/keys/host/sqlite';
import { makeSqliteSnapshotPublication } from '@lody/e2ee-core/content/snapshot/sqlite';
import { generateDevice } from './device';
import { labSyntheticProtector } from './synthetic-protection';
import { makeLabCredentials } from './credentials';
import { makeLabWorkspaceRegistry } from './workspace-registry';
import { makeLabControlGateway } from './control-gateway';
import { makeLabStreamReader } from './stream-read';
import { makeLabContentGateway } from './content-gateway';
import { makeLabHttpHost } from './host';
import { makeLabJoinMailbox } from './join-mailbox';
import type { LabWorkspaceSessionInput } from './full-session';
const ok = Result.getOrThrow;
/** Explicit synthetic prepared-existing-workspace fixture, not createSpace or
 * epoch publication acceptance. Builds real signed full prefix/HPKE/SQLite/HTTP.
 * Independent harness pins are original records it witnessed, not server offsets.
 * Directory/private devices are local test materials, never product custody. */
export const makeLabScenarioFixture = Effect.fn('Lab.prepareExistingFixture')(function* (
  directory: string
) {
  yield* Effect.try({ try: () => mkdirSync(directory, { mode: 0o700 }), catch: (cause) => cause });
  const owner = yield* generateDevice(),
    peer = yield* generateDevice();
  const initialKey = ok(Bytes.epochKey(new Uint8Array(32).fill(117)));
  const membership = ok(Bytes.membershipId(new Uint8Array(16).fill(118)));
  const genesis = yield* signGenesisRecord({
    userId: ok(Bytes.userId(new Uint8Array(32).fill(119))),
    membershipId: membership,
    encryptionPublicKey: owner.enc,
    initialKey,
    signer: owner,
  });
  const records: Uint8Array[] = [new Uint8Array(genesis.record)];
  const point = () => ({ head: hashRecordBytes(records.at(-1)!), length: records.length });
  // This synthetic authority owns its witnessed history. Reuse a genuine view
  // only while every original byte is unchanged; a new CAS or tampered fixture
  // must pass full verification again. Transport reads still verify independently.
  let verifiedOriginals: Uint8Array[] = [];
  let verifiedView: ReturnType<typeof verifyLedger> | undefined;
  const view = () => {
    let unchanged = records.length === verifiedOriginals.length;
    for (let index = 0; unchanged && index < records.length; index++) {
      const record = records[index]!;
      const original = verifiedOriginals[index]!;
      unchanged = record.length === original.length;
      for (let offset = 0; unchanged && offset < record.length; offset++)
        unchanged = record[offset] === original[offset];
    }
    if (!unchanged || verifiedView === undefined) {
      const next = verifyLedger({ anchor: genesis.genesis, records, checkpoint: point() });
      ok(next);
      verifiedOriginals = [];
      for (let index = 0; index < records.length; index++)
        verifiedOriginals.push(new Uint8Array(records[index]!));
      verifiedView = next;
    }
    return ok(verifiedView);
  };
  const admission = yield* prepareDeviceAdmission({
    genesis: genesis.genesis,
    membershipId: membership,
    encryptionPublicKey: peer.enc,
    kind: 'personal',
    signer: peer,
  });
  records.push(
    yield* signLedgerRecord(ok(prepareLedgerCommand(view(), owner.publicKey, admission)), owner)
  );
  const server = yield* Effect.acquireRelease(
    Effect.uninterruptible(
      Effect.tryPromise({
        try: () =>
          startDevServer({
            host: '127.0.0.1',
            port: 0,
            dbPath: join(directory, 'riverrun.sqlite'),
            protocol: 'http1',
          }),
        catch: (cause) => cause,
      })
    ),
    (value) => Effect.promise(() => value.close())
  );
  const org = Buffer.from(genesis.genesis.toBytes()).toString('hex');
  const raw = yield* Effect.tryPromise({
    try: () => fetch(`${server.baseUrl}/ds/${org}`, { method: 'PUT' }),
    catch: (cause) => cause,
  });
  if (!raw.ok) return yield* Effect.fail(new Error('fixture-stream-create'));
  yield* Effect.promise(() => raw.body?.cancel() ?? Promise.resolve());
  const sdk = new StreamsClient({
    url: `${server.baseUrl}/ds/${org}/control`,
    retry: { maxAttempts: 1 },
  });
  const create = yield* Effect.tryPromise({
    try: () => sdk.create({ contentType: 'application/octet-stream' }),
    catch: (cause) => cause,
  });
  if (!create.ok) return yield* Effect.fail(new Error('fixture-control-create'));
  for (const record of records) {
    const appended = yield* Effect.tryPromise({
      try: () =>
        sdk.append({
          part: { contentType: 'application/octet-stream', body: ok(frameLedgerRecord(record)) },
        }),
      catch: (cause) => cause,
    });
    if (!appended.ok) return yield* Effect.fail(new Error('fixture-control-append'));
  }
  const ledger = () => Effect.sync(view);
  const credentials = yield* makeLabCredentials({
    path: join(directory, 'credentials.sqlite'),
    mode: 'create',
    now: () => 0,
    ledger: (anchor) =>
      anchor.equals(genesis.genesis) ? ledger() : Effect.fail(new Error('foreign-org')),
  });
  const registry = yield* makeLabWorkspaceRegistry({
    path: join(directory, 'workspaces.sqlite'),
    mode: 'create',
  });
  yield* registry.register(
    {
      account: 'synthetic-owner',
      device: owner.publicKey,
      genesis: null,
      token: '',
      issuedAt: 0,
      expiresAt: 1,
    },
    genesis.record
  );
  const control = yield* makeLabControlGateway({
    genesis: genesis.genesis,
    budget: { maxRecords: 100, maxBytes: 1024 * 1024 },
    checkpoint: () => Effect.sync(() => point()),
    now: () => 0,
    stream: {
      read: sdk.read.bind(sdk),
      appendCas: async (request) => {
        const result = await sdk.appendCas(request);
        if (result.ok && result.result.kind === 'ok') {
          const record = new Uint8Array(request.part.body.subarray(4));
          // Witness the actual CAS originals, never infer trust from host response metadata.
          ok(
            verifyLedger({
              anchor: genesis.genesis,
              records: [...records, record],
              checkpoint: { head: hashRecordBytes(record), length: records.length + 1 },
            })
          );
          records.push(record);
        }
        return result;
      },
    },
  });
  const reader = yield* makeLabStreamReader({
    genesis: genesis.genesis,
    baseUrl: server.baseUrl,
    ledger,
    maxBytes: 16 * 1024 * 1024,
  });
  const snapshotStore = (model: 'loro' | 'flock', resource: string) =>
    makeSqliteSnapshotPublication({
      path: join(directory, `${model}-snapshots.sqlite`),
      mode: 'create',
      genesis: genesis.genesis,
      model,
      resource,
    });
  const loroSnapshots = yield* snapshotStore('loro', 'document-A');
  const flockSnapshots = yield* snapshotStore('flock', 'document-B');
  const loro = yield* makeLabContentGateway({
    genesis: genesis.genesis,
    resource: 'document-A',
    model: 'loro',
    snapshotStore: loroSnapshots,
    now: () => 0,
    baseUrl: server.baseUrl,
    ledger,
  });
  const flock = yield* makeLabContentGateway({
    genesis: genesis.genesis,
    resource: 'document-B',
    model: 'flock',
    snapshotStore: flockSnapshots,
    now: () => 0,
    baseUrl: server.baseUrl,
    ledger,
  });
  const mailbox = yield* makeSqliteKeyMailbox({
    path: join(directory, 'mailbox.sqlite'),
    mode: 'create',
    genesis: genesis.genesis,
    ledger,
  });
  const joins = yield* makeLabJoinMailbox({
    path: join(directory, 'joins.sqlite'),
    mode: 'create',
    genesis: genesis.genesis,
    ledger,
  });
  const host = yield* makeLabHttpHost({
    credentials,
    workspaces: registry,
    streams: () => reader,
    control: () => control,
    contents: (_, model) => (model === 'loro' ? loro : flock),
    mailbox: () => mailbox,
    joins: () => joins,
  });
  const ownerKeys = yield* makeSqliteProtectedEpochKeys({
    path: join(directory, 'owner-keys.sqlite'),
    mode: 'create',
    genesis: genesis.genesis,
    recipient: owner.publicKey,
    ledger,
    protector: labSyntheticProtector,
  });
  yield* ownerKeys.saveAndReload(0, initialKey);
  let time = 100;
  const input = (actor: 'owner' | 'peer', mode: 'create' | 'open'): LabWorkspaceSessionInput => ({
    baseUrl: host.baseUrl,
    genesis: genesis.genesis,
    signer: actor === 'owner' ? owner : peer,
    path: join(directory, `${actor}-feed.sqlite`),
    journalPath: join(directory, `${actor}-journal.sqlite`),
    mode,
    expected: mode === 'open' ? point() : undefined,
    checkpoint: () => Effect.sync(() => point()),
    budget: { maxRecords: 100, maxBytes: 1024 * 1024 },
    keys: {
      path: join(directory, `${actor}-receive.sqlite`),
      mode,
      pair: (actor === 'owner' ? owner : peer).encryption,
      keyStore: {
        path: join(directory, `${actor}-keys.sqlite`),
        mode: actor === 'owner' ? 'open' : mode,
        protector: labSyntheticProtector,
      },
      repairStore: { path: join(directory, `${actor}-repair.sqlite`), mode },
      sendStore: { path: join(directory, `${actor}-send.sqlite`), mode },
      outboxStore: { path: join(directory, `${actor}-outbox.sqlite`), mode },
      currentPublication: (current) =>
        Effect.sync(() => {
          const epoch = current.inspectState().epoch.number;
          for (let index = records.length - 1; index >= 0; index--) {
            const record = records[index]!,
              decoded = ok(decodeRecord(record));
            if (
              (epoch === 0 && decoded.body.type === 'genesis') ||
              (decoded.body.type === 'ordinary' &&
                (decoded.body.operation.type === 'publishEpoch' ||
                  decoded.body.operation.type === 'removeMemberAndPublishEpoch') &&
                decoded.body.operation.epoch === epoch)
            )
              return new Uint8Array(record);
          }
          return null;
        }),
    },
    documents: [
      {
        id: 'loro',
        resource: 'document-A',
        path: join(directory, `${actor}-loro.sqlite`),
        mode,
        streamUrl: `${host.baseUrl}/ds/${org}/loro`,
      },
      {
        id: 'flock',
        model: 'flock',
        now: () => ++time,
        resource: 'document-B',
        path: join(directory, `${actor}-flock.sqlite`),
        mode,
        streamUrl: `${host.baseUrl}/ds/${org}/flock`,
      },
    ],
  });
  return {
    input,
    point,
    view,
    ledger,
    directory,
    server,
    host,
    owner,
    peer,
    records,
    genesis: genesis.genesis,
  };
});
