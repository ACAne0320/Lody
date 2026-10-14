import { Cause, Data, Effect } from 'effect';
import * as Bytes from '../bytes';
import { keyId } from '../identifiers';
import { isHash, fromHex, mailboxDigest } from './reports';
import { makeSqliteEpochReceiver, type ReceiveMailboxRemote } from './receive-sqlite';
import { makeSqliteMailboxRepair } from './repair-sqlite';
export class MailboxClientError extends Data.TaggedError('MailboxClientError')<{
  readonly code: 'invalid-page' | 'closed' | 'rollback' | 'unauthorized';
}> {}
/** Identifies the owned failed envelope; not permission to reject it or advance a cursor.
 * The cause distinguishes crypto rejection from retryable local storage/native failures. */
export class MailboxInstallError extends Data.TaggedError('MailboxInstallError')<{
  readonly genesis: string;
  readonly epoch: number;
  readonly recipient: string;
  readonly sender: string;
  readonly frameDigest: string;
  readonly cause: unknown;
}> {}
const fail = (code: MailboxClientError['code']) => new MailboxClientError({ code });
export interface RecipientMailboxRemote extends ReceiveMailboxRemote {
  readonly fetch: (
    epoch: number,
    cursor: string | null,
    limit: number
  ) => Effect.Effect<
    {
      readonly items: readonly { readonly sender: string; readonly frame: Uint8Array }[];
      readonly next: string | null;
    },
    unknown
  >;
  readonly repair: Parameters<typeof makeSqliteMailboxRepair>[0]['remote']['repair'];
}
/** Real receiver/repair composition, not an arbitrary successful install callback.
 * Returned pagination is a caller hint; no document or transport cursor is saved. */
export function makeSqliteRecipientMailbox(
  input: Omit<Parameters<typeof makeSqliteEpochReceiver>[0], 'remote'> & {
    readonly remote: RecipientMailboxRemote;
    readonly repairStore: { readonly path: string; readonly mode: 'create' | 'open' };
  }
) {
  return Effect.gen(function* () {
    const lookup = input.ledger,
      fetch = input.remote.fetch.bind(input.remote);
    const remote = Object.freeze({
      status: input.remote.status.bind(input.remote),
      report: input.remote.report.bind(input.remote),
      repair: input.remote.repair.bind(input.remote),
    });
    const signer = Object.freeze({
      publicKey: yield* Effect.fromResult(Bytes.signingPublicKey(input.signer.publicKey.toBytes())),
      sign: input.signer.sign.bind(input.signer),
    });
    const repairConfig = { ...input.repairStore };
    const anchor = yield* Effect.fromResult(Bytes.genesisHash(input.genesis.toBytes()));
    // Receiver captures/protects actual borrowed native handles and original source gates.
    const receiver = yield* makeSqliteEpochReceiver({
      ...input,
      genesis: anchor,
      signer,
      ledger: lookup,
      remote,
    });
    const repairs = yield* makeSqliteMailboxRepair({
      ...repairConfig,
      genesis: anchor,
      recipient: signer.publicKey,
      ledger: receiver.observeLedger,
      remote,
    });
    let closed = false;
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        closed = true;
      })
    );
    const current = () =>
      Effect.gen(function* () {
        if (closed) return yield* fail('closed');
        // The actual receiver durably observes genuine prefixes before eligibility.
        // Receive/protection and repair therefore share the same rollback boundary.
        const view = yield* receiver.observeLedger();
        if (closed) return yield* fail('closed');
        const state = view.inspectState(),
          device = state.devices.get(keyId(signer.publicKey.toBytes()));
        if (!device || !state.members.has(keyId(device.membershipId.toBytes())))
          return yield* fail('unauthorized');
        return view;
      });
    return Object.freeze({
      installedEpochKeys: receiver.installedEpochKeys,
      observeLedger: receiver.observeLedger,
      receive: receiver.receive,
      recordLocalInstallation: receiver.recordLocalInstallation,
      resume: receiver.resume,
      flushReports: receiver.flushReports,
      results: receiver.results,
      acknowledge: receiver.acknowledge,
      enqueueRepair: repairs.enqueue,
      flushRepairs: repairs.flush,
      repairResults: repairs.results,
      acknowledgeRepair: repairs.acknowledge,
      fetchAndInstall: (cursor: string | null = null, limit = 100) =>
        Effect.gen(function* () {
          if (
            !Number.isInteger(limit) ||
            limit < 1 ||
            limit > 100 ||
            (cursor !== null &&
              (typeof cursor !== 'string' || cursor.length < 1 || cursor.length > 1024))
          )
            return yield* fail('invalid-page');
          const view = yield* current(),
            epoch = view.inspectState().epoch.number;
          const page = yield* fetch(epoch, cursor, limit);
          if (closed) return yield* fail('closed');
          const rows = page?.items;
          if (!page || !Array.isArray(rows)) return yield* fail('invalid-page');
          const count = rows.length,
            next = page.next;
          if (
            !Number.isInteger(count) ||
            count < 0 ||
            count > limit ||
            (next !== null &&
              (typeof next !== 'string' ||
                next.length < 1 ||
                next.length > 1024 ||
                next === cursor))
          )
            return yield* fail('invalid-page');
          if (count === 0 && next !== null) return yield* fail('invalid-page');
          const items: { sender: Bytes.SigningPublicKey; frame: Uint8Array }[] = [];
          for (let index = 0; index < count; index++) {
            const row = rows[index];
            if (!row) return yield* fail('invalid-page');
            const sender = row.sender,
              frame = row.frame;
            if (
              !isHash(sender) ||
              !(frame instanceof Uint8Array) ||
              frame.length < 1 ||
              frame.length > 512
            )
              return yield* fail('invalid-page');
            items.push({
              sender: yield* Effect.fromResult(Bytes.signingPublicKey(fromHex(sender))),
              frame: new Uint8Array(frame),
            });
          }
          if (rows.length !== count) return yield* fail('invalid-page');
          const latest = yield* current();
          if (latest.inspectState().epoch.number !== epoch) return yield* fail('rollback');
          for (const row of items) {
            const frameDigest = mailboxDigest(row.frame);
            yield* receiver.receive(row.sender, row.frame).pipe(
              Effect.catchCause((failure) =>
                Effect.failCause(
                  Cause.map(
                    failure,
                    (cause) =>
                      new MailboxInstallError({
                        genesis: keyId(anchor.toBytes()),
                        epoch,
                        recipient: keyId(signer.publicKey.toBytes()),
                        sender: keyId(row.sender.toBytes()),
                        frameDigest,
                        cause,
                      })
                  )
                )
              )
            );
          }
          // Preserve the source failure contract: no page-next result after any install failure.
          return { processed: items.length, next };
        }),
    });
  });
}
