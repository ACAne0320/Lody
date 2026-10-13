/** @vitest-environment jsdom */

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Provider, createStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceId } from '@lody/shared';

const app = vi.hoisted(() => ({
  reloads: 0,
  relaunches: [] as unknown[],
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

import 'fake-indexeddb/auto';
import { browserOnlineAtom } from '../src/atoms/control-connection';
import { docMetaCacheScopeAtom } from '../src/atoms/doc-meta';
import {
  runtimeAtom,
  workspaceRuntimeInitFailureAtom,
  type WorkspaceRuntime,
} from '../src/atoms/runtime';
import { setWorkspaceContextAtom } from '../src/atoms/workspace-context';
import { BlockingWaitPlaceholder } from '../src/components/blocking-wait-placeholder';
import { RouteMessage } from '../src/components/route-message';
import { initI18n } from '../src/i18n';
import {
  installAppActivityTracking,
  resetAppActivityGapForTests,
} from '../src/lib/app-activity-gap';
import {
  armAutomaticCacheClear,
  markCacheClearPending,
  maybeClearLodyCacheOnBoot,
  resetBootClearMemoForTests,
} from '../src/lib/clear-local-cache';
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

function renderNode(store: ReturnType<typeof createStore>, node: ReactNode, slug: string | null) {
  act(() => {
    root.render(
      <Provider store={store}>
        {slug ? (
          <WorkspaceRouteTargetProvider slug={slug}>{node}</WorkspaceRouteTargetProvider>
        ) : (
          node
        )}
      </Provider>
    );
  });
}

function render(store: ReturnType<typeof createStore>) {
  renderNode(
    store,
    <BlockingWaitPlaceholder
      gate="workspace_data"
      variant="content"
      title="Switching workspace"
      description="Finalizing workspace access and permissions."
      recoveryDelayMs={RECOVERY_DELAY_MS}
    />,
    'acme'
  );
}

const text = () => container.textContent ?? '';
const buttonLabels = () =>
  Array.from(container.querySelectorAll('button')).map((button) => button.textContent);
const click = (label: string) => {
  const button = Array.from(container.querySelectorAll('button')).find(
    (candidate) => candidate.textContent === label
  );
  if (!button) throw new Error(`No "${label}" button`);
  act(() => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
};
const eventsNamed = (name: string) => app.events.filter((event) => event.name === name);

/** Run the boot-time clear; fake-indexeddb schedules its work on the faked timers. */
async function bootClear(extraNames: string[] = []) {
  await act(async () => {
    const booting = maybeClearLodyCacheOnBoot(extraNames);
    await vi.runAllTimersAsync();
    await booting;
  });
}

/** The automatic clear that already ran before this page load. */
function automaticClearRanAMinuteAgo() {
  expect(armAutomaticCacheClear(Date.now() - 60_000)).toBe(true);
}

beforeEach(async () => {
  await initI18n('en');
  vi.useFakeTimers();
  vi.setSystemTime(Date.UTC(2026, 9, 13, 12));
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  localStorage.clear();
  resetBootClearMemoForTests();
  resetAppActivityGapForTests();
  app.reloads = 0;
  app.relaunches = [];
  app.events = [];
  // The desktop bridge: a restart into a clear is a recorded relaunch request.
  (window as unknown as { ipc: unknown }).ipc = {
    invoke: async (channel: string, ...args: unknown[]) => {
      if (channel === 'app.relaunchIntoLocalReset') app.relaunches.push(args[0]);
      return null;
    },
  };
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  delete (window as { ipc?: unknown }).ipc;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('BlockingWaitPlaceholder', () => {
  it('repairs a failed first metadata scan by restarting into one cache clear', async () => {
    render(createWorkspaceStore({ scan: 'failed' }));
    await act(async () => {});

    expect(app.relaunches).toEqual(['cache']);
    expect(text()).toContain('Repairing local cache');
    expect(eventsNamed('workspace/auto_cache_clear')).toEqual([
      {
        name: 'workspace/auto_cache_clear',
        properties: expect.objectContaining({
          gate: 'workspace_data',
          blocker: 'doc_meta_scan_failed',
          doc_meta_scan_error_type: 'UnknownError',
        }),
      },
    ]);
  });

  it('repairs a runtime that could not be created the same way', async () => {
    render(createWorkspaceStore({ scan: 'init-failed' }));
    await act(async () => {});

    expect(app.relaunches).toEqual(['cache']);
  });

  it('shows the ways out instead of clearing again when the repair did not help', () => {
    automaticClearRanAMinuteAgo();

    render(createWorkspaceStore({ scan: 'failed' }));

    expect(app.relaunches).toEqual([]);
    expect(text()).toContain("Lody couldn't open this workspace");
    expect(buttonLabels()).toEqual(
      expect.arrayContaining(['Reload Lody', 'Clear local cache and retry', 'Copy diagnostics'])
    );
    expect(text()).toContain('Clear all local data and sign out');
    expect(eventsNamed('workspace/boot_wait_stuck')).toEqual([
      {
        name: 'workspace/boot_wait_stuck',
        properties: expect.objectContaining({
          gate: 'workspace_data',
          failed: true,
          blocker: 'doc_meta_scan_failed',
        }),
      },
    ]);
  });

  it('never clears automatically while offline', () => {
    render(createWorkspaceStore({ scan: 'failed', online: false }));

    expect(app.relaunches).toEqual([]);
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
    expect(app.relaunches).toEqual([]);
  });

  it('times out a wait that has nothing to do with workspace data', () => {
    // Signing in, before any workspace is chosen: no route target, no scope.
    renderNode(
      createStore(),
      <BlockingWaitPlaceholder
        gate="session_loading"
        variant="boot"
        title="Signing you in"
        recoveryDelayMs={RECOVERY_DELAY_MS}
      />,
      null
    );
    expect(text()).toContain('Signing you in');

    act(() => {
      vi.advanceTimersByTime(RECOVERY_DELAY_MS);
    });

    expect(text()).toContain('Lody is taking too long to open');
    expect(buttonLabels()).toContain('Reload Lody');
    expect(eventsNamed('workspace/boot_wait_stuck')[0]?.properties).toMatchObject({
      gate: 'session_loading',
      failed: false,
      blocker: null,
    });
  });

  it('says so when the last clear could not delete everything', async () => {
    markCacheClearPending();
    // A storage backend that cannot open the database cannot delete it either.
    const deleteDatabase = indexedDB.deleteDatabase.bind(indexedDB);
    vi.spyOn(indexedDB, 'deleteDatabase').mockImplementation((name: string) => {
      if (name !== 'lody-loro-repo-db-ws-acme') return deleteDatabase(name);
      return {
        error: new DOMException('backing store', 'UnknownError'),
        addEventListener: (type: string, listener: () => void) => {
          if (type === 'error') queueMicrotask(listener);
        },
      } as unknown as IDBOpenDBRequest;
    });
    await bootClear(['lody-loro-repo-db-ws-acme']);
    automaticClearRanAMinuteAgo();

    render(createWorkspaceStore({ scan: 'failed' }));

    expect(text()).toContain("The last cache clear couldn't remove everything.");
  });

  it('reports a boot-time clear that did not get the workspace open', async () => {
    markCacheClearPending();
    await bootClear();
    automaticClearRanAMinuteAgo();

    render(createWorkspaceStore({ scan: 'failed' }));

    expect(eventsNamed('workspace/recovery_outcome')).toEqual([
      {
        name: 'workspace/recovery_outcome',
        properties: expect.objectContaining({
          outcome: 'stuck_again',
          gate: 'workspace_data',
          mode: 'cache',
          clear_ok: true,
        }),
      },
    ]);
  });

  it('puts the gate, blocker, idle gap and last clear into the copied diagnostics', () => {
    localStorage.setItem('lody:lastActiveAt', String(Date.now() - 72 * 3_600_000));
    const stopTracking = installAppActivityTracking();
    automaticClearRanAMinuteAgo();
    render(createWorkspaceStore({ scan: 'failed' }));

    click('Technical details');

    const report = container.querySelector('pre')?.textContent ?? '';
    expect(report).toContain('Lody did not open: workspace_data');
    expect(report).toContain('Workspace data blocker: doc_meta_scan_failed');
    expect(report).toContain('Workspace: acme');
    expect(report).toContain('Doc metadata scan error: UnknownError');
    expect(report).toContain('Idle before launch: 72h');
    expect(report).toContain('Last automatic cache clear: 2026-10-13T11:59:00.000Z');
    stopTracking();
  });
});

describe('RouteMessage', () => {
  it('gives a failure without its own retry a reload and the full recovery screen', () => {
    renderNode(
      createStore(),
      <RouteMessage
        gate="workspace_switch_error"
        title="Unable to open workspace"
        description="Please refresh the page and try again."
      />,
      null
    );

    click('Reload Lody');
    expect(app.reloads).toBe(1);
    expect(eventsNamed('workspace/boot_wait_stuck')[0]?.properties).toMatchObject({
      gate: 'workspace_switch_error',
      failed: true,
    });

    click('More ways to recover');
    expect(text()).toContain("Lody couldn't open");
    expect(buttonLabels()).toContain('Clear local cache and retry');
  });

  it('keeps a message that is not a failure free of recovery actions', () => {
    renderNode(createStore(), <RouteMessage gate={null} title="Workspace limit reached" />, null);

    expect(buttonLabels()).toEqual([]);
    expect(eventsNamed('workspace/boot_wait_stuck')).toEqual([]);
  });
});
