import { openSqliteStore, makeSqliteLedgerPin } from '../storage/sqlite';
import { isAbsolute } from 'node:path';
import { Data, Effect, Result } from 'effect';
import * as Bytes from '../bytes';
import { bytesEqual, encodeCbor } from '../cbor';
import { disposeEpochKey } from '../epoch-key';
import { keyId } from '../identifiers';
import { type LedgerView } from '../ledger';
import { signVerified, type DeviceSigner } from '../signing';
import { verifySignature } from '../signature';
import {
  authenticateEpochEnvelope,
  authenticateEpochEnvelopeSignature,
  openEpochEnvelope,
} from './envelope';
import { commitEpochKey } from './history';
import { openEpochKeyHpke } from '../crypto/hpke';
import type { NativeEpochProtector } from './host-protection';
import { makeSqliteProtectedEpochKeys } from './protected-sqlite';
import * as Reports from './reports';
import {
  authenticateEpochStagedGroup,
  ownEpochStagedGroup,
  type EpochStagedGroup,
} from './staging';

export class ReceiveError extends Data.TaggedError('ReceiveError')<{
  readonly code:
    | 'invalid-input'
    | 'closed'
    | 'storage'
    | 'corrupt'
    | 'rollback'
    | 'context-changed'
    | 'missing-task';
}> {}
const fail = (code: ReceiveError['code']) => new ReceiveError({ code });
const sql = <A>(work: () => A) =>
  Effect.try({
    try: work,
    catch: (error) => (error instanceof ReceiveError ? error : fail('storage')),
  });
export interface ReceiveMailboxRemote {
  readonly status: (
    slot: Reports.MailboxSlot
  ) => Effect.Effect<
    Reports.MailboxSlot & { readonly revision: number; readonly status: string },
    unknown
  >;
  readonly report: (report: Uint8Array, publication?: Uint8Array) => Effect.Effect<void, unknown>;
}
interface Task {
  readonly id: string;
  readonly body: Uint8Array;
  readonly context: Reports.InstallationContext;
  readonly frame: Uint8Array | null;
  readonly publication: Uint8Array | null;
  readonly report: Uint8Array | null;
  readonly phase: 'Install' | 'Report' | 'Reported' | 'Obsolete' | 'Revoked';
}
const APP = 0x4c455231;
const bounded = (value: unknown, max: number): value is Uint8Array =>
  value instanceof Uint8Array && value.length > 0 && value.length <= max;
const pageLimit = (limit: number) => Number.isInteger(limit) && limit >= 1 && limit <= 100;
/** Finite host-owned recipient workflow. Initializes native protection once; no per-receive key-store callbacks.
 * Key store and task journal are independent: verified source -> key save/reload -> signed original queue.
 * A signed report remains a claim, and Reported records the remote ACK, not server/native custody proof. */
