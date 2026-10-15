import type { NativeEpochProtector } from '@lody/e2ee-core/keys/host';
import { Bytes } from '@lody/e2ee-core';
import { Data, Effect, Exit, Layer } from 'effect';
import {
  E2eeWorkspace,
  WorkspacePlatform,
  type WorkspaceResources,
} from '@lody/e2ee-core/workspace';
import type { LedgerCheckpoint } from '@lody/e2ee-core/ledger';
import { makeSqliteKeyDistribution } from '@lody/e2ee-core/keys/host/distribution/sqlite';
import { openLabExistingWorkspace } from './workspace-session';
import { makeLabMailboxRemote } from './key-mailbox';
import { makeLabHttpIdentity } from './http-identity';
import { makeLabWorkspaceCreationRequest } from './workspace-creation-request';
import { makeSqliteProtectedEpochKeys } from '@lody/e2ee-core/keys/host/sqlite';
import { verifyLedger, decodeRecord, hashRecordBytes } from '@lody/e2ee-core/ledger';
import { verifyRetainedWorkspaceGenesis } from '@lody/e2ee-core/workspace';
import { makeLabEpochStagingRemote } from './epoch-staging-http';
import { makeLabFlockSession } from './flock-session';
import { makeLabLoroSession } from './content-session';

export class LabWorkspaceSessionError extends Data.TaggedError('LabWorkspaceSessionError')<{
  readonly code: 'closed' | 'configuration' | 'unknown-document';
}> {}
type ControlInput = Parameters<typeof openLabExistingWorkspace>[0];
type KeyInput = Omit<
  Parameters<typeof makeSqliteKeyDistribution>[0],
  'genesis' | 'signer' | 'ledger' | 'remote'
>;
export interface LabWorkspaceSessionInput extends ControlInput {
  readonly creation?: {
    readonly path: string;
    readonly mode: 'create' | 'open';
    readonly genesisRecord: Uint8Array;
  };
  /** One receiver-owned installed-key store shared by all consumers. */
  readonly keys: KeyInput;
  /** Explicit local candidate recovery. This does not select independent backup
   * policy, a vault, or production platform custody. */
  readonly epochRotation?: {
    readonly path: string;
    readonly mode: 'create' | 'open';
    readonly protector: NativeEpochProtector;
  };
  readonly recoveryConfiguration?:
    | import('@lody/e2ee-core/workspace').WorkspaceResources['recoveryConfiguration']
    | ((context: {
        readonly genesis: Bytes.GenesisHash;
        readonly signer: import('@lody/e2ee-core/signing').DeviceSigner;
        readonly ledger: () => Effect.Effect<import('@lody/e2ee-core/ledger').LedgerView, unknown>;
        readonly control: Effect.Success<ReturnType<typeof openLabExistingWorkspace>>['control'];
        readonly distribution: Effect.Success<ReturnType<typeof makeSqliteKeyDistribution>>;
      }) => Effect.Effect<
        NonNullable<WorkspaceResources['recoveryConfiguration']>,
        unknown,
        import('effect').Scope.Scope
      >);
  readonly documents: readonly {
    readonly id: string;
    readonly model?: 'loro' | 'flock';
    readonly now?: () => number;
    readonly path: string;
    readonly mode: 'create' | 'open';
    readonly resource: string;
    readonly streamUrl: string;
    readonly snapshotUpload?: boolean;
  }[];
}
interface LabWorkspaceDocument {
  create(): Effect.Effect<void, unknown>;
  append(text: string): Effect.Effect<void, unknown>;
  editOffline(text: string): Effect.Effect<void, unknown>;
  flushOffline(): Effect.Effect<void, unknown>;
  persist(): Effect.Effect<void, unknown>;
  uploadSnapshot(): Effect.Effect<void, unknown>;
  pull(): Effect.Effect<void, unknown>;
  recoverFromFullHistory(): Effect.Effect<void, unknown>;
  text(): Effect.Effect<string, unknown>;
  cursor(): Effect.Effect<unknown, unknown>;
  status(): Effect.Effect<'closed' | 'document-stopped' | 'active'>;
}
/** Existing full-prefix workspace, externally selected checkpoint. Identity/control,
 * public key receive/distribution and protected documents have one child owner.
 * No transport/SQLite row can choose authority. Content snapshots bind their exact
 * continuation offset; vault and independent publisher-backup policy remain separate. */
