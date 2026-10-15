import { openSqliteStore } from '../storage/sqlite';
import { isAbsolute } from 'node:path';
import { Context, Data, Effect, Layer, Result } from 'effect';
import { sha256 } from '@noble/hashes/sha2.js';
import * as Bytes from '../bytes';
import { disposeEpochKey } from '../epoch-key';
import { keyId } from '../identifiers';
import { decodeRecord, type LedgerView } from '../ledger';
import { makeSqliteRecipientMailbox, type RecipientMailboxRemote } from './mailbox-client';
import { sqliteDeliveryOutbox } from './delivery-sqlite';
import {
  DeliveryOutbox,
  DeliveryRemote,
  DeliveryRemoteError,
  deliverEpochEnvelope,
  epochDeliveryId,
} from './delivery';
import { fromHex, isHash } from './reports';

export class DistributionError extends Data.TaggedError('DistributionError')<{
  readonly code:
    | 'storage'
    | 'corrupt'
    | 'closed'
    | 'invalid-input'
    | 'context-changed'
    | 'task-limit';
}> {}
const fail = (code: DistributionError['code']) => new DistributionError({ code });
type Phase = 'Pending' | 'Observed' | 'Obsolete' | 'Revoked';
type Task = {
  id: string;
  epoch: number;
  recipient: string;
  revision: number;
  phase: Phase;
  consumed: number;
};
export interface DistributionMailboxRemote extends RecipientMailboxRemote {
  readonly put: (id: string, frame: Uint8Array) => Effect.Effect<void, unknown>;
  readonly read: (id: string) => Effect.Effect<Uint8Array | null, unknown>;
}
const APP = 0x4c454453;
const taskId = (delivery: string, revision: number) =>
  keyId(
    sha256(new TextEncoder().encode(`lody-e2ee/local-distribution-task/v0:${delivery}:${revision}`))
  );
const boundedPage = (limit: number, cursor: string | null, idLength: 32 | 64) =>
  Number.isInteger(limit) &&
  limit >= 1 &&
  limit <= 100 &&
  (cursor === null ||
    (typeof cursor === 'string' && new RegExp(`^[0-9a-f]{${idLength}}$`).test(cursor)));
const senderEligible = (view: LedgerView, self: string) => {
  const state = view.inspectState(),
    device = state.devices.get(self);
  return (
    !!device &&
    device.kind !== 'recovery' &&
    state.members.has(keyId(device.membershipId.toBytes()))
  );
};

/** One inert, finite distributor. It uses actual public receiver/key/outbox owners.
 * Remote revisions trigger retries only; never authorization or obsolete results. */
