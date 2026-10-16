/** @vitest-environment jsdom */

import 'fake-indexeddb/auto';
import { gunzipSync } from 'node:zlib';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BUG_REPORT_CLIENT_LOG_LIMITS } from '@lody/shared';
import {
  CLIENT_LOG_LIMITS,
  buildClientLogUpload,
  installClientLog,
  readClientLog,
  recordClientError,
  recordClientLog,
  redactClientLogText,
  resetClientLogForTests,
  simulateClientLogReloadForTests,
} from '../src/lib/client-log';
import { ErrorBoundary } from '../src/components/error-boundary';
import { initI18n } from '../src/i18n';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const START = Date.UTC(2026, 9, 16, 12);
let clockMs = START;
const clock = () => clockMs;
const uninstalls: Array<() => void> = [];

beforeEach(async () => {
  clockMs = START;
  await resetClientLogForTests(clock);
});

afterEach(() => {
  for (const uninstall of uninstalls.splice(0)) uninstall();
});

const install = () => uninstalls.push(installClientLog());

describe('client log', () => {
  it('keeps entries across a reload and marks each page load', async () => {
    recordClientLog('info', 'first.page');
    await simulateClientLogReloadForTests(clock);
    recordClientLog('info', 'second.page');

    const lines = (await readClientLog()).trimEnd().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('first.page');
    expect(lines[1]).toContain('second.page');
    // Each page load writes its own boot id into the line.
    const bootIdOf = (line: string | undefined) => /^\S+ \S+\s+(\S+)/u.exec(line ?? '')?.[1];
    expect(bootIdOf(lines[0])).toMatch(/^[0-9a-f]{8}$/u);
    expect(bootIdOf(lines[0])).not.toBe(bootIdOf(lines[1]));
  });

  it('reports a previous page that never reached pagehide, and not one that did', async () => {
    install();
    document.dispatchEvent(new Event('visibilitychange'));
    // The WebView is killed: no pagehide.
    uninstalls.splice(0).forEach((uninstall) => uninstall());
    await simulateClientLogReloadForTests(clock);
    install();
    expect(await readClientLog()).toContain('page.previous_ended_without_unload');

    // This page leaves the ordinary way.
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
    uninstalls.splice(0).forEach((uninstall) => uninstall());
    await simulateClientLogReloadForTests(clock);
    install();

    const log = await readClientLog();
    expect(log.match(/page\.previous_ended_without_unload/gu)).toHaveLength(1);
    expect(log.match(/page\.boot/gu)).toHaveLength(3);
  });

  it('records uncaught errors and rejections with their stack', async () => {
    install();
    const error = new TypeError('cannot read diff');
    window.dispatchEvent(new ErrorEvent('error', { message: error.message, error }));
    const rejection = new Event('unhandledrejection') as PromiseRejectionEvent;
    Object.defineProperty(rejection, 'reason', { value: new Error('stream closed') });
    window.dispatchEvent(rejection);

    const log = await readClientLog();
    expect(log).toMatch(/ERROR .* window\.error cannot read diff/u);
    expect(log).toContain('TypeError: cannot read diff');
    expect(log).toMatch(/window\.unhandled_rejection Error: stream closed/u);
  });

  it('drops entries older than 48 hours', async () => {
    recordClientLog('error', 'old.crash');
    clockMs += CLIENT_LOG_LIMITS.maxAgeMs + 1;
    recordClientLog('error', 'new.crash');

    const log = await readClientLog();
    expect(log).not.toContain('old.crash');
    expect(log).toContain('new.crash');
  });

  it('keeps the newest entries within the byte budget', async () => {
    const filler = 'x'.repeat(10 * 1024);
    const count = Math.ceil(CLIENT_LOG_LIMITS.maxBytes / filler.length) + 20;
    for (let index = 0; index < count; index += 1) {
      recordClientLog('info', `entry.${index}`, filler);
    }

    const log = await readClientLog();
    expect(new TextEncoder().encode(log).byteLength).toBeLessThanOrEqual(
      CLIENT_LOG_LIMITS.maxBytes
    );
    expect(log).toContain(`entry.${count - 1} `);
    expect(log).not.toContain('entry.0 ');
  });

  it('redacts credentials from messages, details and stacks', async () => {
    expect(redactClientLogText('GET /api?token=abc123&x=1 Bearer sk-secret')).toBe(
      'GET /api?token=[redacted]&x=1 Bearer [redacted]'
    );
    recordClientError('fetch.failed', new Error('401 for https://h/x?access_token=leak'), {
      url: 'https://h/y?ott=leak2',
    });

    const log = await readClientLog();
    expect(log).not.toContain('leak');
    expect(log).toContain('access_token=[redacted]');
  });

  it('builds a bug report upload that decodes back to the log', async () => {
    recordClientLog('error', 'react.error_boundary', 'TypeError: boom');

    const upload = await buildClientLogUpload();
    expect(upload).not.toBeNull();
    const text = gunzipSync(Buffer.from(upload?.data ?? '', 'base64')).toString('utf8');
    expect(text).toBe(await readClientLog());
    expect(upload?.rawBytes).toBe(Buffer.byteLength(text, 'utf8'));
    expect(upload?.compressedBytes).toBeLessThanOrEqual(
      BUG_REPORT_CLIENT_LOG_LIMITS.maxCompressedBytes
    );
  });
});

describe('ErrorBoundary', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    await initI18n('en');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  function Crash(): ReactNode {
    throw new RangeError('diff panel exploded');
  }

  it('keeps a caught crash with its boundary and component stack', async () => {
    act(() => {
      root.render(
        <ErrorBoundary name="SessionDiff" variant="section">
          <Crash />
        </ErrorBoundary>
      );
    });

    const log = await readClientLog();
    expect(log).toMatch(/ERROR .* react\.error_boundary RangeError: diff panel exploded/u);
    expect(log).toContain('"boundary":"SessionDiff"');
    expect(log).toContain('Crash');
  });
});
