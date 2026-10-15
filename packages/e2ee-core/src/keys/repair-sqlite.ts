import { openSqliteStore, makeSqliteLedgerPin } from '../storage/sqlite';
import { isAbsolute } from 'node:path';
import { Data, Effect, Result } from 'effect';
import * as Bytes from '../bytes';
import { keyId } from '../identifiers';
import { type LedgerView } from '../ledger';
import { isHash, type MailboxSlot } from './reports';
export class RepairError extends Data.TaggedError('RepairError')<{
  readonly code:
    | 'invalid-input'
    | 'closed'
    | 'storage'
    | 'corrupt'
    | 'rollback'
    | 'unauthorized'
    | 'replay';
}> {}
const fail = (code: RepairError['code']) => new RepairError({ code });
const sql = <A>(work: () => A) =>
  Effect.try({
    try: work,
    catch: (error) => (error instanceof RepairError ? error : fail('storage')),
  });
const APP = 0x4c455232;
const validId = (id: unknown): id is string =>
  typeof id === 'string' && id.length >= 1 && id.length <= 256;
const validLimit = (limit: number) => Number.isInteger(limit) && limit >= 1 && limit <= 100;
interface Task {
  readonly id: string;
  readonly epoch: number;
  readonly rejected: string | null;
  readonly phase: 'Pending' | 'Repaired' | 'Obsolete' | 'Revoked';
}
/** Stable-ID repair episodes, no key installation/custody proof. Application Scope owns local journal. */
export function makeSqliteMailboxRepair(input: {
  readonly path: string;
  readonly mode: 'create' | 'open';
  readonly genesis: Bytes.GenesisHash;
  readonly recipient: Bytes.SigningPublicKey;
  readonly ledger: () => Effect.Effect<LedgerView, unknown>;
  readonly remote: {
    readonly repair: (
      slot: MailboxSlot,
      id: string,
      rejectedDigest?: string
    ) => Effect.Effect<void, unknown>;
  };
}) {
  return Effect.gen(function* () {
    const { path, mode } = input,
      lookup = input.ledger,
      repair = input.remote.repair.bind(input.remote);
    const anchor = yield* Effect.fromResult(Bytes.genesisHash(input.genesis.toBytes())),
      recipient = yield* Effect.fromResult(Bytes.signingPublicKey(input.recipient.toBytes()));
    const org = keyId(anchor.toBytes()),
      self = keyId(recipient.toBytes());
    if (typeof path !== 'string' || !isAbsolute(path) || (mode !== 'create' && mode !== 'open'))
      return yield* fail('invalid-input');
    const db = yield* openSqliteStore({
      path,
      mode,
      applicationId: APP,
      version: 1,
      initialize(connection) {
        connection.exec(`CREATE TABLE repair_meta(id INTEGER PRIMARY KEY CHECK(id=1),genesis TEXT NOT NULL,recipient TEXT NOT NULL,head BLOB,count INTEGER);
   CREATE TABLE repair_tasks(id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 256),epoch INTEGER NOT NULL CHECK(epoch BETWEEN 0 AND 4294967295),rejected TEXT CHECK(rejected IS NULL OR length(rejected)=64),phase TEXT NOT NULL CHECK(phase IN ('Pending','Repaired','Obsolete','Revoked')),consumed INTEGER NOT NULL DEFAULT 0 CHECK(consumed IN (0,1)));
   CREATE INDEX pending_repair ON repair_tasks(phase,id);`);
        connection
          .prepare('INSERT INTO repair_meta(id,genesis,recipient) VALUES(1,?,?)')
          .run(org, self);
      },
      validate(connection) {
        const meta = connection
          .prepare('SELECT genesis,recipient FROM repair_meta WHERE id=1')
          .get() as { genesis?: unknown; recipient?: unknown; sender?: unknown } | undefined;
        if (meta?.genesis !== org || meta?.recipient !== self) throw fail('corrupt');
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

    const observePin = makeSqliteLedgerPin({
      db,
      table: 'repair_meta',
      genesis: org,
      bindings: { recipient: self },
      error: fail,
    });
    const current = () =>
      Effect.gen(function* () {
        yield* sql(guard);
        const view = yield* lookup();
        yield* sql(() => {
          guard();
          observePin(view);
        });
        return view;
      });
    const parse = (row: Record<string, unknown>): Task => {
      if (
        !validId(row.id) ||
        typeof row.epoch !== 'number' ||
        Result.isFailure(Bytes.epochNumber(row.epoch)) ||
        (row.rejected !== null && !isHash(row.rejected)) ||
        !['Pending', 'Repaired', 'Obsolete', 'Revoked'].includes(String(row.phase))
      )
        throw fail('corrupt');
      return {
        id: row.id,
        epoch: row.epoch,
        rejected: row.rejected as string | null,
        phase: row.phase as Task['phase'],
      };
    };
    const select =
      "SELECT CASE WHEN length(id) BETWEEN 1 AND 256 THEN id ELSE NULL END AS id,epoch,CASE WHEN rejected IS NULL OR length(rejected)=64 THEN rejected ELSE '' END AS rejected,CASE WHEN phase IN ('Pending','Repaired','Obsolete','Revoked') THEN phase ELSE '' END AS phase FROM repair_tasks";
    const load = (id: string) => {
      guard();
      const row = db.prepare(select + ' WHERE id=?').get(id) as Record<string, unknown> | undefined;
      if (!row) throw fail('corrupt');
      return parse(row);
    };
    const disposition = (view: LedgerView, task: Task): 'Obsolete' | 'Revoked' | null => {
      const state = view.inspectState();
      if (state.epoch.number !== task.epoch) return 'Obsolete';
      const device = state.devices.get(self);
      return !device ? 'Revoked' : null;
    };
    const finish = (task: Task, phase: 'Repaired' | 'Obsolete' | 'Revoked') =>
      sql(() =>
        db
          .transaction(() => {
            const stored = load(task.id);
            if (stored.epoch !== task.epoch || stored.rejected !== task.rejected)
              throw fail('corrupt');
            if (stored.phase === phase) return;
            if (
              stored.phase !== 'Pending' ||
              db
                .prepare(
                  "UPDATE repair_tasks SET phase=?,consumed=0 WHERE id=? AND phase='Pending'"
                )
                .run(phase, task.id).changes !== 1
            )
              throw fail('corrupt');
            const completed = load(task.id);
            const receipt = db
              .prepare('SELECT consumed FROM repair_tasks WHERE id=?')
              .get(task.id) as { consumed: unknown } | undefined;
            if (
              completed.phase !== phase ||
              completed.epoch !== task.epoch ||
              completed.rejected !== task.rejected ||
              receipt?.consumed !== 0
            )
              throw fail('corrupt');
          })
          .immediate()
      );
    const flush = (limit = 100, cursor: string | null = null) =>
      Effect.gen(function* () {
        if (!validLimit(limit) || (cursor !== null && !validId(cursor)))
          return yield* fail('invalid-input');
        const page = yield* sql(() =>
          db
            .transaction(() => {
              guard();
              const rows = db
                .prepare(
                  select + " WHERE phase='Pending' AND (? IS NULL OR id>?) ORDER BY id LIMIT ?"
                )
                .all(cursor, cursor, limit) as Record<string, unknown>[];
              const tasks = rows.map(parse),
                last = tasks.at(-1);
              const more =
                last &&
                db
                  .prepare(
                    "SELECT 1 AS found FROM repair_tasks WHERE phase='Pending' AND id>? LIMIT 1"
                  )
                  .get(last.id);
              return { tasks, next: more ? last!.id : null };
            })
            .deferred()
        );
        const blocked: string[] = [];
        for (const task of page.tasks) {
          const result = yield* Effect.result(
            Effect.gen(function* () {
              const view = yield* current(),
                reason = disposition(view, task);
              if (reason) {
                yield* finish(task, reason);
                return;
              }
              yield* sql(guard);
              yield* repair(
                { genesis: org, epoch: task.epoch, recipient: self },
                task.id,
                task.rejected ?? undefined
              );
              yield* sql(guard);
              const latest = yield* current();
              yield* finish(task, disposition(latest, task) ?? 'Repaired');
            })
          );
          if (Result.isFailure(result)) blocked.push(task.id);
        }
        return { processed: page.tasks.length, blocked, next: page.next };
      });
    return Object.freeze({
      enqueue: (requestId: string, rejectedDigest?: string) =>
        Effect.gen(function* () {
          const id = requestId,
            rejected = rejectedDigest ?? null;
          if (!validId(id) || (rejected !== null && !isHash(rejected)))
            return yield* fail('invalid-input');
          const view = yield* current(),
            epoch = view.inspectState().epoch.number;
          if (disposition(view, { id, epoch, rejected, phase: 'Pending' }))
            return yield* fail('unauthorized');
          yield* sql(() =>
            db
              .transaction(() => {
                guard();
                db.prepare(
                  "INSERT INTO repair_tasks(id,epoch,rejected,phase) VALUES(?,?,?,'Pending') ON CONFLICT(id) DO NOTHING"
                ).run(id, epoch, rejected);
                const original = load(id);
                if (original.epoch !== epoch || original.rejected !== rejected)
                  throw fail('replay');
              })
              .immediate()
          );
          return { id };
        }),
      flush,
      results: (limit = 100, cursor: string | null = null) =>
        sql(() => {
          guard();
          if (!validLimit(limit) || (cursor !== null && !validId(cursor)))
            throw fail('invalid-input');
          return db
            .transaction(() => {
              const tasks = (
                db
                  .prepare(
                    select +
                      " WHERE phase<>'Pending' AND consumed=0 AND (? IS NULL OR id>?) ORDER BY id LIMIT ?"
                  )
                  .all(cursor, cursor, limit) as Record<string, unknown>[]
              ).map(parse);
              const last = tasks.at(-1),
                more =
                  last &&
                  db
                    .prepare(
                      "SELECT 1 AS found FROM repair_tasks WHERE phase<>'Pending' AND consumed=0 AND id>? LIMIT 1"
                    )
                    .get(last.id);
              return {
                items: tasks.map((task) => ({
                  id: task.id,
                  outcome: task.phase as 'Repaired' | 'Obsolete' | 'Revoked',
                })),
                next: more ? last!.id : null,
              };
            })
            .deferred();
        }),
      acknowledge: (id: string) =>
        sql(() => {
          guard();
          if (!validId(id)) throw fail('invalid-input');
          db.transaction(() => {
            const row = db.prepare(select + ' WHERE id=?').get(id) as
              | Record<string, unknown>
              | undefined;
            if (!row) return;
            const original = parse(row);
            if (original.phase === 'Pending') return;
            if (
              db
                .prepare("UPDATE repair_tasks SET consumed=1 WHERE id=? AND phase<>'Pending'")
                .run(id).changes !== 1
            )
              throw fail('corrupt');
            const saved = load(id),
              receipt = db.prepare('SELECT consumed FROM repair_tasks WHERE id=?').get(id) as
                | { consumed: unknown }
                | undefined;
            if (
              saved.epoch !== original.epoch ||
              saved.rejected !== original.rejected ||
              saved.phase !== original.phase ||
              receipt?.consumed !== 1
            )
              throw fail('corrupt');
          }).immediate();
        }),
    });
  });
}