export function makeSqliteKeyDistribution(
  input: Omit<Parameters<typeof makeSqliteRecipientMailbox>[0], 'remote'> & {
    readonly remote: DistributionMailboxRemote;
    readonly sendStore: {
      readonly path: string;
      readonly mode: 'create' | 'open';
      /** Unacknowledged tasks/results only; acknowledged originals remain retained. */
      readonly maxTasks?: number;
    };
    readonly outboxStore: { readonly path: string; readonly mode: 'create' | 'open' };
    /** Untrusted original candidate. Receiver verifies exact membership and publication. */
    readonly currentPublication: (view: LedgerView) => Effect.Effect<Uint8Array | null, unknown>;
  }
) {
  return Effect.gen(function* () {
    const config = { ...input.sendStore },
      outboxConfig = { ...input.outboxStore };
    const maxTasks = config.maxTasks ?? 10000;
    if (!Number.isSafeInteger(maxTasks) || maxTasks < 1 || maxTasks > 100000)
      return yield* fail('invalid-input');
    const publication = input.currentPublication;
    const native = input.keyStore.protector;
    const keyConfig = {
      ...input.keyStore,
      protector: Object.freeze({
        protect: native.protect.bind(native),
        unprotect: native.unprotect.bind(native),
      }),
    };
    const recipientConfig = {
      ...input,
      keyStore: keyConfig,
      repairStore: { ...input.repairStore },
    };
    const remote = Object.freeze({
      fetch: input.remote.fetch.bind(input.remote),
      report: input.remote.report.bind(input.remote),
      repair: input.remote.repair.bind(input.remote),
      put: input.remote.put.bind(input.remote),
      read: input.remote.read.bind(input.remote),
      status: input.remote.status.bind(input.remote),
    });
    const anchor = yield* Effect.fromResult(Bytes.genesisHash(input.genesis.toBytes()));
    const signer = Object.freeze({
      publicKey: yield* Effect.fromResult(Bytes.signingPublicKey(input.signer.publicKey.toBytes())),
      sign: input.signer.sign.bind(input.signer),
    });
    const recipient = yield* makeSqliteRecipientMailbox({
      ...recipientConfig,
      remote,
      genesis: anchor,
      signer,
      pair: { publicKey: input.pair.publicKey, privateKey: input.pair.privateKey },
    });
    const observe = recipient.observeLedger;
    const org = keyId(anchor.toBytes()),
      self = keyId(signer.publicKey.toBytes());
    const keys = recipient.installedEpochKeys;
    const outbox = Context.get(
      yield* Layer.build(sqliteDeliveryOutbox(outboxConfig)),
      DeliveryOutbox
    );
    const deliveryRemote = DeliveryRemote.of({
      put: (id, frame) =>
        remote.put(id, frame).pipe(Effect.mapError(() => new DeliveryRemoteError())),
      read: (id) => remote.read(id).pipe(Effect.mapError(() => new DeliveryRemoteError())),
    });
    const sql = <A>(work: () => A) =>
      Effect.try({
        try: work,
        catch: (error) => (error instanceof DistributionError ? error : fail('storage')),
      });
    if (!isAbsolute(config.path) || (config.mode !== 'create' && config.mode !== 'open'))
      return yield* fail('invalid-input');
    const db = yield* openSqliteStore({
      path: config.path,
      mode: config.mode,
      applicationId: APP,
      version: 1,
      initialize(connection) {
        connection.exec(`CREATE TABLE distribution_meta(id INTEGER PRIMARY KEY CHECK(id=1),genesis TEXT NOT NULL,sender TEXT NOT NULL);
          CREATE TABLE distribution_tasks(id TEXT PRIMARY KEY,epoch INTEGER NOT NULL,recipient TEXT NOT NULL,revision INTEGER NOT NULL,phase TEXT NOT NULL,consumed INTEGER NOT NULL,UNIQUE(epoch,recipient,revision));
          CREATE INDEX distribution_pending ON distribution_tasks(phase,id);
          CREATE INDEX distribution_results ON distribution_tasks(consumed,phase,id);
          `);
        connection.prepare('INSERT INTO distribution_meta VALUES(1,?,?)').run(org, self);
      },
      validate(connection) {
        const meta = connection
          .prepare('SELECT genesis,sender FROM distribution_meta WHERE id=1')
          .get() as { genesis?: unknown; recipient?: unknown; sender?: unknown } | undefined;
        if (meta?.genesis !== org || meta?.sender !== self) throw fail('corrupt');
      },
      error: fail,
    });
    let closed = false;
    const guard = () => {
      if (closed) throw fail('closed');
    };
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        closed = true;
      })
    );
    const columns = 'id,epoch,recipient,revision,phase,consumed';
    const parse = (row: unknown): Task => {
      if (!row || typeof row !== 'object') throw fail('corrupt');
      const task = row as Task;
      if (
        !/^[0-9a-f]{64}$/.test(task.id) ||
        !isHash(task.recipient) ||
        !Number.isSafeInteger(task.epoch) ||
        task.epoch < 0 ||
        task.epoch > 0xffffffff ||
        !Number.isSafeInteger(task.revision) ||
        task.revision < 0 ||
        !['Pending', 'Observed', 'Obsolete', 'Revoked'].includes(task.phase) ||
        ![0, 1].includes(task.consumed) ||
        (task.phase === 'Pending' && task.consumed !== 0)
      )
        throw fail('corrupt');
      const expected = Result.getOrThrow(
        epochDeliveryId({
          genesis: anchor,
          sender: signer.publicKey,
          epoch: Result.getOrThrow(Bytes.epochNumber(task.epoch)),
          recipient: Result.getOrThrow(Bytes.signingPublicKey(fromHex(task.recipient))),
        })
      );
      if (task.id !== taskId(expected, task.revision)) throw fail('corrupt');
      return { ...task };
    };

    const load = (id: string) =>
      parse(db.prepare(`SELECT ${columns} FROM distribution_tasks WHERE id=?`).get(id));
    const equal = (a: Task, b: Task) =>
      a.id === b.id &&
      a.epoch === b.epoch &&
      a.recipient === b.recipient &&
      a.revision === b.revision &&
      a.phase === b.phase &&
      a.consumed === b.consumed;
    const mutate = (id: string, expected: Task, write: () => number) =>
      sql(() =>
        db
          .transaction(() => {
            guard();
            const prior = db
              .prepare(`SELECT ${columns} FROM distribution_tasks WHERE id=?`)
              .get(id) as Task | undefined;
            if ((!prior || prior.consumed !== 0) && expected.consumed === 0) {
              const { count } = db
                .prepare('SELECT count(*) AS count FROM distribution_tasks WHERE consumed=0')
                .get() as { count: number };
              if (count >= maxTasks) throw fail('task-limit');
            }
            if (write() !== 1 || !equal(load(id), expected)) throw fail('corrupt');
          })
          .immediate()
      );
    const current = () =>
      Effect.gen(function* () {
        yield* sql(guard);
        const view = yield* observe();
        yield* sql(guard);
        return view;
      });
    const hint = (epoch: number, target: string) =>
      Effect.gen(function* () {
        const value = yield* remote.status({ genesis: org, epoch, recipient: target });
        const revision = value.revision;
        if (
          value.genesis !== org ||
          value.epoch !== epoch ||
          value.recipient !== target ||
          !Number.isSafeInteger(revision) ||
          revision < 0
        )
          return yield* fail('context-changed');
        yield* sql(guard);
        return { revision, status: value.status };
      });
    const terminal = (task: Task, phase: Exclude<Phase, 'Pending'>) => {
      const next = { ...task, phase, consumed: 0 };
      return mutate(task.id, next, () => {
        const actual = load(task.id);
        if (!equal(actual, task)) throw fail('context-changed');
        return db
          .prepare('UPDATE distribution_tasks SET phase=?,consumed=0 WHERE id=?')
          .run(phase, task.id).changes;
      });
    };
    const disposition = (view: LedgerView, task: Task) =>
      view.inspectState().epoch.number !== task.epoch
        ? ('Obsolete' as const)
        : !senderEligible(view, self) || !view.inspectState().devices.has(task.recipient)
          ? ('Revoked' as const)
          : null;
    return Object.freeze({
      ...recipient,
      /** Sorted targets come from our genuine ledger, never the server list. */
      reconcileCurrentEpoch: (limit = 100, cursor: string | null = null) =>
        Effect.gen(function* () {
          if (!boundedPage(limit, cursor, 64)) return yield* fail('invalid-input');
          const view = yield* current(),
            epoch = view.inspectState().epoch.number;
          if (!senderEligible(view, self))
            return { scheduled: 0, next: null, blocked: [] as string[] };
          const record = yield* publication(view);
          yield* sql(guard);
          if (record !== null) {
            if (!(record instanceof Uint8Array) || record.length > 8192)
              return yield* fail('invalid-input');
            const original = new Uint8Array(record),
              decoded = yield* Effect.fromResult(decodeRecord(original));
            if (decoded.body.signer.equals(signer.publicKey))
              yield* recipient.recordLocalInstallation(original);
          }
          const state = view.inspectState(),
            targets = [...state.devices.entries()]
              .filter(
                ([id, device]) =>
                  id !== self &&
                  state.members.has(keyId(device.membershipId.toBytes())) &&
                  id > (cursor ?? '')
              )
              .map(([id]) => id)
              .sort();
          const selected = targets.slice(0, limit),
            blocked: string[] = [];
          let scheduled = 0;
          for (const target of selected) {
            const attempted = yield* Effect.result(
              Effect.gen(function* () {
                const remoteHint = yield* hint(epoch, target),
                  latest = yield* current();
                if (
                  latest.inspectState().epoch.number !== epoch ||
                  !senderEligible(latest, self) ||
                  !latest.inspectState().devices.has(target)
                )
                  return yield* fail('context-changed');
                const delivery = yield* Effect.fromResult(
                  epochDeliveryId({
                    genesis: anchor,
                    epoch: yield* Effect.fromResult(Bytes.epochNumber(epoch)),
                    sender: signer.publicKey,
                    recipient: yield* Effect.fromResult(Bytes.signingPublicKey(fromHex(target))),
                  })
                );
                const id = taskId(delivery, remoteHint.revision);
                const prior = yield* sql(() =>
                  db.prepare(`SELECT ${columns} FROM distribution_tasks WHERE id=?`).get(id)
                );
                if (prior) {
                  parse(prior);
                  return false;
                }
                const next: Task = {
                  id,
                  epoch,
                  recipient: target,
                  revision: remoteHint.revision,
                  phase: 'Pending',
                  consumed: 0,
                };
                yield* mutate(
                  id,
                  next,
                  () =>
                    db
                      .prepare('INSERT INTO distribution_tasks VALUES(?,?,?,?,?,?)')
                      .run(id, epoch, target, next.revision, next.phase, 0).changes
                );
                return true;
              })
            );
            if (Result.isFailure(attempted)) {
              if (
                attempted.failure instanceof DistributionError &&
                ['storage', 'corrupt'].includes(attempted.failure.code)
              )
                return yield* attempted.failure;
              blocked.push(target);
            } else if (attempted.success) scheduled++;
          }
          yield* sql(guard);
          return { scheduled, blocked, next: targets.length > limit ? selected.at(-1)! : null };
        }),
      resumePendingDeliveries: (limit = 100, cursor: string | null = null) =>
        Effect.gen(function* () {
          if (!boundedPage(limit, cursor, 64)) return yield* fail('invalid-input');
          const page = yield* sql(() => {
            guard();
            const ids = db
              .prepare(
                "SELECT id FROM distribution_tasks WHERE phase='Pending' AND id>? ORDER BY id LIMIT ?"
              )
              .all(cursor ?? '', limit + 1) as { id: string }[];
            return {
              ids: ids.slice(0, limit),
              next: ids.length > limit ? ids[limit - 1]!.id : null,
            };
          });
          const blocked: string[] = [];
          for (const row of page.ids) {
            const attempt = yield* Effect.result(
              Effect.gen(function* () {
                const task = yield* sql(() => {
                    guard();
                    return load(row.id);
                  }),
                  view = yield* current(),
                  reason = disposition(view, task);
                if (reason) {
                  yield* terminal(task, reason);
                  return true;
                }
                return yield* Effect.acquireUseRelease(
                  keys.read(task.epoch),
                  (key) =>
                    Effect.gen(function* () {
                      const context = {
                        genesis: anchor,
                        epoch: Result.getOrThrow(Bytes.epochNumber(task.epoch)),
                        sender: signer.publicKey,
                        recipient: yield* Effect.fromResult(
                          Bytes.signingPublicKey(fromHex(task.recipient))
                        ),
                      };
                      const result = yield* deliverEpochEnvelope({
                        context,
                        ledger: current,
                        prepare: { key, signer },
                      }).pipe(
                        Effect.provideService(DeliveryOutbox, outbox),
                        Effect.provideService(DeliveryRemote, deliveryRemote)
                      );
                      const latest = yield* current(),
                        after = disposition(latest, task);
                      if (after) {
                        yield* terminal(task, after);
                        return true;
                      }
                      if (result.outcome !== 'Stored') return false;
                      const status = yield* hint(task.epoch, task.recipient);
                      // A repaired/rejected original cannot silently produce fresh ciphertext/ID.
                      // Remote hints leave work pending; they never create a ledger terminal reason.
                      if (status.revision !== task.revision || status.status === 'NeedsEnvelope')
                        return false;
                      const final = yield* current(),
                        ended = disposition(final, task);
                      yield* terminal(task, ended ?? 'Observed');
                      return true;
                    }),
                  (key) => Effect.sync(() => disposeEpochKey(key))
                );
              })
            );
            if (Result.isFailure(attempt)) {
              if (
                attempt.failure instanceof DistributionError &&
                ['storage', 'corrupt'].includes(attempt.failure.code)
              )
                return yield* attempt.failure;
              blocked.push(row.id);
            } else if (!attempt.success) blocked.push(row.id);
          }
          yield* sql(guard);
          return { processed: page.ids.length, blocked, next: page.next };
        }),
      deliveryResults: (limit = 100, cursor: string | null = null) =>
        sql(() => {
          guard();
          if (!boundedPage(limit, cursor, 64)) throw fail('invalid-input');
          const tasks = db
            .prepare(
              `SELECT ${columns} FROM distribution_tasks WHERE consumed=0 AND phase!='Pending' AND id>? ORDER BY id LIMIT ?`
            )
            .all(cursor ?? '', limit + 1)
            .map(parse);
          return {
            items: tasks.slice(0, limit).map(({ consumed: _consumed, phase, ...task }) => ({
              ...task,
              outcome: phase as Exclude<Phase, 'Pending'>,
            })),
            next: tasks.length > limit ? tasks[limit - 1]!.id : null,
          };
        }),
      acknowledgeDelivery: (id: string) =>
        Effect.gen(function* () {
          if (!/^[0-9a-f]{64}$/.test(id)) return yield* fail('invalid-input');
          const task = yield* sql(() => {
            guard();
            return load(id);
          });
          if (task.phase === 'Pending') return yield* fail('invalid-input');
          yield* mutate(
            id,
            { ...task, consumed: 1 },
            () => db.prepare('UPDATE distribution_tasks SET consumed=1 WHERE id=?').run(id).changes
          );
          return undefined;
        }),
    });
  });
}
