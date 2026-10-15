import type { RepoTransportError, RepoDiagnosticEvent } from 'loro-repo';
import type { SnapshotDiagnosticEvent } from '@loro-dev/streams-crdt';

type RepoErrorRuntime = Pick<typeof import('loro-repo'), 'RepoTransportError' | 'RepoSyncError'>;
type SafeStreamsContext = Pick<
  NonNullable<SnapshotDiagnosticEvent['error']>,
  | 'source'
  | 'operation'
  | 'originalCode'
  | 'retryable'
  | 'phase'
  | 'timeoutMs'
  | 'elapsedMs'
  | 'abortKind'
  | 'status'
  | 'requestId'
  | 'networkCode'
> &
  Partial<Pick<NonNullable<RepoTransportError['streamsContext']>, 'stage' | 'requestOperation'>>;

export type LoroSnapshotDiagnostic = Pick<
  SnapshotDiagnosticEvent,
  | 'snapshotId'
  | 'stage'
  | 'outcome'
  | 'elapsedMs'
  | 'snapshotElapsedMs'
  | 'snapshotOffset'
  | 'snapshotByteLength'
  | 'requestId'
  | 'requestOperation'
  | 'timeoutMs'
  | 'status'
> & {
  readonly level: 'debug' | 'warn';
  readonly error?: SafeStreamsContext;
};

// Select approved fields; never serialize an exception or its legacy payload.
const projectStreamsContext = (
  context: RepoTransportError['streamsContext'] | SnapshotDiagnosticEvent['error']
): SafeStreamsContext | undefined =>
  context && {
    source: context.source,
    operation: context.operation,
    stage: 'stage' in context ? context.stage : undefined,
    originalCode: context.originalCode,
    retryable: context.retryable,
    requestOperation: 'requestOperation' in context ? context.requestOperation : undefined,
    phase: context.phase,
    timeoutMs: context.timeoutMs,
    elapsedMs: context.elapsedMs,
    abortKind: context.abortKind,
    status: context.status,
    requestId: context.requestId,
    networkCode: context.networkCode,
  };

const projectFailure = (error: RepoTransportError, transportId?: string) => {
  return {
    code: error.code,
    phase: error.phase,
    retryable: error.retryable,
    transportId: transportId ?? error.transportId,
    roomKind: error.roomKind,
    roomId: error.roomId,
    failureKind: error.failureKind ?? 'unknown',
    streamsCode: error.streamsCode,
    streamsContext: projectStreamsContext(error.streamsContext),
  };
};

/** Explicit snapshot phases are safe SDK records, separate from arbitrary errors. */
export const getLoroSnapshotDiagnostic = (
  event: SnapshotDiagnosticEvent
): LoroSnapshotDiagnostic => ({
  level: event.outcome === 'failed' ? 'warn' : 'debug',
  snapshotId: event.snapshotId,
  stage: event.stage,
  outcome: event.outcome,
  elapsedMs: event.elapsedMs,
  snapshotElapsedMs: event.snapshotElapsedMs,
  snapshotOffset: event.snapshotOffset,
  snapshotByteLength: event.snapshotByteLength,
  requestId: event.requestId,
  requestOperation: event.requestOperation,
  timeoutMs: event.timeoutMs,
  status: event.status,
  error: projectStreamsContext(event.error),
});

/** Bind to the caller's Repo instance: pnpm peers can produce distinct classes. */
export const createLoroSyncErrorTools = (runtime: RepoErrorRuntime) => {
  const collectFailures = (error: unknown) => {
    const failures: ReturnType<typeof projectFailure>[] = [];
    const seen = new Set<unknown>();
    const visit = (value: unknown, depth: number, transportId?: string): void => {
      if (depth > 8 || failures.length >= 16) return;
      if (value instanceof runtime.RepoTransportError) {
        if (
          value.streamsCode !== undefined ||
          value.streamsContext !== undefined ||
          value.transportId === 'streams'
        ) {
          failures.push(projectFailure(value, transportId));
        }
        return;
      }
      if (seen.has(value)) return;
      seen.add(value);
      if (value instanceof runtime.RepoSyncError) {
        for (const transport of value.report.transports) {
          for (const failure of transport.failures)
            visit(failure.error, depth + 1, transport.transportId);
        }
      } else if (value instanceof Error) {
        if (value instanceof AggregateError) {
          for (const nested of value.errors) visit(nested, depth + 1, transportId);
        }
        visit(value.cause, depth + 1, transportId);
      }
    };
    visit(error, 0);
    return failures;
  };

  return {
    formatLoroSyncError(error: unknown): string | undefined {
      const failures = collectFailures(error);
      return failures.length
        ? failures
            .map(
              (failure) =>
                `Streams ${failure.phase} failed: ${failure.streamsCode ?? failure.code} (${JSON.stringify(failure)})`
            )
            .join('; ')
        : undefined;
    },
    getLoroSyncDiagnostic(event: RepoDiagnosticEvent) {
      if (event.level !== 'warn' && event.level !== 'error') return undefined;
      return {
        level: event.level,
        event: event.event,
        transportId: event.transportId,
        roomKind: event.roomKind,
        roomId: event.roomId,
        phase: event.phase,
        durationMs: event.durationMs,
        attempt: event.attempt,
        failures: collectFailures(event.error),
      };
    },
  };
};
