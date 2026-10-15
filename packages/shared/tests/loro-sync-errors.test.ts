import { describe, expect, it } from 'vitest';
import { RepoSyncError, RepoTransportError, type RepoDiagnosticEvent } from 'loro-repo';
import type { SnapshotDiagnosticEvent } from '@loro-dev/streams-crdt';
import { createLoroSyncErrorTools, getLoroSnapshotDiagnostic } from '../src/loro-sync-errors';

const tools = createLoroSyncErrorTools({ RepoSyncError, RepoTransportError });
const PRIVATE_VALUE = 'synthetic-secret-body-token';

const uploadFailure = () =>
  new RepoTransportError(PRIVATE_VALUE, {
    code: 'timeout',
    phase: 'upload',
    retryable: false,
    transportId: 'streams',
    roomKind: 'doc',
    roomId: 'synthetic-document',
    failureKind: 'timeout',
    streamsCode: 'timeout',
    streamsContext: Object.assign(
      {
        source: 'fetch' as const,
        operation: 'snapshot' as const,
        stage: 'upload' as const,
        originalCode: 'timeout' as const,
        retryable: false,
        phase: 'upload' as const,
        timeoutMs: 60_000,
        elapsedMs: 60_003,
        abortKind: 'deadline' as const,
      },
      {
        body: PRIVATE_VALUE,
        url: `https://synthetic.invalid/?token=${PRIVATE_VALUE}`,
        headers: { authorization: PRIVATE_VALUE },
      }
    ),
    cause: new Error(PRIVATE_VALUE),
  });

describe('Loro sync diagnostic projection', () => {
  it('preserves the typed upload budget and abort evidence without serializing private payloads', () => {
    const failure = uploadFailure();
    const before = failure.streamsContext;
    const diagnostic = tools.getLoroSyncDiagnostic({
      level: 'warn',
      event: 'room.upload.failed',
      durationMs: 60_003,
      error: failure,
    });

    expect(diagnostic?.failures).toEqual([
      expect.objectContaining({
        code: 'timeout',
        phase: 'upload',
        retryable: false,
        streamsContext: expect.objectContaining({
          source: 'fetch',
          operation: 'snapshot',
          phase: 'upload',
          timeoutMs: 60_000,
          elapsedMs: 60_003,
          abortKind: 'deadline',
        }),
      }),
    ]);
    const serialized = JSON.stringify(diagnostic);
    expect(serialized).not.toContain(PRIVATE_VALUE);
    expect(serialized).not.toContain('authorization');
    expect(failure.streamsContext).toBe(before);
    expect(failure.cause).toBeInstanceOf(Error);
  });

  it('keeps report transport identity and the same safe evidence in technical formatting', () => {
    const report = new RepoSyncError({
      ok: false,
      outcome: 'failed',
      transports: [
        {
          transportId: 'synthetic-route',
          ok: false,
          failures: [{ kind: 'doc', id: 'synthetic-document', error: uploadFailure() }],
        },
      ],
    });
    const diagnostic = tools.getLoroSyncDiagnostic({
      level: 'error',
      event: 'sync.failed',
      error: new AggregateError([report], PRIVATE_VALUE),
    });
    const failure = diagnostic?.failures[0];

    expect(failure?.transportId).toBe('synthetic-route');
    expect(failure?.retryable).toBe(false);
    expect(tools.formatLoroSyncError(report)).toContain(JSON.stringify(failure));
    expect(tools.formatLoroSyncError(report)).not.toContain(PRIVATE_VALUE);
  });

  it('requires the bound Repo error identity and leaves ordinary successful sync silent', () => {
    const lookalike = Object.assign(new Error(PRIVATE_VALUE), {
      code: 'timeout',
      transportId: 'streams',
      streamsContext: uploadFailure().streamsContext,
    });
    expect(tools.formatLoroSyncError(lookalike)).toBeUndefined();
    expect(tools.formatLoroSyncError({ error: uploadFailure() })).toBeUndefined();
    const ordinary: RepoDiagnosticEvent = {
      level: 'debug',
      event: 'room.upload.succeeded',
      error: uploadFailure(),
    };
    expect(tools.getLoroSyncDiagnostic(ordinary)).toBeUndefined();
  });

  it('settles a cyclic error cause without inspecting unknown payload fields', () => {
    const cause = new Error(PRIVATE_VALUE);
    cause.cause = cause;
    const error = new AggregateError([cause, uploadFailure()], PRIVATE_VALUE);
    Object.defineProperty(error, 'headers', {
      get() {
        throw new Error('Unapproved field must never be inspected');
      },
    });
    const diagnostic = tools.getLoroSyncDiagnostic({
      level: 'warn',
      event: 'sync.failed',
      error,
    });
    expect(diagnostic?.failures).toHaveLength(1);
    expect(JSON.stringify(diagnostic)).not.toContain(PRIVATE_VALUE);
  });
});

