// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { BugReportDialogContainer } from '../src/components/bug-report/bug-report-dialog-container';
import { attachClientDiagnostics, submitWebBugReport } from '../src/lib/bug-report-api';

const { snapshots } = vi.hoisted(() => ({ snapshots: [] as unknown[] }));
vi.mock('@/atoms', async () => {
  const { atom } = await import('jotai');
  return {
    bugReportDialogOpenAtom: atom(true),
    currentWorkspaceIdAtom: atom('workspace'),
    userAtom: atom({ id: 'reporter' }),
  };
});
vi.mock('@/atoms/runtime', async () => {
  const { atom } = await import('jotai');
  return { runtimeAtom: atom(null) };
});
vi.mock('@/hooks/use-visible-machine-metas', () => ({
  useVisibleMachineMetas: () => ({ machines: new Map() }),
}));
vi.mock('@/hooks/use-machine-online-status', () => ({ useOnlineMachineIds: () => new Set() }));
vi.mock('@/lib/auth-bootstrap', () => ({ readStoredAuthToken: () => 'session' }));
vi.mock('@/lib/chat-landing-defaults', () => ({ readChatLandingDefaults: () => null }));
vi.mock('@/lib/bug-report-api', () => ({
  attachClientDiagnostics: vi.fn(),
  submitWebBugReport: vi.fn(),
  mintBugReportRequestToken: vi.fn(),
}));
vi.mock('@/lib/client-log', () => ({
  buildClientLogUploadWithin: async () => null,
  recordClientLog: () => {},
}));
vi.mock('@/lib/client-diagnostics', () => ({
  collectClientDiagnostics: async () => 'client environment and errors',
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, value: unknown) => (typeof value === 'string' ? value : 'retry attachment'),
  }),
}));
vi.mock('../src/components/bug-report/bug-report-dialog', () => ({
  BugReportDialog: (props: { state: unknown; onSubmit: (input: unknown) => void }) => {
    snapshots.push(props.state);
    return (
      <button onClick={() => props.onSubmit({ machineId: null, description: 'broken UI' })}>
        submit
      </button>
    );
  },
}));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;
afterEach(() => {
  vi.resetAllMocks();
  snapshots.length = 0;
});
it('retries only the client attachment after a report was created, including machine-less reports', async () => {
  vi.mocked(submitWebBugReport).mockResolvedValue({ ok: true, bugReportId: 'report-1' });
  vi.mocked(attachClientDiagnostics)
    .mockResolvedValueOnce({ ok: false, error: 'network interrupted' })
    .mockResolvedValueOnce({ ok: true });
  const host = document.createElement('div');
  const root = createRoot(host);
  try {
    await act(async () => root.render(<BugReportDialogContainer />));
    await act(async () => host.querySelector('button')!.click());
    expect(snapshots.at(-1)).toMatchObject({ status: 'error' });
    await act(async () => host.querySelector('button')!.click());
    expect(snapshots.at(-1)).toMatchObject({
      status: 'success',
      bugReportId: 'report-1',
      withLogs: false,
    });
    // One report exists; both attempts attach the exact same diagnostics to it.
    expect(vi.mocked(submitWebBugReport).mock.calls).toHaveLength(1);
    expect(vi.mocked(attachClientDiagnostics).mock.calls.map(([input]) => input)).toEqual([
      {
        workspaceId: 'workspace',
        bugReportId: 'report-1',
        diagnostics: 'client environment and errors',
        sessionToken: 'session',
      },
      {
        workspaceId: 'workspace',
        bugReportId: 'report-1',
        diagnostics: 'client environment and errors',
        sessionToken: 'session',
      },
    ]);
  } finally {
    await act(async () => root.unmount());
  }
});
