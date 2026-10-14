import { makeInstalledEpochHistory } from '@lody/e2ee-core/keys/host/history';
import { Bytes } from '@lody/e2ee-core';
import { Data, Effect, Exit, Scope, Semaphore } from 'effect';
import type { LedgerCheckpoint } from '@lody/e2ee-core/ledger';
import { makeSqliteKeyDistribution } from '@lody/e2ee-core/keys/host/distribution/sqlite';
import { openLabExistingWorkspace } from './workspace-session';
import { makeLabMailboxRemote } from './key-mailbox';
import { runLabKeyRound } from './key-round';
import { makeLabFlockSession } from './flock-session';
import { makeLabLoroSession } from './content-session';
import { makeLabOperations } from './operation-scope';

export class LabWorkspaceSessionError extends Data.TaggedError('LabWorkspaceSessionError')<{
  readonly code: 'closed' | 'configuration' | 'unknown-document';
}> {}
type ControlInput = Parameters<typeof openLabExistingWorkspace>[0];
type KeyInput = Omit<
  Parameters<typeof makeSqliteKeyDistribution>[0],
  'genesis' | 'signer' | 'ledger' | 'remote'
>;
export interface LabWorkspaceSessionInput extends ControlInput {
  /** Already installed keys / published epochs only; this is not a candidate publisher. */
  readonly keys: KeyInput;
  readonly documents: readonly {
    readonly id: string;
    readonly model?: 'loro' | 'flock';
    readonly now?: () => number;
    readonly path: string;
    readonly mode: 'create' | 'open';
    readonly resource: string;
    readonly streamUrl: string;
  }[];
}
interface LabWorkspaceDocument {
  create(): Effect.Effect<void, unknown>;
  append(text: string): Effect.Effect<void, unknown>;
  persist(): Effect.Effect<void, unknown>;
  pull(): Effect.Effect<void, unknown>;
  recoverFromFullHistory(): Effect.Effect<void, unknown>;
  text(): Effect.Effect<string, unknown>;
  cursor(): Effect.Effect<unknown, unknown>;
  status(): Effect.Effect<'closed' | 'document-stopped' | 'active'>;
}
/** Existing full-prefix workspace, externally selected checkpoint. Identity/control,
 * public key receive/distribution and protected documents have one child owner.
 * No transport/SQLite row can choose authority; no snapshot/rotation/vault decision. */
