// @vitest-environment jsdom

import { act, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { createStore, Provider } from 'jotai';
import { getSessionRoomId, type MachineId, type SessionId, type SessionMeta } from '@lody/shared';
import { Tooltip } from '@lody/ui/tooltip';

import { sessionMetaCacheAtom } from '../src/atoms/doc-meta';
import { initI18n } from '../src/i18n';
import { SessionForkMark } from '../src/components/sessions/session-fork-mark';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function sessionMeta(id: string, extra: Partial<SessionMeta> = {}): SessionMeta {
  return {
    id: id as SessionId,
    machineId: 'machine-1' as MachineId,
    createdAt: '2026-10-01T00:00:00.000Z',
    userId: 'user-1',
    status: { type: 'idle' },
    cliType: 'builtin',
    agentType: 'codex',
    ...extra,
  };
}

describe('SessionForkMark', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    await initI18n('en');
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function render(
    sessions: SessionMeta[],
    props: Parameters<typeof SessionForkMark>[0],
    onRowClick?: () => void
  ) {
    const store = createStore();
    store.set(
      sessionMetaCacheAtom,
      Object.fromEntries(sessions.map((s) => [getSessionRoomId(s.id), s]))
    );
    act(() => {
      root.render(
        createElement(
          Provider,
          { store },
          createElement(
            Tooltip.Provider,
            null,
            createElement('div', { onClick: onRowClick }, createElement(SessionForkMark, props))
          )
        )
      );
    });
    return container.querySelector<HTMLElement>('[data-session-fork-mark]');
  }

  it('labels with the source title and opens the source without selecting the row', () => {
    const navigations: Array<[string, string | undefined]> = [];
    let rowClicks = 0;
    const mark = render(
      [sessionMeta('source', { title: 'Fix login race' })],
      {
        forkedFromSessionId: 'source',
        onNavigate: (sessionId, tabSessionId) => navigations.push([sessionId, tabSessionId]),
      },
      () => {
        rowClicks += 1;
      }
    );

    expect(mark?.getAttribute('aria-label')).toBe('Forked from Fix login race');
    act(() => mark?.click());
    expect(navigations).toEqual([['source', undefined]]);
    expect(rowClicks).toBe(0);
  });

  it('opens a child-tab source through its root session', () => {
    const navigations: Array<[string, string | undefined]> = [];
    const mark = render(
      [
        sessionMeta('root', { title: 'Root' }),
        sessionMeta('tab', { title: 'Side chat', parentSessionId: 'root' as SessionId }),
      ],
      {
        forkedFromSessionId: 'tab',
        onNavigate: (sessionId, tabSessionId) => navigations.push([sessionId, tabSessionId]),
      }
    );

    act(() => mark?.click());
    expect(navigations).toEqual([['root', 'tab']]);
  });

  it('falls back to a generic label when the source is gone', () => {
    const mark = render([], { forkedFromSessionId: 'deleted', onNavigate: () => {} });
    expect(mark?.getAttribute('aria-label')).toBe('Forked conversation');
  });

  it('renders a decorative icon without a control when not interactive', () => {
    render([sessionMeta('source', { title: 'Original' })], {
      forkedFromSessionId: 'source',
      interactive: false,
    });
    expect(container.querySelector('button')).toBeNull();
    expect(container.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe(
      'Forked from Original'
    );
  });
});
