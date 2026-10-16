import { Data } from 'effect';

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
  readonly target: { readonly kind: 'workspace-meta' };
  readonly reason: string;
  readonly cause: unknown;
}> {}