export const makeLabWorkspacePlatform = Effect.fn('Lab.makeWorkspacePlatform')(function* (
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
        snapshotUpload: doc.snapshotUpload,
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
  const candidate = input.epochRotation;
  const epochConfig = candidate
    ? {
        path: candidate.path,
        mode: candidate.mode,
        protector: Object.freeze({
          protect: candidate.protector.protect.bind(candidate.protector),
          unprotect: candidate.protector.unprotect.bind(candidate.protector),
        }),
      }
    : undefined;
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
  let acquired: Awaited<Effect.Success<ReturnType<typeof openLabExistingWorkspace>>> | undefined;
  const nativeDocuments = new Map<string, LabWorkspaceDocument>();
  const acquire = Effect.fnUntraced(function* (_mode: 'create' | 'open') {
    if (input.creation) {
      yield* Effect.scoped(
        Effect.gen(function* () {
          const original = new Uint8Array(input.creation!.genesisRecord),
            parsed = yield* Effect.fromResult(decodeRecord(original));
          if (parsed.body.type !== 'genesis' || !parsed.body.signer.equals(signer.publicKey))
            return yield* new LabWorkspaceSessionError({ code: 'configuration' });
          const view = yield* Effect.fromResult(
            verifyLedger({
              anchor: genesis,
              records: [original],
              checkpoint: { head: hashRecordBytes(original), length: 1 },
            })
          );
          const installed = yield* makeSqliteProtectedEpochKeys({
            ...keys.keyStore,
            mode: 'open',
            genesis,
            recipient: signer.publicKey,
            ledger: () => Effect.succeed(view),
          });
          yield* verifyRetainedWorkspaceGenesis({
            genesis,
            record: original,
            signer: signer.publicKey,
            installed,
          });
          const identity = yield* makeLabHttpIdentity({
            baseUrl: input.baseUrl,
            genesis,
            fetch: input.fetch,
          });
          const auth = yield* identity.authenticate(signer, 'unbound');
          const request = yield* makeLabWorkspaceCreationRequest({
            ...input.creation!,
            send: auth.createWorkspace,
          });
          const result = yield* request.resume();
          yield* request.acknowledge(result);
          return undefined;
        })
      );
    }
    const control = yield* openLabExistingWorkspace(controlInput);
    acquired = control;
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
    const stageRemote = yield* makeLabEpochStagingRemote({
      url: `${control.identity.url.replace(/key-mailbox$/, 'epoch-staging')}`,
      fetch: control.identity.fetch,
    });
    const rotation = epochConfig
      ? yield* control.control.makeEpochRotation({
          ...epochConfig,
          installed: distribution.installedEpochKeys,
          staging: stageRemote,
        })
      : undefined;
    return {
      genesis,
      signer,
      control: control.control,
      distribution,
      staging: stageRemote,
      rotation,
      recoveryConfiguration:
        typeof input.recoveryConfiguration === 'function'
          ? yield* input.recoveryConfiguration({
              genesis,
              signer,
              ledger,
              control: control.control,
              distribution,
            })
          : input.recoveryConfiguration,
      stop: () => control.stop(),
      documentState: (resource, model, binding) =>
        Effect.gen(function* () {
          const doc = docs.find(
            (row) => row.resource === resource && (row.model ?? 'loro') === model
          );
          if (!doc) return yield* new LabWorkspaceSessionError({ code: 'unknown-document' });
          const config = {
            ...doc,
            genesis,
            signer,
            binding,
            writeEpoch: 'current' as const,
            ledger,
            readEpochKey: distribution.installedEpochKeys.read,
            fetch: control.identity.fetch,
          };
          const native = yield* model === 'flock'
            ? makeLabFlockSession({
                ...config,
                replica: Buffer.from(signer.publicKey.toBytes()).toString('hex'),
                now: doc.now!,
              })
            : makeLabLoroSession(config);
          nativeDocuments.set(doc.id, native);
          return native;
        }),
    } satisfies WorkspaceResources;
  });
  const platform = Layer.succeed(WorkspacePlatform, {
    acquire,
    prepareRecovery: () => Effect.fail(new LabWorkspaceSessionError({ code: 'configuration' })),
  });
  return Object.freeze({
    layer: platform,
    adapt: Effect.fnUntraced(function* (
      workspace: import('@lody/e2ee-core/workspace').E2eeWorkspaceHandle
    ) {
      // Eagerly open configured documents to retain the original acquisition/close
      // contract. The facade owns their cryptographic binding and resource scope.
      yield* Effect.forEach(docs, (doc) =>
        workspace.document(doc.resource, doc.model ?? 'loro')
      ).pipe(Effect.onExit((exit) => (Exit.isFailure(exit) ? workspace.close() : Effect.void)));
      const document = <A, E, R>(
        id: string,
        use: (doc: LabWorkspaceDocument) => Effect.Effect<A, E, R>
      ) =>
        Effect.suspend<A, unknown, R>(() => {
          const native = nativeDocuments.get(id);
          return native
            ? workspace.current().pipe(Effect.andThen(use(native)))
            : Effect.fail(new LabWorkspaceSessionError({ code: 'unknown-document' }));
        });
      return Object.freeze({
        ...workspace,
        current: workspace.current,
        refresh: workspace.refresh,
        approveJoin: (
          request: import('@lody/e2ee-core/ledger').JoinRequest,
          membershipId: Bytes.MembershipId
        ) => workspace.execute({ _tag: 'AdmitMember', request, membershipId }),
        submit: workspace.execute,
        submitOriginal: workspace.executeOriginal,
        epochStaging: workspace.staging,
        cleanupStagedEpoch: workspace.cleanupStaged,
        rotateEpoch: workspace.rotate,
        removeMemberAndRotate: workspace.removeMember,
        resumeEpochRotation: workspace.resumeRotation,
        acknowledgeEpochRotation: workspace.acknowledgeRotation,
        listJoins: () => acquired!.identity.listJoins(),
        createDocument: (id: string) => document(id, (doc) => doc.create()),
        append: (id: string, text: string) => document(id, (doc) => doc.append(text)),
        editOffline: (id: string, text: string) => document(id, (doc) => doc.editOffline(text)),
        flushOffline: (id: string) => document(id, (doc) => doc.flushOffline()),
        persist: (id: string) => document(id, (doc) => doc.persist()),
        uploadSnapshot: (id: string) => document(id, (doc) => doc.uploadSnapshot()),
        pull: (id: string) => document(id, (doc) => doc.pull()),
        recoverDocument: (id: string) => document(id, (doc) => doc.recoverFromFullHistory()),
        text: (id: string) => document(id, (doc) => doc.text()),
        cursor: (id: string) => document(id, (doc) => doc.cursor()),
        documentStatus: (id: string) => document(id, (doc) => doc.status()),
      });
    }),
  });
});

export const openLabWorkspaceSession = Effect.fn('Lab.openWorkspaceSession')(function* (
  input: LabWorkspaceSessionInput
) {
  const adapter = yield* makeLabWorkspacePlatform(input);
  const workspace = yield* (
    input.mode === 'create' ? E2eeWorkspace.create() : E2eeWorkspace.open()
  ).pipe(Effect.provide(adapter.layer));
  return yield* adapter.adapt(workspace);
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
      epochRotation: input.epochRotation ? { ...input.epochRotation, mode: 'open' } : undefined,
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