export const openLabWorkspaceSession = Effect.fn('Lab.openWorkspaceSession')(function* (
  input: LabWorkspaceSessionInput
) {
  const source = input.documents,
    count = source.length;
  if (!Array.isArray(source) || !Number.isSafeInteger(count) || count > 100)
    return yield* new LabWorkspaceSessionError({ code: 'configuration' });
  const docs: LabWorkspaceSessionInput['documents'][number][] = [];
  for (let index = 0; index < count; index++) {
    const doc = source[index];
    if (!doc) return yield* new LabWorkspaceSessionError({ code: 'configuration' });
    docs.push(
      Object.freeze({
        id: doc.id,
        model: doc.model,
        now: doc.now,
        path: doc.path,
        mode: doc.mode,
        resource: doc.resource,
        streamUrl: doc.streamUrl,
      })
    );
  }
  const genesis = yield* Effect.fromResult(Bytes.genesisHash(input.genesis.toBytes()));
  const signer = Object.freeze({
    publicKey: yield* Effect.fromResult(Bytes.signingPublicKey(input.signer.publicKey.toBytes())),
    sign: input.signer.sign.bind(input.signer),
  });
  const controlInput = {
    ...input,
    genesis,
    signer,
    budget: { ...input.budget },
    expected: input.expected
      ? {
          head: yield* Effect.fromResult(Bytes.recordHash(input.expected.head.toBytes())),
          length: input.expected.length,
        }
      : undefined,
  };

  const protection = input.keys.keyStore.protector;
  const keys = {
    ...input.keys,
    pair: { ...input.keys.pair },
    keyStore: {
      ...input.keys.keyStore,
      protector: Object.freeze({
        protect: protection.protect.bind(protection),
        unprotect: protection.unprotect.bind(protection),
      }),
    },
    repairStore: { ...input.keys.repairStore },
    sendStore: { ...input.keys.sendStore },
    outboxStore: { ...input.keys.outboxStore },
  };
  if (
    new Set(docs.map((doc) => doc.id)).size !== docs.length ||
    docs.some(
      (doc) =>
        !doc.id ||
        !doc.resource ||
        (doc.mode !== 'create' && doc.mode !== 'open') ||
        (doc.model !== undefined && doc.model !== 'loro' && doc.model !== 'flock') ||
        (doc.model === 'flock' && !doc.now)
    )
  )
    return yield* new LabWorkspaceSessionError({ code: 'configuration' });
  const child = yield* Scope.make();
  let closed = false;
  const close = yield* Effect.cached(
    Effect.sync(() => {
      closed = true;
    }).pipe(Effect.andThen(Scope.close(child, Exit.void)))
  );
  yield* Effect.addFinalizer(() => close);
  return yield* Scope.provide(
    Effect.gen(function* () {
      const control = yield* openLabExistingWorkspace(controlInput);
      const ledger = () => control.control.refresh().pipe(Effect.map((current) => current.view));
      const remote = yield* makeLabMailboxRemote({
        url: control.identity.url,
        fetch: control.identity.fetch,
      });
      const distribution = yield* makeSqliteKeyDistribution({
        ...keys,
        genesis,
        signer,
        ledger,
        remote,
      });
      const history = yield* makeInstalledEpochHistory({
        genesis,
        ledger,
        installed: distribution.installedEpochKeys,
      });
      const sessions = new Map<string, LabWorkspaceDocument>();
      const initial = yield* control.control.current();
      for (const doc of docs) {
        const config = {
          ...doc,
          genesis,
          signer,
          writeEpoch: initial.view.inspectState().epoch.number,
          ledger,
          readEpochKey: history.read,
          fetch: control.identity.fetch,
        };
        const session = yield* doc.model === 'flock'
          ? makeLabFlockSession({
              ...config,
              replica: Buffer.from(signer.publicKey.toBytes()).toString('hex'),
              now: doc.now!,
            })
          : makeLabLoroSession(config);
        sessions.set(doc.id, session);
      }
      const operations = yield* makeLabOperations();
      // Stop HTTP/CAS admission before interrupt/join, then native/SQLite owners release.
      yield* Effect.addFinalizer(() => control.stop());
      const serial = yield* Semaphore.make(1);
      const run = <A, E, R>(work: Effect.Effect<A, E, R | Scope.Scope>) =>
        operations.run(
          Effect.suspend<A, E | LabWorkspaceSessionError, R | Scope.Scope>(() =>
            closed ? Effect.fail(new LabWorkspaceSessionError({ code: 'closed' })) : work
          )
        );
      const document = <A, E, R>(
        id: string,
        use: (doc: LabWorkspaceDocument) => Effect.Effect<A, E, R>
      ) =>
        run(
          Effect.suspend<A, E | LabWorkspaceSessionError, R>(() => {
            const doc = sessions.get(id);
            return doc
              ? use(doc)
              : Effect.fail(new LabWorkspaceSessionError({ code: 'unknown-document' }));
          })
        );
      return Object.freeze({
        close: () => close,
        current: () => run(control.control.current()),
        refresh: () => run(serial.withPermit(control.control.refresh())),
        approveJoin: (
          request: import('@lody/e2ee-core/ledger').JoinRequest,
          membershipId: Bytes.MembershipId
        ) =>
          run(
            serial.withPermit(
              control.control.execute({ _tag: 'AdmitMember', request, membershipId })
            )
          ),
        submit: (command: Parameters<typeof control.control.execute>[0]) =>
          run(serial.withPermit(control.control.execute(command))),
        resume: () => run(serial.withPermit(control.control.resume())),
        acknowledge: (result: Parameters<typeof control.control.acknowledge>[0]) =>
          run(serial.withPermit(control.control.acknowledge(result))),
        listJoins: () => run(control.identity.listJoins()),
        keyRound: (limit = 100) => run(serial.withPermit(runLabKeyRound(distribution, limit))),
        createDocument: (id: string) => document(id, (doc) => doc.create()),
        append: (id: string, text: string) => document(id, (doc) => doc.append(text)),
        persist: (id: string) => document(id, (doc) => doc.persist()),
        pull: (id: string) => document(id, (doc) => doc.pull()),
        recoverDocument: (id: string) => document(id, (doc) => doc.recoverFromFullHistory()),
        text: (id: string) => document(id, (doc) => doc.text()),
        cursor: (id: string) => document(id, (doc) => doc.cursor()),
        documentStatus: (id: string) => document(id, (doc) => doc.status()),
      });
    }),
    child
  ).pipe(Effect.onExit((exit) => (Exit.isFailure(exit) ? close : Effect.void)));
});

/** Reauthentication is a new owner, never an in-place unverified repin. */
export const reauthenticateLabWorkspaceSession = Effect.fn('Lab.reauthenticateWorkspace')(
  function* (
    previous: Effect.Success<ReturnType<typeof openLabWorkspaceSession>>,
    input: LabWorkspaceSessionInput,
    expected: LedgerCheckpoint
  ) {
    const ownedExpected = { head: expected.head, length: expected.length };
    yield* previous.close();
    return yield* openLabWorkspaceSession({
      ...input,
      mode: 'open',
      expected: ownedExpected,
      keys: {
        ...input.keys,
        mode: 'open',
        keyStore: { ...input.keys.keyStore, mode: 'open' },
        repairStore: { ...input.keys.repairStore, mode: 'open' },
        sendStore: { ...input.keys.sendStore, mode: 'open' },
        outboxStore: { ...input.keys.outboxStore, mode: 'open' },
      },
      documents: input.documents.map((doc) => ({ ...doc, mode: 'open' })),
    });
  }
);
