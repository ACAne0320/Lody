import { appendFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
// Application entrypoint: one Effect Scope owns the complete synthetic session.
import { Cause, Effect, Queue, Result, Schema } from 'effect';
import { join, isAbsolute } from 'node:path';
import type { SubmissionResult } from '@lody/e2ee-core/submission';
import { Bytes } from '@lody/e2ee-core';
import { importDevice } from './device';
import { openLabWorkspaceSession } from './full-session';
import { labSyntheticProtector } from './synthetic-protection';
import { LabKeyCommand, type LabProcessConfiguration } from './process-contract';
const ok = Result.getOrThrow;
const FailureIdentity = Schema.Struct({ _tag: Schema.String, code: Schema.String });
const StreamRefusal = Schema.Struct({
  code: Schema.Literals(['forbidden', 'unauthorized']),
  status: Schema.Literals([401, 403]),
});
// Do not flatten defects, interruption or multiple causes into an expected refusal.
const projectFailure = (cause: Cause.Cause<unknown>, droppedAck: boolean) => {
  const reason = cause.reasons[0];
  if (cause.reasons.length !== 1 || !reason || !Cause.isFailReason(reason))
    return { tag: 'LabHarnessError', code: 'non-domain-failure' };
  const submission = Schema.decodeUnknownResult(
    Schema.Struct({ _tag: Schema.Literal('SubmissionRemoteError') })
  )(reason.error);
  if (Result.isSuccess(submission))
    return droppedAck
      ? { tag: 'LabTransportFault', code: 'dropped-committed-ack' }
      : { tag: 'SubmissionRemoteError', code: 'failed' };
  const decoded = Schema.decodeUnknownResult(FailureIdentity)(reason.error);
  if (Result.isFailure(decoded))
    return { tag: 'LabHarnessError', code: 'invalid-input-or-untyped-failure' };
  const error = decoded.success;
  if (error._tag === 'LedgerFeedError' && error.code === 'transport') {
    const native = Schema.decodeUnknownResult(Schema.Struct({ cause: StreamRefusal }))(
      reason.error
    );
    if (Result.isSuccess(native)) return { tag: error._tag, code: native.success.cause.code };
  }
  return { tag: error._tag, code: error.code };
};
const hash = (value: string) => {
  if (!/^[0-9a-f]{64}$/.test(value)) throw new Error('fixture-hash');
  return new Uint8Array(Buffer.from(value, 'hex'));
};
const program = Effect.scoped(
  Effect.gen(function* () {
    const queue = yield* Queue.unbounded<Record<string, unknown>>();
    const listener = (message: unknown) => {
      if (
        message &&
        typeof message === 'object' &&
        !Array.isArray(message) &&
        JSON.stringify(message).length <= 256 * 1024
      )
        Queue.offerUnsafe(queue, message as Record<string, unknown>);
    };
    const disconnected = () => Queue.shutdownUnsafe(queue);
    yield* Effect.acquireRelease(
      Effect.sync(() => {
        process.on('message', listener);
        process.once('disconnect', disconnected);
      }),
      () =>
        Effect.sync(() => {
          process.off('message', listener);
          process.off('disconnect', disconnected);
        })
    );
    let session: Effect.Success<ReturnType<typeof openLabWorkspaceSession>> | undefined;
    let point: { head: Bytes.RecordHash; length: number } | undefined;
    let ending = false;
    let fault: 'none' | 'corrupt-loro' | 'drop-control-ack' = 'none';
    let directory = '',
      actor = '',
      peerSigningKey = '';
    let lastResult: SubmissionResult | null = null,
      logicalTime = 0;
    let traceFrames = 0,
      traceBytes = 0,
      cipherChanged = 0,
      ackDropped = 0;
    const nativeFetch: typeof fetch = async (input, init) => {
      const request = new Request(input, init),
        url = new URL(request.url),
        method = request.method;
      const selected = url.pathname.includes('/ds/') || url.pathname.endsWith('/key-mailbox');
      const requestBytes = selected
        ? new Uint8Array(await request.clone().arrayBuffer())
        : undefined;
      const response = await fetch(request);
      if (!selected) return response; // credentials/tokens are never recorded
      const original = new Uint8Array(await response.arrayBuffer()),
        bytes = new Uint8Array(original);
      let changed = false,
        dropped = false;
      if (
        fault === 'drop-control-ack' &&
        method === 'POST' &&
        url.pathname.endsWith('/control/append-cas') &&
        response.ok
      ) {
        fault = 'none';
        ackDropped++;
        dropped = true;
      }
      if (
        fault === 'corrupt-loro' &&
        method === 'GET' &&
        url.pathname.includes('/loro') &&
        response.ok
      ) {
        for (let i = 0; i + 75 < bytes.length; i++)
          if (
            bytes[i] === 76 &&
            bytes[i + 1] === 83 &&
            bytes[i + 2] === 67 &&
            bytes[i + 3] === 69 &&
            bytes[i + 10] === 3
          ) {
            bytes[i + 74] = bytes[i + 74]! ^ 1;
            cipherChanged++;
            changed = true;
            break;
          }
      }
      traceBytes += (requestBytes?.length ?? 0) + original.length + bytes.length;
      if (++traceFrames > 1024 || traceBytes > 16 * 1024 * 1024)
        throw new Error('Lab trace budget');
      appendFileSync(
        join(directory, `${actor}-transport.jsonl`),
        JSON.stringify({
          method,
          path: url.pathname,
          status: response.status,
          requestHex: Buffer.from(requestBytes!).toString('hex'),
          originalHex: Buffer.from(original).toString('hex'),
          deliveredHex: Buffer.from(bytes).toString('hex'),
          changed,
          dropped,
          contentType: response.headers.get('content-type'),
          nextOffset: response.headers.get('stream-next-offset'),
        }) + '\n',
        { mode: 0o600 }
      );
      if (dropped) throw new Error('Lab dropped committed ACK');
      return new Response(
        method === 'HEAD' || [204, 205, 304].includes(response.status) ? null : bytes,
        { status: response.status, headers: response.headers }
      );
    };
    const handle = Effect.fnUntraced(function* (command: Record<string, unknown>) {
      if (
        typeof command.logicalTime !== 'number' ||
        !Number.isSafeInteger(command.logicalTime) ||
        command.logicalTime < 0
      )
        return yield* Effect.fail(new Error('fixture-clock'));
      logicalTime = Math.max(logicalTime, command.logicalTime);
      if (command.operation === 'open') {
        if (session) return yield* Effect.fail(new Error('already-started'));
        const c = command.configuration as LabProcessConfiguration;
        if (
          c.syntheticOnly !== true ||
          !isAbsolute(c.directory) ||
          !['owner', 'peer'].includes(c.actor) ||
          !['create', 'open'].includes(c.mode)
        )
          return yield* Effect.fail(new Error('fixture-configuration'));
        directory = c.directory;
        actor = c.actor;
        peerSigningKey = c.peerSigningKey;
        const device = yield* importDevice(c.device),
          genesis = ok(Bytes.genesisHash(hash(c.genesis)));
        point = { head: ok(Bytes.recordHash(hash(c.point.head))), length: c.point.length };
        const file = (name: string) => join(c.directory, `${c.actor}-${name}.sqlite`);

        session = yield* openLabWorkspaceSession({
          baseUrl: c.baseUrl,
          genesis,
          signer: device,
          path: file('feed'),
          journalPath: file('journal'),
          mode: c.mode,
          expected:
            c.mode === 'open'
              ? {
                  head: ok(Bytes.recordHash(hash((c.localPoint ?? c.point).head))),
                  length: (c.localPoint ?? c.point).length,
                }
              : undefined,
          checkpoint: () => Effect.succeed(point!),
          fetch: nativeFetch,
          budget: { maxRecords: 100, maxBytes: 1024 * 1024 },
          keys: {
            path: file('receive'),
            mode: c.mode,
            pair: device.encryption,
            keyStore: {
              path: file('keys'),
              mode: c.actor === 'owner' ? 'open' : c.mode,
              protector: labSyntheticProtector,
            },
            repairStore: { path: file('repair'), mode: c.mode },
            sendStore: { path: file('send'), mode: c.mode },
            outboxStore: { path: file('outbox'), mode: c.mode },
            currentPublication: () =>
              Effect.succeed(new Uint8Array(Buffer.from(c.records[0]!, 'hex'))),
          },
          documents: [
            {
              id: 'loro',
              resource: 'document-A',
              path: file('loro'),
              mode: c.mode,
              streamUrl: `${c.baseUrl}/ds/${c.genesis}/loro`,
            },
            {
              id: 'flock',
              model: 'flock',
              now: () => ++logicalTime,
              resource: 'document-B',
              path: file('flock'),
              mode: c.mode,
              streamUrl: `${c.baseUrl}/ds/${c.genesis}/flock`,
            },
          ],
        });
        return { pid: process.pid };
      }
      if (!session) return yield* Effect.fail(new Error('not-started'));
      if (command.point) {
        const p = command.point as { head: string; length: number };
        point = { head: ok(Bytes.recordHash(hash(p.head))), length: p.length };
      }
      const doc = command.document;
      if (
        ['create', 'append', 'pull', 'recover', 'persist', 'observe'].includes(
          String(command.operation)
        ) &&
        typeof doc !== 'string'
      )
        return yield* Effect.fail(new Error('missing-document'));
      switch (command.operation) {
        case 'keys':
        case 'repair':
        case 'key-results':
        case 'acknowledge-key-result': {
          const key = yield* Effect.fromResult(Schema.decodeUnknownResult(LabKeyCommand)(command));
          switch (key.operation) {
            case 'keys':
              return yield* session.keyRound(key.limit, key.cursors);
            case 'repair':
              return yield* session.enqueueRepair(key.requestId, key.rejectedDigest);
            case 'key-results':
              return {
                receive: yield* session.receiveResults(key.limit),
                repair: yield* session.repairResults(key.limit, key.cursors?.repairResults),
                delivery: yield* session.deliveryResults(key.limit, key.cursors?.deliveryResults),
              };
            case 'acknowledge-key-result':
              yield* key.resultKind === 'repair'
                ? session.acknowledgeRepair(key.resultId)
                : key.resultKind === 'delivery'
                  ? session.acknowledgeDelivery(key.resultId)
                  : session.acknowledgeReceive(key.resultId);
              return null;
          }
        }
        case 'refresh': {
          const value = yield* session.refresh();
          return {
            head: Buffer.from(value.view.head.toBytes()).toString('hex'),
            length: value.view.length,
          };
        }
        case 'resume': {
          lastResult = yield* session.resume();
          return lastResult
            ? {
                outcome: lastResult.outcome,
                recordHex: Buffer.from(lastResult.record).toString('hex'),
              }
            : null;
        }
        case 'revoke-peer':
          lastResult = yield* session.submit({
            _tag: 'RevokeDevice',
            target: ok(Bytes.signingPublicKey(hash(peerSigningKey))),
          });
          return {
            outcome: lastResult.outcome,
            recordHex: Buffer.from(lastResult.record).toString('hex'),
          };
        case 'acknowledge':
          if (!lastResult) return yield* Effect.fail(new Error('missing-original-result'));
          yield* session.acknowledge(lastResult);
          lastResult = null;
          return null;
        case 'create':
          yield* session.createDocument(doc as string);
          return null;
        case 'append':
          if (typeof command.text !== 'string' || command.text.length > 4096)
            return yield* Effect.fail(new Error('invalid-text'));
          yield* session.append(doc as string, command.text);
          return null;
        case 'pull':
          yield* session.pull(doc as string);
          return null;
        case 'recover':
          yield* session.recoverDocument(doc as string);
          return null;
        case 'persist':
          yield* session.persist(doc as string);
          return null;
        case 'observe': {
          const status = yield* session.documentStatus(doc as string);
          const persisted = yield* Effect.acquireUseRelease(
            Effect.sync(
              () =>
                new Database(join(directory, `${actor}-${doc}.sqlite`), {
                  readonly: true,
                  fileMustExist: true,
                })
            ),
            (db) =>
              Effect.sync(() => {
                const row = db
                  .prepare('SELECT document,cursor FROM lab_document_state WHERE id=1')
                  .get() as { document: Uint8Array; cursor: string | null } | undefined;
                return row
                  ? {
                      documentDigest: createHash('sha256').update(row.document).digest('hex'),
                      cursorDigest:
                        row.cursor === null
                          ? null
                          : createHash('sha256').update(row.cursor).digest('hex'),
                    }
                  : null;
              }),
            (db) => Effect.sync(() => db.close())
          );
          return {
            text: status === 'active' ? yield* session.text(doc as string) : undefined,
            cursor: yield* session.cursor(doc as string),
            status,
            persisted,
          };
        }
        case 'attack': {
          switch (doc) {
            case 'clear':
              fault = 'none';
              return null;
            case 'corrupt-loro':
              fault = 'corrupt-loro';
              return null;
            case 'drop-control-ack':
              fault = 'drop-control-ack';
              return null;
            case 'deny-loro-persist':
            case 'restore-loro-persist':
              yield* Effect.acquireUseRelease(
                Effect.sync(
                  () =>
                    new Database(join(directory, `${actor}-loro.sqlite`), { fileMustExist: true })
                ),
                (db) =>
                  Effect.sync(() =>
                    db.exec(
                      doc === 'deny-loro-persist'
                        ? `CREATE TRIGGER lab_deny_insert BEFORE INSERT ON lab_document_state BEGIN SELECT RAISE(ABORT, 'Lab synthetic storage fault'); END; CREATE TRIGGER lab_deny_update BEFORE UPDATE ON lab_document_state BEGIN SELECT RAISE(ABORT, 'Lab synthetic storage fault'); END`
                        : 'DROP TRIGGER IF EXISTS lab_deny_insert; DROP TRIGGER IF EXISTS lab_deny_update'
                    )
                  ),
                (db) => Effect.sync(() => db.close())
              );
              return null;
            default:
              return yield* Effect.fail(new Error('unsupported-attack'));
          }
        }
        case 'close':
          yield* session.close();
          ending = true;
          return null;
        default:
          return yield* Effect.fail(new Error('unsupported-action'));
      }
    });
    while (true) {
      const command = yield* Queue.take(queue);
      const droppedBefore = ackDropped;
      const result = yield* Effect.exit(handle(command));
      const known = session && !ending ? yield* Effect.result(session.current()) : undefined;
      const localPoint =
        known && Result.isSuccess(known)
          ? {
              head: Buffer.from(known.success.view.head.toBytes()).toString('hex'),
              length: known.success.view.length,
            }
          : undefined;
      const response =
        result._tag === 'Success'
          ? {
              id: command.id,
              ok: true,
              value: result.value,
              localPoint,
              trace: { frames: traceFrames, cipherChanged, ackDropped },
            }
          : {
              id: command.id,
              ok: false,
              localPoint,
              trace: { frames: traceFrames, cipherChanged, ackDropped },
              error: projectFailure(result.cause, ackDropped > droppedBefore),
            };
      yield* Effect.uninterruptible(
        Effect.callback<void, Error>((resume) => {
          if (!process.send) return resume(Effect.fail(new Error('ipc-closed')));
          process.send(response, (error) => resume(error ? Effect.fail(error) : Effect.void));
        })
      );
      if (ending) break;
    }
  })
);
const lifecycle = new AbortController();
process.once('disconnect', () => lifecycle.abort());
const exit = await Effect.runPromiseExit(program, { signal: lifecycle.signal });
if (exit._tag === 'Failure') process.exitCode = 1;
if (process.connected) process.disconnect();
