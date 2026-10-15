import { Cause, Context, Data, Effect, Exit, Layer, Result, Scope, Semaphore } from 'effect';
import * as Bytes from '../bytes';
import type { DeviceSigner } from '../signing';
import type { LedgerView } from '../ledger';
import { comparisonNote } from '../ledger/snapshot';
import { makeInstalledEpochHistory } from '../keys/installed-history';
import { makeStreamsUpdateBinding } from '../content/streams';
import type { makeSqliteKeyDistribution } from '../keys/distribution-sqlite';
import type { makeSqliteEpochRotation } from '../keys/epoch-rotation';
import type { EpochStagingPort } from '../keys/staging';
import { getCommittedEpochStagingKey } from '../keys/staging';
import { runWorkspaceKeyRound, type WorkspaceKeyRoundCursors } from './key-round';
import { makeWorkspaceOperations } from './operations';
import { makeWorkspaceRecovery, type WorkspaceRecoveryInput } from '../recovery';
import { disposeEpochKey } from '../epoch-key';
import type { makeWorkspaceControl } from './control';
export {
  makeWorkspaceControl,
  WorkspaceControlError,
  type WorkspaceControlInput,
  type WorkspaceLedgerClient,
} from './control';
export {
  runWorkspaceKeyRound,
  WorkspaceKeyRoundCursors,
  WorkspaceKeyRoundError,
  type WorkspaceDistribution,
} from './key-round';
export * from './invitation';
export { verifyRetainedWorkspaceGenesis } from './creation';
export class WorkspaceError extends Data.TaggedError('WorkspaceError')<{
  readonly code: 'closed' | 'configuration' | 'unknown-document' | 'recovery-unavailable';
}> {}
export type WorkspaceModel = 'loro' | 'flock';
type Control = Effect.Success<ReturnType<typeof makeWorkspaceControl>>;
type Distribution = Effect.Success<ReturnType<typeof makeSqliteKeyDistribution>>;
type RawRotation = Effect.Success<ReturnType<typeof makeSqliteEpochRotation>>;
type Rotation = {
  [K in keyof RawRotation]: RawRotation[K] extends (
    ...args: infer A
  ) => Effect.Effect<infer B, unknown, never>
    ? (...args: A) => Effect.Effect<B, unknown>
    : RawRotation[K];
};
/** Native model state belongs to its platform adapter. Crypto always comes from
 * this workspace's genuine ledger and installed-key owner. */