describe('Loro snapshot phase diagnostic projection', () => {
  it('keeps auth, HEAD and PUT failures distinct with opaque request correlation', () => {
    const events: SnapshotDiagnosticEvent[] = [
      {
        snapshotId: 'synthetic-snapshot-auth',
        stage: 'auth',
        outcome: 'failed',
        elapsedMs: 10_003,
        snapshotElapsedMs: 10_005,
        requestId: 'synthetic-request-auth',
        requestOperation: 'head',
        timeoutMs: 10_000,
        error: {
          source: 'auth',
          operation: 'head',
          originalCode: 'timeout',
          retryable: true,
          phase: 'auth',
          abortKind: 'deadline',
          elapsedMs: 10_003,
          timeoutMs: 10_000,
        },
      },
      {
        snapshotId: 'synthetic-snapshot-head',
        stage: 'head',
        outcome: 'failed',
        elapsedMs: 40,
        snapshotElapsedMs: 45,
        requestId: 'synthetic-request-head',
        requestOperation: 'head',
        status: 403,
        error: {
          source: 'http',
          operation: 'head',
          originalCode: 'forbidden',
          retryable: false,
          status: 403,
        },
      },
      {
        snapshotId: 'synthetic-snapshot-put',
        stage: 'put',
        outcome: 'failed',
        elapsedMs: 60_003,
        snapshotElapsedMs: 60_300,
        snapshotOffset: '1024',
        snapshotByteLength: 16 * 1024 * 1024,
        requestId: 'synthetic-request-put',
        requestOperation: 'put-snapshot',
        timeoutMs: 60_000,
        error: uploadFailure().streamsContext,
      },
    ];

    const records = events.map(getLoroSnapshotDiagnostic);
    expect(records.map(({ stage, requestId, error }) => [stage, requestId, error?.source])).toEqual(
      [
        ['auth', 'synthetic-request-auth', 'auth'],
        ['head', 'synthetic-request-head', 'http'],
        ['put', 'synthetic-request-put', 'fetch'],
      ]
    );
    expect(records.every(({ level }) => level === 'warn')).toBe(true);
    expect(records[0]?.snapshotByteLength).toBeUndefined();
    expect(records[1]?.error?.retryable).toBe(false);
    expect(records[2]).toMatchObject({
      snapshotOffset: '1024',
      snapshotByteLength: 16 * 1024 * 1024,
      elapsedMs: 60_003,
      snapshotElapsedMs: 60_300,
      timeoutMs: 60_000,
      error: { abortKind: 'deadline', phase: 'upload' },
    });
    expect(JSON.stringify(records)).not.toContain(PRIVATE_VALUE);
  });

  it('records completed stages at debug without copying bodies, headers, URLs or causes', () => {
    const event = Object.assign(
      {
        snapshotId: 'synthetic-snapshot',
        stage: 'encode' as const,
        outcome: 'succeeded' as const,
        elapsedMs: 12,
        snapshotElapsedMs: 20,
        snapshotOffset: '512',
        snapshotByteLength: 2048,
      },
      {
        body: new TextEncoder().encode(PRIVATE_VALUE),
        headers: { authorization: PRIVATE_VALUE },
        url: `https://synthetic.invalid/?token=${PRIVATE_VALUE}`,
        cause: new Error(PRIVATE_VALUE),
      }
    );
    Object.defineProperty(event, 'provider', {
      get() {
        throw new Error('Unapproved field must never be inspected');
      },
    });
    const record = getLoroSnapshotDiagnostic(event);
    expect(record).toMatchObject({
      level: 'debug',
      stage: 'encode',
      outcome: 'succeeded',
      snapshotOffset: '512',
      snapshotByteLength: 2048,
      elapsedMs: 12,
      snapshotElapsedMs: 20,
    });
    expect(Object.keys(record)).not.toContain('body');
    expect(Object.keys(record)).not.toContain('headers');
    expect(JSON.stringify(record)).not.toContain(PRIVATE_VALUE);
  });
});