export function makeSqliteEpochReceiver(input: {
  readonly path: string;
  readonly mode: 'create' | 'open';
  readonly genesis: Bytes.GenesisHash;
  readonly signer: DeviceSigner;
  readonly pair: CryptoKeyPair;
  readonly keyStore: {
    readonly path: string;
    readonly mode: 'create' | 'open';
    readonly protector: NativeEpochProtector;
  };
  readonly ledger: () => Effect.Effect<LedgerView, unknown>;
  readonly remote: ReceiveMailboxRemote;
}) {
  return Effect.gen(function* () {
    const { path, mode } = input,
      lookup = input.ledger;
    const signer = Object.freeze({
      publicKey: Result.getOrThrow(Bytes.signingPublicKey(input.signer.publicKey.toBytes())),
      sign: input.signer.sign.bind(input.signer),
    });
    const pair = { publicKey: input.pair.publicKey, privateKey: input.pair.privateKey };
    const anchor = yield* Effect.fromResult(Bytes.genesisHash(input.genesis.toBytes()));
    const self = keyId(signer.publicKey.toBytes()),
      org = keyId(anchor.toBytes());
    const status = input.remote.status.bind(input.remote),
      reportRemote = input.remote.report.bind(input.remote);
    const native = input.keyStore.protector;
    const keyConfig = {
      path: input.keyStore.path,
      mode: input.keyStore.mode,
      protector: Object.freeze({
        protect: native.protect.bind(native),
        unprotect: native.unprotect.bind(native),
      }),
    };
    if (
      typeof path !== 'string' ||
      !isAbsolute(path) ||
      (mode !== 'create' && mode !== 'open') ||
      path === keyConfig.path
    )
      return yield* fail('invalid-input');
    const db = yield* openSqliteStore({
      path,
      mode,
      applicationId: APP,
      version: 2,
      initialize(connection) {
        connection.exec(`CREATE TABLE receive_meta(id INTEGER PRIMARY KEY CHECK(id=1),genesis TEXT NOT NULL,recipient TEXT NOT NULL,head BLOB,count INTEGER);
        CREATE TABLE receive_tasks(id TEXT PRIMARY KEY,body BLOB NOT NULL CHECK(length(body) BETWEEN 1 AND 256),frame BLOB CHECK(length(frame) BETWEEN 1 AND 512),publication BLOB CHECK(length(publication) BETWEEN 1 AND 8192),report BLOB CHECK(length(report) BETWEEN 1 AND 512),phase TEXT NOT NULL CHECK(phase IN ('Install','Report','Reported','Obsolete','Revoked')),consumed INTEGER NOT NULL DEFAULT 0 CHECK(consumed IN (0,1)));
        CREATE INDEX receive_pending ON receive_tasks(phase,id);
        `);
        connection
          .prepare('INSERT INTO receive_meta(id,genesis,recipient) VALUES(1,?,?)')
          .run(org, self);
      },
      validate(connection) {
        const meta = connection
          .prepare('SELECT genesis,recipient FROM receive_meta WHERE id=1')
          .get() as { genesis?: unknown; recipient?: unknown; sender?: unknown } | undefined;
        if (meta?.genesis !== org || meta?.recipient !== self) throw fail('corrupt');
      },
      error: fail,
    });
    let closed = false;
    const guard = () => {
      if (closed) throw fail('closed');
    };

    const observePin = makeSqliteLedgerPin({
      db,
      table: 'receive_meta',
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
    const keys = yield* makeSqliteProtectedEpochKeys({
      ...keyConfig,
      genesis: anchor,
      recipient: signer.publicKey,
      ledger: current,
    });
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        closed = true;
      })
    );
    const parse = (row: Record<string, unknown>): Task => {
      if (
        !Reports.isHash(row.id) ||
        !bounded(row.body, 256) ||
        !['Install', 'Report', 'Reported', 'Obsolete', 'Revoked'].includes(String(row.phase))
      )
        throw fail('corrupt');
      const body = new Uint8Array(row.body);
      // Decode untrusted canonical context only; the placeholder is never used as signature evidence.
      const decoded = Result.getOrThrow(
        Reports.decodeInstallationReport(Result.getOrThrow(encodeCbor([body, new Uint8Array(64)])))
      );
      const context = decoded.context;
      if (
        context.genesis !== org ||
        context.recipient !== self ||
        Reports.mailboxDigest(body) !== row.id
      )
        throw fail('corrupt');
      const frame =
        row.frame === null ? null : bounded(row.frame, 512) ? new Uint8Array(row.frame) : null;
      const publication =
        row.publication === null
          ? null
          : bounded(row.publication, 8192)
            ? new Uint8Array(row.publication)
            : null;
      const signed =
        row.report === null ? null : bounded(row.report, 512) ? new Uint8Array(row.report) : null;
      if (
        context.source._tag === 'Envelope'
          ? !frame ||
            publication !== null ||
            Reports.mailboxDigest(frame) !== context.source.frameDigest
          : frame !== null ||
            !publication ||
            keyId(ReportsHash(publication)) !== context.source.recordHash
      )
        throw fail('corrupt');
      if ((row.phase === 'Report' || row.phase === 'Reported') && !signed) throw fail('corrupt');
      if (row.phase === 'Install' && signed) throw fail('corrupt');
      return {
        id: row.id,
        body,
        context,
        frame,
        publication,
        report: signed,
        phase: row.phase as Task['phase'],
      };
    };
    const select =
      'SELECT id,CASE WHEN length(body)<=256 THEN body ELSE NULL END AS body,CASE WHEN length(frame)<=512 THEN frame ELSE NULL END AS frame,CASE WHEN length(publication)<=8192 THEN publication ELSE NULL END AS publication,CASE WHEN length(report)<=512 THEN report ELSE NULL END AS report,phase FROM receive_tasks';
    const load = (id: string) =>
      sql(() => {
        guard();
        if (!Reports.isHash(id)) throw fail('invalid-input');
        const row = db.prepare(select + ' WHERE id=?').get(id) as
          | Record<string, unknown>
          | undefined;
        if (!row) throw fail('missing-task');
        return parse(row);
      });
    const revision = (context: Reports.InstallationContext) =>
      Effect.gen(function* () {
        const target = { genesis: org, epoch: context.epoch, recipient: self };
        yield* sql(guard);
        const hint = yield* status(target);
        yield* sql(guard);
        if (
          hint.genesis !== org ||
          hint.recipient !== self ||
          hint.epoch !== context.epoch ||
          !Number.isSafeInteger(hint.revision) ||
          hint.revision < 0 ||
          hint.revision !== context.revision
        )
          return yield* fail('context-changed');
        return undefined;
      });
    const saveOriginal = (
      context: Reports.InstallationContext,
      frame: Uint8Array | null,
      publication: Uint8Array | null
    ) =>
      Effect.gen(function* () {
        const body = yield* Effect.fromResult(Reports.installationBody(context)),
          id = Reports.mailboxDigest(body);
        yield* sql(() => {
          guard();
          db.prepare(
            'INSERT INTO receive_tasks(id,body,frame,publication,phase) VALUES(?,?,?,?,?) ON CONFLICT(id) DO NOTHING'
          ).run(id, body, frame, publication, 'Install');
        });
        const original = yield* load(id);
        if (
          !bytesEqual(original.body, body) ||
          !sameNullable(original.frame, frame) ||
          !sameNullable(original.publication, publication)
        )
          return yield* fail('corrupt');
        return id;
      });
    const check = (task: Task) =>
      Effect.gen(function* () {
        const view = yield* current();
        yield* Effect.fromResult(Reports.checkInstallationContext(view, task.context));
        yield* revision(task.context);
        return view;
      });
    const finishInstallation = (id: string) =>
      Effect.gen(function* () {
        const task = yield* load(id);
        if (task.phase === 'Revoked' || task.phase === 'Obsolete')
          return yield* fail('context-changed');
        if (task.phase === 'Report' || task.phase === 'Reported') {
          const existingView = yield* check(task);
          if (!task.report) return yield* fail('corrupt');
          const signedContext = yield* Effect.fromResult(
            Reports.authenticateInstallationReport({
              view: existingView,
              genesis: anchor,
              authenticatedRecipient: signer.publicKey,
              report: task.report,
            })
          );
          if (
            !bytesEqual(
              yield* Effect.fromResult(Reports.installationBody(signedContext)),
              task.body
            )
          )
            return yield* fail('corrupt');
          yield* Effect.acquireUseRelease(
            keys.read(task.context.epoch),
            () => Effect.void,
            (key) => Effect.sync(() => disposeEpochKey(key))
          );
          return undefined;
        }
        const view = yield* check(task);
        if (task.frame && task.context.source._tag === 'Envelope') {
          const sender = yield* Effect.fromResult(
            Bytes.signingPublicKey(Reports.fromHex(task.context.source.sender))
          );
          const context = {
            genesis: anchor,
            epoch: yield* Effect.fromResult(Bytes.epochNumber(task.context.epoch)),
            sender,
            recipient: signer.publicKey,
          };
          // Install is pending work, not evidence that this ciphertext has been opened.
          yield* Effect.acquireUseRelease(
            openEpochEnvelope({ context, pair, frame: task.frame, ledger: current }),
            (key) => keys.saveAndReload(task.context.epoch, key),
            (key) => Effect.sync(() => disposeEpochKey(key))
          );
        } else if (task.publication)
          yield* Effect.fromResult(
            Reports.checkLocalPublication(view, task.context, task.publication)
          );
        else return yield* fail('corrupt');
        yield* Effect.acquireUseRelease(
          keys.read(task.context.epoch),
          (key) =>
            Effect.gen(function* () {
              const digest = yield* Effect.fromResult(
                commitEpochKey(anchor, task.context.epoch, key)
              );
              if (keyId(digest.toBytes()) !== task.context.commitment)
                return yield* fail('corrupt');
              return undefined;
            }),
          (key) => Effect.sync(() => disposeEpochKey(key))
        );
        yield* check(task);
        const signed = yield* signVerified(signer, Reports.installationSigningBytes(task.body));
        const bytes = yield* Effect.fromResult(
          Reports.encodeInstallationReport(task.context, signed.toBytes())
        );
        const latest = yield* check(task);
        yield* Effect.fromResult(
          Reports.authenticateInstallationReport({
            view: latest,
            genesis: anchor,
            authenticatedRecipient: signer.publicKey,
            report: bytes,
          })
        );
        yield* sql(() => {
          guard();
          const changed = db
            .prepare(
              "UPDATE receive_tasks SET report=?,phase='Report' WHERE id=? AND phase='Install' AND report IS NULL"
            )
            .run(bytes, id);
          if (changed.changes !== 1) throw fail('corrupt');
          const queued = parse(
            db.prepare(select + ' WHERE id=?').get(id) as Record<string, unknown>
          );
          if (queued.phase !== 'Report' || !queued.report || !bytesEqual(queued.report, bytes))
            throw fail('corrupt');
        });
        return undefined;
      });
    const flush = (id: string) =>
      Effect.gen(function* () {
        const task = yield* load(id);
        if (task.phase === 'Reported') return undefined;
        if (task.phase !== 'Report' || !task.report) return yield* fail('corrupt');
        const view = yield* check(task);
        const decoded = yield* Effect.fromResult(
          Reports.authenticateInstallationReport({
            view,
            genesis: anchor,
            authenticatedRecipient: signer.publicKey,
            report: task.report,
          })
        );
        const body = yield* Effect.fromResult(Reports.installationBody(decoded));
        if (!bytesEqual(body, task.body)) return yield* fail('corrupt');
        if (task.publication)
          yield* Effect.fromResult(
            Reports.checkLocalPublication(view, task.context, task.publication)
          );
        // Reload current protected possession even when retrying an already signed claim; never re-sign.
        yield* Effect.acquireUseRelease(
          keys.read(task.context.epoch),
          () => Effect.void,
          (key) => Effect.sync(() => disposeEpochKey(key))
        );
        yield* check(task);
        yield* sql(guard);
        yield* reportRemote(
          new Uint8Array(task.report),
          task.publication ? new Uint8Array(task.publication) : undefined
        );
        yield* sql(() => {
          guard();
          db.prepare(
            "UPDATE receive_tasks SET phase='Reported',consumed=0 WHERE id=? AND phase='Report'"
          ).run(id);
        });
        return undefined;
      });
    const disposition = (id: string) =>
      Effect.gen(function* () {
        const task = yield* load(id),
          view = yield* current(),
          state = view.inspectState();
        const phase =
          state.epoch.number !== task.context.epoch
            ? 'Obsolete'
            : !state.devices.has(self)
              ? 'Revoked'
              : null;
        if (phase)
          yield* sql(() => {
            guard();
            db.prepare(
              "UPDATE receive_tasks SET phase=?,consumed=0 WHERE id=? AND phase IN ('Install','Report')"
            ).run(phase, id);
          });
        return phase;
      });
    const pendingPage = (kind: 'install' | 'report', limit: number, cursor: string | null) =>
      sql(() => {
        guard();
        if (!pageLimit(limit) || (cursor !== null && !Reports.isHash(cursor)))
          throw fail('invalid-input');
        // Only ID metadata has a lookahead. No context/frame/report payload is loaded here.
        const predicate = kind === 'install' ? "phase='Install'" : "phase='Report'";
        const ids = db
          .prepare(`SELECT id FROM receive_tasks WHERE ${predicate} AND id>? ORDER BY id LIMIT ?`)
          .all(cursor ?? '', limit + 1) as { id: string }[];
        return { ids: ids.slice(0, limit), next: ids.length > limit ? ids[limit - 1]!.id : null };
      });
    const batch = (kind: 'install' | 'report', limit: number, cursor: string | null) =>
      Effect.gen(function* () {
        const page = yield* pendingPage(kind, limit, cursor),
          blocked: string[] = [];
        for (const row of page.ids) {
          const result = yield* Effect.result(
            kind === 'install' ? finishInstallation(row.id) : flush(row.id)
          );
          if (Result.isFailure(result)) {
            const ended = yield* Effect.result(disposition(row.id));
            if (Result.isFailure(ended) || !ended.success) blocked.push(row.id);
          }
        }
        yield* sql(guard);
        return { processed: page.ids.length, blocked, next: page.next };
      });
    return Object.freeze({
      /** Borrowed opaque-key capability; the receiver Scope retains sole ownership. */
      installedEpochKeys: keys,
      /** Genuine public observation only; persists the known prefix, grants no eligibility. */
      observeLedger: current,
      /** Remote staged rows remain inert until their exact tag7/8 is genuinely committed.
       * This installs through the same owned protected store; ordinary late-join
       * delivery/report tasks remain on receive(). Retry reads the original group. */
      receiveStagedGroup: (inputGroup: EpochStagedGroup) =>
        Effect.gen(function* () {
          const original = yield* Effect.fromResult(ownEpochStagedGroup(inputGroup));
          const view = yield* current();
          const { sender } = yield* Effect.fromResult(authenticateEpochStagedGroup(view, original));
          const own = original.envelopes.find((row) => row.recipient === self);
          if (!own) return yield* fail('missing-task');
          const context = {
            genesis: anchor,
            epoch: yield* Effect.fromResult(Bytes.epochNumber(original.epoch)),
            sender,
            recipient: signer.publicKey,
          };
          const recipient = view.inspectState().devices.get(self);
          if (
            !recipient ||
            !view.inspectState().members.has(keyId(recipient.membershipId.toBytes()))
          )
            return yield* fail('context-changed');
          const sealed = yield* Effect.fromResult(
            authenticateEpochEnvelopeSignature(context, own.frame)
          );
          yield* Effect.acquireUseRelease(
            openEpochKeyHpke(pair, recipient.encryptionPublicKey, context, sealed),
            (key) =>
              Effect.gen(function* () {
                const commitment = yield* Effect.fromResult(
                  commitEpochKey(anchor, original.epoch, key)
                );
                if (keyId(commitment.toBytes()) !== original.commitment)
                  return yield* fail('corrupt');
                const after = yield* current();
                yield* Effect.fromResult(authenticateEpochStagedGroup(after, original));
                const activeRecipient = after.inspectState().devices.get(self);
                if (
                  !activeRecipient ||
                  !after
                    .inspectState()
                    .members.has(keyId(activeRecipient.membershipId.toBytes())) ||
                  !activeRecipient.encryptionPublicKey.equals(recipient.encryptionPublicKey)
                )
                  return yield* fail('context-changed');
                return yield* keys.saveAndReload(original.epoch, key);
              }),
            (key) => Effect.sync(() => disposeEpochKey(key))
          );
          return {
            outcome: 'Installed' as const,
            epoch: original.epoch,
            recordHash: original.recordHash,
          };
        }),
      receive: (senderInput: Bytes.SigningPublicKey, inputFrame: Uint8Array) =>
        Effect.suspend(() =>
          Effect.gen(function* () {
            if (!bounded(inputFrame, 512)) return yield* fail('invalid-input');
            const frame = new Uint8Array(inputFrame);
            const sender = yield* Effect.fromResult(Bytes.signingPublicKey(senderInput.toBytes()));
            const view = yield* current(),
              epoch = view.inspectState().epoch.number;
            const context = {
              genesis: anchor,
              epoch: yield* Effect.fromResult(Bytes.epochNumber(epoch)),
              sender,
              recipient: signer.publicKey,
            };
            yield* Effect.fromResult(authenticateEpochEnvelope(view, context, frame));
            const target = { genesis: org, epoch, recipient: self },
              hint = yield* status(target);
            yield* sql(guard);
            const install: Reports.InstallationContext = {
              ...target,
              commitment: keyId(view.inspectState().epoch.keyCommitment.toBytes()),
              revision: hint.revision,
              source: {
                _tag: 'Envelope',
                sender: keyId(sender.toBytes()),
                frameDigest: Reports.mailboxDigest(frame),
              },
            };
            if (hint.genesis !== org || hint.epoch !== epoch || hint.recipient !== self)
              return yield* fail('context-changed');
            yield* Effect.fromResult(Reports.checkInstallationContext(yield* current(), install));
            const id = yield* saveOriginal(install, frame, null);
            yield* finishInstallation(id);
            return { id, outcome: 'Installed' as const };
          })
        ),
      recordLocalInstallation: (inputRecord: Uint8Array) =>
        Effect.suspend(() =>
          Effect.gen(function* () {
            if (!bounded(inputRecord, 8192)) return yield* fail('invalid-input');
            const record = new Uint8Array(inputRecord);
            const view = yield* current(),
              epoch = view.inspectState().epoch.number,
              target = { genesis: org, epoch, recipient: self },
              hint = yield* status(target);
            yield* sql(guard);
            const context: Reports.InstallationContext = {
              ...target,
              commitment: keyId(view.inspectState().epoch.keyCommitment.toBytes()),
              revision: hint.revision,
              source: { _tag: 'LocalPublication', recordHash: keyId(ReportsHash(record)) },
            };
            if (hint.genesis !== org || hint.epoch !== epoch || hint.recipient !== self)
              return yield* fail('context-changed');
            yield* Effect.fromResult(Reports.checkLocalPublication(view, context, record));
            const id = yield* saveOriginal(context, null, record);
            yield* finishInstallation(id);
            return { id, outcome: 'Installed' as const };
          })
        ),
      resume: (limit = 100, cursor: string | null = null) => batch('install', limit, cursor),
      flushReports: (limit = 100, cursor: string | null = null) => batch('report', limit, cursor),
      results: (limit = 100) =>
        sql(() => {
          guard();
          if (!pageLimit(limit)) throw fail('invalid-input');
          const data = db
            .prepare(
              select +
                " WHERE phase IN ('Reported','Obsolete','Revoked') AND consumed=0 ORDER BY id LIMIT ?"
            )
            .all(limit) as Record<string, unknown>[];
          return data.map((row) => {
            const task = parse(row);
            if (task.phase === 'Reported') {
              if (!task.report) throw fail('corrupt');
              const signed = Result.getOrThrow(Reports.decodeInstallationReport(task.report));
              if (
                !bytesEqual(Result.getOrThrow(Reports.installationBody(signed.context)), task.body)
              )
                throw fail('corrupt');
              Result.getOrThrow(
                verifySignature(
                  signer.publicKey.toBytes(),
                  signed.message,
                  signed.signature.toBytes()
                )
              );
            }
            return { id: task.id, outcome: task.phase as 'Reported' | 'Obsolete' | 'Revoked' };
          });
        }),
      acknowledge: (id: string) =>
        sql(() => {
          guard();
          if (!Reports.isHash(id)) throw fail('invalid-input');
          db.prepare(
            "UPDATE receive_tasks SET consumed=1 WHERE id=? AND phase IN ('Reported','Obsolete','Revoked')"
          ).run(id);
        }),
    });
  });
}
import { hashRecordBytes } from '../ledger';
function ReportsHash(bytes: Uint8Array) {
  return hashRecordBytes(bytes).toBytes();
}
function sameNullable(a: Uint8Array | null, b: Uint8Array | null) {
  return a === null ? b === null : b !== null && bytesEqual(a, b);
}