export interface WorkspaceDocumentState {
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
export interface WorkspaceResources {
  readonly genesis: Bytes.GenesisHash;
  readonly signer: DeviceSigner;
  readonly control: Control;
  readonly distribution: Distribution;
  readonly staging: EpochStagingPort;
  readonly rotation?: Rotation;
  readonly recoveryConfiguration?: Omit<
    WorkspaceRecoveryInput,
    'genesis' | 'personalSigner' | 'ledger' | 'submitOriginal' | 'installed'
  >;
  readonly stop: () => Effect.Effect<void, unknown>;
  readonly documentState: (
    resource: string,
    model: WorkspaceModel,
    crypto: Effect.Success<ReturnType<typeof makeStreamsUpdateBinding>>
  ) => Effect.Effect<WorkspaceDocumentState, unknown, Scope.Scope>;
}
type RecoveryOwner = Effect.Success<ReturnType<typeof makeWorkspaceRecovery>>;
export interface WorkspaceRestoreRequest {
  readonly personal: Parameters<RecoveryOwner['restoreFromRecovery']>[0]['personal'];
}
export interface WorkspaceRestorePlan {
  readonly workflow: WorkspaceRecoveryInput;
  readonly submitOriginalAsRecovery: Parameters<
    RecoveryOwner['restoreFromRecovery']
  >[0]['submitOriginalAsRecovery'];
  /** Opens C's own storage/identity only after verified personal admission. */
  readonly acquirePersonal: () => Effect.Effect<WorkspaceResources, unknown, Scope.Scope>;
}
/** All native dependencies are supplied by an explicit Layer at composition.
 * acquire owns Streams, staging/mailbox/vault/protector/signer and local paths;
 * the public workflow never imports a concrete host or chooses hidden defaults. */
export class WorkspacePlatform extends Context.Service<
  WorkspacePlatform,
  {
    acquire(mode: 'create' | 'open'): Effect.Effect<WorkspaceResources, unknown, Scope.Scope>;
    prepareRecovery(
      input: WorkspaceRestoreRequest
    ): Effect.Effect<WorkspaceRestorePlan, unknown, Scope.Scope>;
  }
>()('@lody/e2ee-core/workspace/Platform') {
  static layer(implementation: WorkspacePlatform['Service']) {
    return Layer.succeed(WorkspacePlatform, implementation);
  }
}
export const unavailableWorkspaceRecovery = Object.freeze({
  setup: () => Effect.fail(new WorkspaceError({ code: 'recovery-unavailable' })),
  test: () => Effect.fail(new WorkspaceError({ code: 'recovery-unavailable' })),
  status: (): Effect.Effect<Effect.Success<ReturnType<RecoveryOwner['status']>>> =>
    Effect.succeed(
      Object.freeze({
        paired: false,
        envelopeAvailable: false,
        recoverable: false,
        currentEpoch: null,
        testedEpoch: null,
        lastTest: null,
        skipped: false,
      })
    ),
});
/** One workspace owner. close waits native work and child owners, and every public
 * call rejects after close. Closing never publishes Streams EOF or deletes journals. */
export const makeE2eeWorkspace = Effect.fn('E2eeWorkspace.acquire')(function* (
  acquire: Effect.Effect<WorkspaceResources, unknown, Scope.Scope>
) {
  const child = yield* Scope.make(),
    operationScope = yield* Scope.make();
  let closed = false,
    stop: () => Effect.Effect<void, unknown> = () => Effect.void;
  const close = yield* Effect.cached(
    Effect.uninterruptible(
      Effect.gen(function* () {
        closed = true;
        // Admission/abort, active workflow settlement, then native key/DB owners.
        // These are separate scopes so lazily opened documents cannot reverse order.
        const exits = [
          yield* Effect.exit(stop()),
          yield* Effect.exit(Scope.close(operationScope, Exit.void)),
          yield* Effect.exit(Scope.close(child, Exit.void)),
        ];
        const reasons = exits.flatMap((exit) => (Exit.isFailure(exit) ? exit.cause.reasons : []));
        if (reasons.length) yield* Effect.failCause(Cause.fromReasons(reasons));
      })
    )
  );
  yield* Effect.addFinalizer(() => close.pipe(Effect.orDie));
  return yield* Scope.provide(
    Effect.gen(function* () {
      const resources = yield* acquire;
      const { control, distribution, staging, rotation } = resources;
      stop = resources.stop.bind(resources);
      const genesis = yield* Effect.fromResult(Bytes.genesisHash(resources.genesis.toBytes()));
      const signer = Object.freeze({
        publicKey: yield* Effect.fromResult(
          Bytes.signingPublicKey(resources.signer.publicKey.toBytes())
        ),
        sign: resources.signer.sign.bind(resources.signer),
      });
      const ledger = () => control.refresh().pipe(Effect.map((current) => current.view));
      const history = yield* makeInstalledEpochHistory({
        genesis,
        ledger,
        installed: distribution.installedEpochKeys,
      });
      const operations = yield* Scope.provide(makeWorkspaceOperations(), operationScope);
      const serial = yield* Semaphore.make(1);
      const run = <A, E, R>(effect: Effect.Effect<A, E, R | Scope.Scope>) =>
        operations.run(
          Effect.suspend<A, E | WorkspaceError, R | Scope.Scope>(() =>
            closed ? Effect.fail(new WorkspaceError({ code: 'closed' })) : effect
          )
        );
      const ordered = <A, E, R>(effect: Effect.Effect<A, E, R | Scope.Scope>) =>
        run(serial.withPermit(effect));
      const receiveCommittedEpoch = Effect.fnUntraced(function* () {
        const view = yield* ledger(),
          epoch = view.inspectState().epoch.number;
        if (epoch === 0) return { staged: false, installed: false } as const;
        const located = getCommittedEpochStagingKey(view, epoch);
        if (Result.isFailure(located) && view.verification === 'endorsed-snapshot')
          return {
            staged: false,
            installed: false,
            reason: 'publication-original-unavailable',
          } as const;
        const key = yield* Effect.fromResult(located),
          group = yield* staging.readGroup(key);
        if (!group) return { staged: false, installed: false } as const;
        if (
          !group.envelopes.some(
            (row) =>
              row.recipient ===
              Array.from(signer.publicKey.toBytes(), (x) => x.toString(16).padStart(2, '0')).join(
                ''
              )
          )
        )
          return { staged: true, installed: false } as const;
        yield* distribution.receiveStagedGroup(group);
        return { staged: true, installed: true } as const;
      });
      const documents = new Map<
        string,
        {
          state: WorkspaceDocumentState;
          crypto: Effect.Success<ReturnType<typeof makeStreamsUpdateBinding>>;
        }
      >();
      const document = Effect.fnUntraced(function* (resource: string, model: WorkspaceModel) {
        if (!resource || (model !== 'loro' && model !== 'flock'))
          return yield* new WorkspaceError({ code: 'configuration' });
        const key = JSON.stringify([resource, model]);
        let found = documents.get(key);
        if (!found) {
          const crypto = yield* Scope.provide(
            makeStreamsUpdateBinding({
              genesis,
              resource,
              model,
              writeEpoch: 'current',
              signer,
              ledger,
              readEpochKey: history.read,
            }),
            child
          );
          const state = yield* Scope.provide(
            resources.documentState(resource, model, crypto),
            child
          );
          found = { crypto, state };
          documents.set(key, found);
        }
        const owner = found;
        return Object.freeze({
          seal: (request: Parameters<typeof owner.crypto.seal>[0]) =>
            run(owner.crypto.seal(request)),
          open: (request: Parameters<typeof owner.crypto.open>[0]) =>
            run(owner.crypto.open(request)),
          snapshot: (request: Parameters<typeof owner.crypto.seal>[0]) =>
            request.context.kind === 'snapshot'
              ? run(owner.crypto.seal(request))
              : Effect.fail(new WorkspaceError({ code: 'configuration' })),
          state: owner.state,
        });
      });
      const recovery = resources.recoveryConfiguration
        ? yield* makeWorkspaceRecovery({
            ...resources.recoveryConfiguration,
            genesis,
            personalSigner: signer,
            ledger,
            installed: distribution.installedEpochKeys,
            submitOriginal: Effect.fnUntraced(function* (record: Uint8Array) {
              const resumed = yield* control.resume();
              const result = resumed ?? (yield* control.executeOriginal(record));
              if (
                result.record.length !== record.length ||
                result.record.some((byte, index) => byte !== record[index])
              )
                return yield* new WorkspaceError({ code: 'configuration' });
              yield* control.acknowledge(result);
              return result;
            }),
          })
        : unavailableWorkspaceRecovery;
      return Object.freeze({
        close: () => close,
        genesis,
        signer,
        current: () => run(control.current()),
        refresh: () => ordered(control.refresh()),
        execute: (command: Parameters<typeof control.execute>[0]) =>
          ordered(control.execute(command)),
        executeOriginal: (record: Uint8Array) => ordered(control.executeOriginal(record)),
        resume: () => ordered(control.resume()),
        acknowledge: (result: Parameters<typeof control.acknowledge>[0]) =>
          ordered(control.acknowledge(result)),
        rotate: () =>
          ordered(
            rotation
              ? rotation.publish()
              : Effect.fail(new WorkspaceError({ code: 'configuration' }))
          ),
        removeMember: (membershipId: Bytes.MembershipId) =>
          ordered(
            rotation
              ? rotation.publishRemoving(membershipId)
              : Effect.fail(new WorkspaceError({ code: 'configuration' }))
          ),
        resumeRotation: () =>
          ordered(
            rotation
              ? rotation.resume()
              : Effect.fail(new WorkspaceError({ code: 'configuration' }))
          ),
        acknowledgeRotation: (result: Parameters<Rotation['acknowledge']>[0]) =>
          ordered(
            rotation
              ? rotation.acknowledge(result)
              : Effect.fail(new WorkspaceError({ code: 'configuration' }))
          ),
        cleanupStaged: () =>
          run(
            rotation
              ? rotation.cleanupStaged()
              : Effect.fail(new WorkspaceError({ code: 'configuration' }))
          ),
        staging,
        receiveCommittedEpoch: () => run(receiveCommittedEpoch()),
        keyRound: (limit = 100, cursors: WorkspaceKeyRoundCursors = {}) =>
          ordered(runWorkspaceKeyRound(distribution, limit, cursors, receiveCommittedEpoch())),
        recoverHistory: () => run(history.recover()),
        enqueueRepair: (id: string, digest?: string) =>
          ordered(distribution.enqueueRepair(id, digest)),
        receiveResults: (limit = 100) => ordered(distribution.results(limit)),
        repairResults: (limit = 100, cursor: string | null = null) =>
          ordered(distribution.repairResults(limit, cursor)),
        deliveryResults: (limit = 100, cursor: string | null = null) =>
          ordered(distribution.deliveryResults(limit, cursor)),
        acknowledgeReceive: (id: string) => ordered(distribution.acknowledge(id)),
        acknowledgeRepair: (id: string) => ordered(distribution.acknowledgeRepair(id)),
        acknowledgeDelivery: (id: string) => ordered(distribution.acknowledgeDelivery(id)),
        comparisonNote: () =>
          ordered(
            ledger().pipe(
              Effect.flatMap((view: LedgerView) =>
                Effect.fromResult(comparisonNote(view, signer.publicKey))
              )
            )
          ),
        document: (resource: string, model: WorkspaceModel) => ordered(document(resource, model)),
        recovery: Object.freeze({
          setup: () => ordered(recovery.setup()),
          test: () => ordered(recovery.test()),
          status: () => run(recovery.status()),
        }),
      });
    }),
    child
  ).pipe(Effect.onExit((exit) => (Exit.isFailure(exit) ? close : Effect.void)));
});
export class E2eeWorkspace {
  static create = Effect.fn('E2eeWorkspace.create')(function* () {
    const platform = yield* WorkspacePlatform;
    return yield* makeE2eeWorkspace(platform.acquire('create'));
  });
  static open = Effect.fn('E2eeWorkspace.open')(function* () {
    const platform = yield* WorkspacePlatform;
    return yield* makeE2eeWorkspace(platform.acquire('open'));
  });
  static restoreFromRecovery = Effect.fn('E2eeWorkspace.restoreFromRecovery')(function* (
    input: WorkspaceRestoreRequest
  ) {
    const platform = yield* WorkspacePlatform;
    return yield* Effect.acquireUseRelease(
      Effect.scoped(
        Effect.gen(function* () {
          const plan = yield* platform.prepareRecovery(input);
          const recovery = yield* makeWorkspaceRecovery(plan.workflow);
          const result = yield* recovery.restoreFromRecovery({
            personal: input.personal,
            submitOriginalAsRecovery: plan.submitOriginalAsRecovery,
          });
          const keys: Array<readonly [number, Bytes.EpochKey]> = [];
          yield* Effect.gen(function* () {
            if (result.outcome === 'Committed')
              for (let epoch = 0; epoch <= result.epoch; epoch++)
                keys.push([epoch, yield* plan.workflow.installed.read(epoch)]);
          }).pipe(
            Effect.onExit((exit) =>
              Exit.isFailure(exit)
                ? Effect.sync(() => {
                    for (const [, key] of keys) disposeEpochKey(key);
                  })
                : Effect.void
            )
          );
          return { result, keys, genesis: plan.workflow.genesis, acquire: plan.acquirePersonal };
        })
      ),
      (restored) =>
        Effect.gen(function* () {
          if (restored.result.outcome !== 'Committed')
            return {
              outcome: restored.result.outcome,
              epoch: restored.result.epoch,
              workspace: null,
            };
          const workspace = yield* makeE2eeWorkspace(
            Effect.gen(function* () {
              const resources = yield* restored.acquire();
              if (
                !resources.genesis.equals(restored.genesis) ||
                !resources.signer.publicKey.equals(input.personal.publicKey)
              )
                return yield* new WorkspaceError({ code: 'configuration' });
              const current = yield* resources.control.refresh();
              const device = current.view
                .inspectState()
                .devices.get(
                  Array.from(input.personal.publicKey.toBytes(), (byte) =>
                    byte.toString(16).padStart(2, '0')
                  ).join('')
                );
              if (
                !device ||
                device.kind !== 'personal' ||
                !device.encryptionPublicKey.equals(input.personal.encryptionPublicKey)
              )
                return yield* new WorkspaceError({ code: 'configuration' });
              for (const [epoch, key] of restored.keys)
                yield* resources.distribution.installedEpochKeys.saveAndReload(epoch, key);
              return resources;
            })
          );
          return { outcome: 'Committed' as const, epoch: restored.result.epoch, workspace };
        }),
      (restored) =>
        Effect.sync(() => {
          for (const [, key] of restored.keys) disposeEpochKey(key);
        })
    );
  });
}
export type E2eeWorkspaceHandle = Effect.Success<ReturnType<typeof E2eeWorkspace.open>>;
