import { Context, Data, type Effect } from 'effect';

/**
 * A business-level sync target. Callers never name a room, a transport or a
 * token. Targets are added as the slices that need them migrate.
 */
export type SyncTarget = { readonly kind: 'workspace-meta' };

export type ReadSyncPolicy = {
  /** Diagnostic label carried into the failure, e.g. `session.list:<workspace>`. */
  readonly reason: string;
  readonly timeoutMs?: number;
};

/**
 * An explicit read-before-use catch-up did not complete. Nothing was written;
 * the local copy is still readable, but only a caller that explicitly chose an
 * offline read may fall back to it.
 */
export class DataReadSyncFailed extends Data.TaggedError('DataReadSyncFailed')<{
  readonly target: SyncTarget;
  readonly reason: string;
  readonly cause: unknown;
}> {}

export class SyncAuthority extends Context.Service<
  SyncAuthority,
  {
    /**
     * Catch the target up with its remote source before a read. Local-only
     * compositions with no remote source succeed immediately. Having synced
     * earlier does not satisfy a later `refresh`.
     */
    refresh(target: SyncTarget, policy: ReadSyncPolicy): Effect.Effect<void, DataReadSyncFailed>;
  }
>()('@lody/shared/workspace-data/SyncAuthority') {}
