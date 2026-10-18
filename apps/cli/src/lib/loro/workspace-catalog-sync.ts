import { Effect, Exit, Schedule, Scope, type Fiber } from 'effect';
import { RepoReleaseFailed, type Repo, type RepoError } from 'loro-repo/effect';
import { getWorkspaceFlockDocId, type WorkspaceId } from '@lody/shared';
import type { Logger } from '@/utils/logger';

/** Keep reader interest alive independently of discovery requests and local writes. */
export const startWorkspaceCatalogSync = Effect.fnUntraced(function* (
  repo: Repo,
  workspaceId: WorkspaceId,
  logger: Logger,
  flockDocId = getWorkspaceFlockDocId(workspaceId)
) {
  const holdRoom = Effect.scoped(
    Effect.gen(function* () {
      yield* repo.acquireRoom({ kind: 'flock', id: flockDocId });
      yield* Effect.never;
    })
  ).pipe(
    Effect.tapCause((cause) =>
      // Raw adapter Causes stay on the fiber/native owner, never in diagnostics.
      Effect.sync(() =>
        logger.debug(
          `[${workspaceId}] Catalog reader failed: ${cause.reasons
            .map((reason) => (reason._tag === 'Fail' ? reason.error._tag : reason._tag))
            .join(', ')}`
        )
      ).pipe(Effect.catchCause(() => Effect.void))
    ),
    // Retry the whole Cause only when native ownership makes same-key reentry
    // safe. Native acquireRoom retries retained RepoReleaseFailed receipts before
    // replacing them; an arbitrary cleanup defect must still stop replacement.
    Effect.exit,
    Effect.flatMap((exit) => (Exit.isFailure(exit) ? Effect.fail(exit.cause) : Effect.void)),
    Effect.retry({
      while: (cause) =>
        cause.reasons.every((reason) =>
          reason._tag === 'Fail'
            ? reason.error._tag === 'RepoIOError' ||
              reason.error._tag === 'RepoResourceBusy' ||
              reason.error instanceof RepoReleaseFailed
            : reason._tag === 'Die' && reason.defect instanceof RepoReleaseFailed
        ),
      schedule: Schedule.min([Schedule.exponential('1 second'), Schedule.spaced('30 seconds')]),
    }),
    Effect.catch((cause) => Effect.failCause(cause))
  );
  // Native transport recovery owns reconnects after acquisition. No initial-sync
  // deadline: offline/slow catalogs must not block daemon startup or cached reads.
  return yield* Effect.forkScoped(holdRoom);
});

export interface WorkspaceCatalogSync {
  hold: (flockDocId: string) => Effect.Effect<void>;
}

export const makeWorkspaceCatalogSync = Effect.fnUntraced(function* (
  repo: Repo,
  workspaceId: WorkspaceId,
  logger: Logger
) {
  const scope = yield* Effect.scope;
  // Retain terminal fibers too: their original Causes remain inspectable while
  // native repo ownership retains any failed release responsibility.
  const held = new Map<string, { fiber?: Fiber.Fiber<void, RepoError> }>();
  const hold = (id: string): Effect.Effect<void> =>
    Effect.suspend(() => {
      if (held.has(id)) return Effect.void;
      const entry: { fiber?: Fiber.Fiber<void, RepoError> } = {};
      held.set(id, entry);
      return Scope.provide(startWorkspaceCatalogSync(repo, workspaceId, logger, id), scope).pipe(
        Effect.tap((fiber) =>
          Effect.sync(() => {
            entry.fiber = fiber;
          })
        ),
        Effect.asVoid
      );
    });
  yield* hold(getWorkspaceFlockDocId(workspaceId));
  return { hold } satisfies WorkspaceCatalogSync;
});
