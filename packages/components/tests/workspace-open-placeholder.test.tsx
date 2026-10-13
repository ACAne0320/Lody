/** @vitest-environment jsdom */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Provider, createStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceId } from '@lody/shared';

const app = vi.hoisted(() => ({
  reloads: 0,
  events: [] as Array<{ name: string; properties: Record<string, unknown> }>,
}));

vi.mock('../src/lib/clear-local-cache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/clear-local-cache')>()),
  reloadApp: () => {
    app.reloads += 1;
  },
}));

vi.mock('../src/lib/deferred-posthog', () => ({
  deferredPostHog: {
    capture: (name: string, properties: Record<string, unknown>) =>
      app.events.push({ name, properties }),
    captureException: () => {},
  },
}));

import { browserOnlineAtom } from '../src/atoms/control-connection';
import { docMetaCacheScopeAtom } from '../src/atoms/doc-meta';
import {
  runtimeAtom,
  workspaceRuntimeInitFailureAtom,
  type WorkspaceRuntime,
} from '../src/atoms/runtime';
import { setWorkspaceContextAtom } from '../src/atoms/workspace-context';
import { WorkspaceOpenPlaceholder } from '../src/components/workspace-open-placeholder';
import { initI18n } from '../src/i18n';
import { armAutomaticCacheClear, readPendingLocalClearMode } from '../src/lib/clear-local-cache';
import { WorkspaceRouteTargetProvider } from '../src/providers/workspace-route-target';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const RECOVERY_DELAY_MS = 20_000;
const runtime = {
  workspaceSlug: 'acme',
  workspaceId: 'ws-acme' as WorkspaceId,
} as WorkspaceRuntime;

let container: HTMLDivElement;
let root: Root;

function createWorkspaceStore({
  online = true,
  scan,
}: {
  online?: boolean;
  scan: 'pending' | 'failed' | 'init-failed';
}) {
  const store = createStore();
  store.set(setWorkspaceContextAtom, { slug: 'acme', workspaceId: runtime.workspaceId });
  store.set(browserOnlineAtom, online);
  if (scan === 'init-failed') {
    store.set(workspaceRuntimeInitFailureAtom, {
      workspaceSlug: 'acme',
      errorType: 'InvalidStateError',
    });
    return store;
  }
  store.set(runtimeAtom, runtime);
  store.set(docMetaCacheScopeAtom, {
    runtime,
    workspaceId: runtime.workspaceId,
    workspaceSlug: 'acme',
    ready: false,
    ...(scan === 'failed' ? { scanFailure: { errorType: 'UnknownError' } } : {}),
  });
  return store;
}

function render(store: ReturnType<typeof createStore>) {
  act(() => {
    root.render(
      <Provider store={store}>
        <WorkspaceRouteTargetProvider slug="acme">
          <WorkspaceOpenPlaceholder
            variant="content"
            title="Switching workspace"
            description="Finalizing workspace access and permissions."
            recoveryDelayMs={RECOVERY_DELAY_MS}
          />
        </WorkspaceRouteTargetProvider>
      </Provider>
    );
  });
}

const text = () => container.textContent ?? '';
const buttonLabels = () =>
  Array.from(container.querySelectorAll('button')).map((button) => button.textContent);

beforeEach(async () => {
  await initI18n('en');
  vi.useFakeTimers();
  vi.setSystemTime(Date.UTC(2026, 9, 13, 12));
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  localStorage.clear();
  app.reloads = 0;
  app.events = [];
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('WorkspaceOpenPlaceholder', () => {
  it('repairs a failed first metadata scan by clearing the cache once and reloading', () => {
    render(createWorkspaceStore({ scan: 'failed' }));

    expect(readPendingLocalClearMode()).toBe('cache');
    expect(app.reloads).toBe(1);
    expect(text()).toContain('Repairing local cache');
    expect(app.events).toEqual([
      {
        name: 'workspace/auto_cache_clear',
        properties: expect.objectContaining({
          blocker: 'doc_meta_scan_failed',
          doc_meta_scan_error_type: 'UnknownError',
        }),
      },
    ]);
  });

  it('repairs a runtime that could not be created the same way', () => {
    render(createWorkspaceStore({ scan: 'init-failed' }));

    expect(readPendingLocalClearMode()).toBe('cache');
    expect(app.reloads).toBe(1);
  });

  it('shows the ways out instead of clearing again when the repair did not help', () => {
    // The automatic clear that already ran before this reload.
    expect(armAutomaticCacheClear(Date.now() - 60_000)).toBe(true);
    localStorage.removeItem('lody:clearCacheOnBoot');

    render(createWorkspaceStore({ scan: 'failed' }));

    expect(readPendingLocalClearMode()).toBeNull();
    expect(app.reloads).toBe(0);
    expect(text()).toContain("Lody couldn't open this workspace");
    expect(buttonLabels()).toEqual(
      expect.arrayContaining(['Clear local cache and retry', 'Reload Lody', 'Copy diagnostics'])
    );
    expect(text()).toContain('Clear all local data and sign out');
  });

  it('never clears automatically while offline', () => {
    render(createWorkspaceStore({ scan: 'failed', online: false }));

    expect(readPendingLocalClearMode()).toBeNull();
    expect(app.reloads).toBe(0);
    expect(text()).toContain("Lody couldn't open this workspace");
  });

  it('offers the ways out for a scan that never settles, without clearing on its own', () => {
    render(createWorkspaceStore({ scan: 'pending' }));
    expect(text()).toContain('Switching workspace');

    act(() => {
      vi.advanceTimersByTime(RECOVERY_DELAY_MS - 1);
    });
    expect(text()).toContain('Switching workspace');

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(text()).toContain('This workspace is taking too long to open');
    expect(buttonLabels()).toContain('Clear local cache and retry');
    expect(readPendingLocalClearMode()).toBeNull();
    expect(app.reloads).toBe(0);
  });

  it('puts the blocker and failure into the copied diagnostics', () => {
    expect(armAutomaticCacheClear(Date.now() - 60_000)).toBe(true);
    localStorage.removeItem('lody:clearCacheOnBoot');
    render(createWorkspaceStore({ scan: 'failed' }));

    const details = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Technical details'
    );
    act(() => {
      details!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const report = container.querySelector('pre')?.textContent ?? '';
    expect(report).toContain('Workspace did not open: doc_meta_scan_failed');
    expect(report).toContain('Workspace: acme');
    expect(report).toContain('Doc metadata scan error: UnknownError');
    expect(report).toContain('Last automatic cache clear: 2026-10-13T11:59:00.000Z');
  });
});
