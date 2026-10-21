// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Result } from 'effect';
import {
  Bytes,
  exportVerifiedState,
  hashRecordBytes,
  verifyLedger,
} from '@lody/e2ee-core/protocol';
import type { PlatformE2eeWorkspaces, E2eeRuntimeLedgerView } from '@lody/platform';
const fixture = vi.hoisted(() => ({
  port: undefined as PlatformE2eeWorkspaces | undefined,
  session: { status: 'authenticated', user: { id: 'account', name: 'A', email: 'a@example.test' } },
  clear: () => {},
}));
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => ({
    options,
    useParams: () => ({ workspaceId: 'workspace-native' }),
  }),
  useNavigate: () => () => {},
}));
vi.mock('@lody/platform/react', () => ({
  usePlatform: () => ({ e2eeWorkspaces: fixture.port }),
  usePlatformSession: () => fixture.session,
}));
vi.mock('jotai', () => ({ useSetAtom: () => fixture.clear }));
vi.mock('@/atoms', () => ({ setWorkspaceContextAtom: 'workspace' }));
vi.mock('@/components/pages/e2ee-workspace-control-page', () => ({
  E2eeWorkspaceControlPage: ({ history }: { history: { view: { length: number } } | null }) =>
    createElement('p', null, history?.view.length ?? 'loading'),
}));
import { Route } from '../src/routes/workspace/e2ee/$workspaceId';
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const workspaceId = 'workspace-native';
const raw =
  '82860158208a88e3dd7409f195fd52db2d3cba5d72ca6709bf1d94121bf3748801b40f6f5c58200202020202020202020202020202020202020202020202020202020202020202500303030303030303030303030303030358200404040404040404040404040404040404040404040404040404040404040404582005050505050505050505050505050505050505050505050505050505050505055840116dc6d18360ac4d1020a255f4c4589f2bd533b045db20794f431079f298523ab37223a4d861f55ca506abb41876e2aefada1ee6931e9ca7e89c6a6235901a03';
const bytes = new Uint8Array(raw.match(/../g)!.map((value) => Number.parseInt(value, 16)));
const hash = hashRecordBytes(bytes);
const genesisHash = Array.from(hash.toBytes(), (value) => value.toString(16).padStart(2, '0')).join(
  ''
);
const state = Result.getOrThrow(
  exportVerifiedState(
    Result.getOrThrow(
      verifyLedger({
        anchor: Result.getOrThrow(Bytes.genesisHash(hash.toBytes())),
        records: [bytes],
        checkpoint: { head: hash, length: 1 },
      })
    )
  )
);
const hex = (value: Uint8Array) =>
  Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('');
const local: E2eeRuntimeLedgerView = {
  stateHex: hex(state.bytes),
  recordsHex: [raw],
  status: {
    workspaceId,
    genesisHash,
    length: 1,
    headHash: genesisHash,
    stateDigest: hex(state.stateDigest.toBytes()),
    position: `p1:${workspaceId}:1:source:0`,
    epoch: 0,
    rotationRequired: false,
    deviceKind: 'personal',
    hasCurrentKey: true,
    continuityPending: false,
  },
};
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  localStorage.clear();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
it('shows local verified state before network and resumes history from its saved position', async () => {
  const description =
    Promise.withResolvers<Awaited<ReturnType<PlatformE2eeWorkspaces['describe']>>>();
  const entered = Promise.withResolvers<void>();
  const reads: unknown[] = [];
  const leases = new Set<string>();
  fixture.port = {
    create: async () => {
      throw new Error('unused');
    },
    describe: async () => {
      entered.resolve();
      return description.promise;
    },
    history: async (request) => {
      reads.push(request);
      return {
        workspaceId,
        genesisHash,
        checkpoint: { headHash: genesisHash, length: 1 },
        startIndex: 1,
        recordsHex: [],
        position: local.status.position!,
        nextCursor: null,
      };
    },
    runtime: {
      recordCreated: async () => {},
      open: async (id) => {
        leases.add(id);
        return local.status;
      },
      close: async (id) => {
        leases.delete(id);
      },
      status: async () => local.status,
      ledgerView: async () => local,
      ingestLedgerRecords: async () => local.status,
    },
  };
  const Component = Route.options.component as () => ReturnType<typeof createElement>;
  await act(async () => {
    root.render(createElement(Component));
  });
  await entered.promise;
  expect(container.textContent).toBe('1');
  expect(reads).toEqual([]);
  await act(async () => {
    description.resolve({
      workspaceId,
      contentMode: 'e2ee',
      contentModeVersion: 1,
      genesisHash,
      cryptoOrgId: genesisHash,
      activation: 'control-only',
    });
  });
  expect(reads).toEqual([{ workspaceId, after: local.status.position }]);
  await act(async () => root.unmount());
  expect(leases.size).toBe(0);
});
