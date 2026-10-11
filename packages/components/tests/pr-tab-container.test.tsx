// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Provider, createStore, type Store } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GitHubCheckRunsSummary, GitHubPullRequestDetails, WorkspaceId } from '@lody/shared';

const mocks = vi.hoisted(() => {
  class ReadyForReviewStillDraftError extends Error {
    constructor() {
      super('GitHub is still reporting this pull request as a draft.');
      this.name = 'ReadyForReviewStillDraftError';
    }
  }

  return {
    markReadyForReview: vi.fn(),
    mergePullRequest: vi.fn(),
    refresh: vi.fn(),
    toastError: vi.fn(),
    useGitHubPrDetails: vi.fn(),
    useGitHubPrDiff: vi.fn(),
    authSessionId: 'login-A',
    previewAssociation: vi.fn(),
    confirmAssociation: vi.fn(),
    ReadyForReviewStillDraftError,
  };
});

vi.mock('@/hooks/use-authenticated-convex', () => ({
  useAuthenticatedConvex: () => ({ isAuthenticated: true, authSessionId: mocks.authSessionId }),
}));
vi.mock('@lody/platform/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@lody/platform/react')>()),
  useCloudAction: (operation: { name: string }) =>
    operation.name === 'github:previewMissingPrAssociation'
      ? mocks.previewAssociation
      : mocks.confirmAssociation,
}));

vi.mock('@posthog/react', () => ({
  usePostHog: () => null,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

vi.mock('@/lib/toast', () => ({
  toast: {
    error: mocks.toastError,
  },
}));

vi.mock('@/lib/github-token', () => ({
  isGitHubOperationTokenConnectionLostError: (error: unknown) =>
    error instanceof Error && error.message === 'Connection lost while action was in flight',
  isGitHubUnauthorizedTokenError: (error: unknown) =>
    Boolean(
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: unknown }).code === 'unauthorized'
    ),
}));

vi.mock('../src/lib/github-token', () => ({
  isGitHubOperationTokenConnectionLostError: (error: unknown) =>
    error instanceof Error && error.message === 'Connection lost while action was in flight',
  isGitHubUnauthorizedTokenError: (error: unknown) =>
    Boolean(
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: unknown }).code === 'unauthorized'
    ),
}));

vi.mock('@/hooks/use-github-pr-details', () => ({
  ReadyForReviewStillDraftError: mocks.ReadyForReviewStillDraftError,
  useGitHubPrDetails: mocks.useGitHubPrDetails,
}));

vi.mock('../src/hooks/use-github-pr-details', () => ({
  ReadyForReviewStillDraftError: mocks.ReadyForReviewStillDraftError,
  useGitHubPrDetails: mocks.useGitHubPrDetails,
}));

vi.mock('@/hooks/use-github-pr-diff', () => ({
  useGitHubPrDiff: mocks.useGitHubPrDiff,
}));

import { currentWorkspaceIdAtom } from '../src/atoms/workspace-context';
import { PrTabContainer } from '../src/components/sessions/pr-tab-container';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const pullRequest: GitHubPullRequestDetails = {
  number: 42,
  nodeId: 'PR_kwDO_test',
  title: 'Fix ready for review',
  body: '',
  state: 'open',
  merged: false,
  draft: true,
  htmlUrl: 'https://github.com/loro-dev/lody/pull/42',
  baseRef: 'main',
  headRef: 'fix/ready-for-review',
  headSha: 'abc123',
  user: null,
  createdAt: '2026-05-04T00:00:00.000Z',
  updatedAt: '2026-05-04T00:05:00.000Z',
  mergedAt: null,
  closedAt: null,
  additions: 1,
  deletions: 0,
  changedFiles: 1,
  commits: 1,
  mergeable: null,
  mergeableState: 'draft',
};

const checkRuns: GitHubCheckRunsSummary = {
  status: 'none',
  conclusion: null,
  total: 0,
  runs: [],
};

const mergeablePullRequest: GitHubPullRequestDetails = {
  ...pullRequest,
  draft: false,
  mergeable: true,
  mergeableState: 'clean',
};

function createAuthError(): Error {
  return new Error('Not authenticated. Please sign in.');
}

function createPrDetailsResult(pr: GitHubPullRequestDetails = pullRequest) {
  return {
    state: 'ready' as const,
    data: {
      pullRequest: pr,
      reviewThreads: [],
      reviews: [],
      issueComments: [],
      checkRuns,
    },
    error: null,

    checksPermissionError: false,
    isRevalidating: false,
    refresh: mocks.refresh,
    refreshCheckRuns: vi.fn().mockResolvedValue(null),
    postComment: vi.fn(),
    isPostingComment: false,
    mergePullRequest: mocks.mergePullRequest,
    isMerging: false,
    setPullRequestState: vi.fn(),
    isUpdatingState: false,
    markReadyForReview: mocks.markReadyForReview,
    isMarkingReady: false,
    deleteBranch: vi.fn(),
    isDeletingBranch: false,
    branchExists: null,
  };
}

async function flushPromises(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('PrTabContainer ready-for-review auth recovery', () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;
  let store: Store;

  beforeEach(() => {
    mocks.markReadyForReview.mockReset();
    mocks.mergePullRequest.mockReset();
    mocks.refresh.mockReset();
    mocks.toastError.mockReset();
    mocks.useGitHubPrDetails.mockReset();
    mocks.useGitHubPrDiff.mockReset();
    mocks.authSessionId = 'login-A';
    mocks.previewAssociation.mockReset().mockResolvedValue({
      repositoryId: 99,
      repoFullName: 'loro-dev/lody',
      prNumber: 42,
      prNodeId: 'PR_A',
      title: 'Verified current PR',
      url: 'https://github.com/loro-dev/lody/pull/42',
    });
    mocks.confirmAssociation.mockReset().mockResolvedValue({ associated: true });

    store = createStore();
    store.set(currentWorkspaceIdAtom, 'workspace-1' as WorkspaceId);
    mocks.refresh.mockResolvedValue(null);
    mocks.useGitHubPrDetails.mockReturnValue(createPrDetailsResult());
    mocks.useGitHubPrDiff.mockReturnValue({
      state: 'idle',
      commits: [],
      files: [],
      range: null,
      mergeBaseSha: null,
      error: null,
      contentByPath: new Map(),
      refresh: vi.fn().mockResolvedValue(undefined),
      loadFile: vi.fn().mockResolvedValue(undefined),
    });

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount();
      });
    }
    root = undefined;
    container?.remove();
    container = undefined;
    vi.clearAllMocks();
  });

  async function renderContainer(sessionId?: string): Promise<void> {
    await act(async () => {
      root?.render(
        <Provider store={store}>
          <PrTabContainer repoFullName="loro-dev/lody" prNumber={42} sessionId={sessionId} />
        </Provider>
      );
    });
  }

  function showMissingAssociation(canReassociate = true) {
    mocks.useGitHubPrDetails.mockReturnValue({
      ...createPrDetailsResult(),
      state: 'error',
      data: null,
      error: new Error('This session has no verified PR association.'),
      canReassociate,
    });
  }
  async function click(label: string, scope: ParentNode = document) {
    const button = Array.from(scope.querySelectorAll<HTMLButtonElement>('button')).find(
      (node) => node.textContent?.trim() === label
    );
    if (!button) throw new Error(`Missing button: ${label}`);
    await act(async () => button.click());
    await flushPromises();
  }

  it('previews the current PR and creates an association only after explicit confirmation', async () => {
    showMissingAssociation();
    await renderContainer('owner-A');
    await click('Verify and associate PR');
    expect(document.body.textContent).toContain('Verified current PR');
    expect(document.body.textContent).toContain('original association is missing');
    expect(document.querySelector('textarea')).toBeNull();
    expect(mocks.confirmAssociation).not.toHaveBeenCalled();
    await click('Confirm association');
    expect(mocks.confirmAssociation).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      sessionId: 'owner-A',
      repoFullName: 'loro-dev/lody',
      prNumber: 42,
      expectedRepositoryId: 99,
      expectedPrNodeId: 'PR_A',
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
  it('does not offer manual association to viewers without the server capability', async () => {
    showMissingAssociation(false);
    await renderContainer('owner-A');
    expect(document.body.textContent).not.toContain('Verify and associate PR');
    expect(document.querySelector('textarea')).toBeNull();
    expect(mocks.confirmAssociation).not.toHaveBeenCalled();
  });
  it('keeps a verification failure visible and never enables confirmation', async () => {
    showMissingAssociation();
    mocks.previewAssociation.mockRejectedValueOnce(new Error('App access was revoked'));
    await renderContainer('owner-A');
    await click('Verify and associate PR');
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      'App access was revoked'
    );
    expect(document.body.textContent).not.toContain('Confirm association');
    await click('Retry', document.querySelector('[role="dialog"]')!);
    expect(document.body.textContent).toContain('Verified current PR');
    expect(mocks.confirmAssociation).not.toHaveBeenCalled();
  });
  it.each(['session', 'workspace', 'login'])(
    'invalidates consent when the %s changes',
    async (change) => {
      showMissingAssociation();
      await renderContainer('owner-A');
      await click('Verify and associate PR');
      if (change === 'login') mocks.authSessionId = 'login-B';
      if (change === 'workspace')
        await act(async () => {
          store.set(currentWorkspaceIdAtom, 'workspace-2' as WorkspaceId);
        });
      await renderContainer(change === 'session' ? 'owner-B' : 'owner-A');
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      expect(document.body.textContent).not.toContain('Verified current PR');
      expect(mocks.confirmAssociation).not.toHaveBeenCalled();
    }
  );
  it('ignores a late preview for a session that is no longer selected', async () => {
    showMissingAssociation();
    let resolvePreview!: (value: unknown) => void;
    mocks.previewAssociation.mockReturnValueOnce(
      new Promise((resolve) => {
        resolvePreview = resolve;
      })
    );
    await renderContainer('owner-A');
    await click('Verify and associate PR');
    await renderContainer('owner-B');
    await act(async () =>
      resolvePreview({ repositoryId: 1, prNodeId: 'old', title: 'Old session PR' })
    );
    expect(document.body.textContent).not.toContain('Old session PR');
    expect(mocks.confirmAssociation).not.toHaveBeenCalled();
  });

  function getReadyButton(): HTMLButtonElement {
    const button = Array.from(container?.querySelectorAll<HTMLButtonElement>('button') ?? []).find(
      (node) => node.textContent?.includes('Ready for review')
    );
    if (!button) {
      throw new Error('Expected ready-for-review button');
    }
    return button;
  }

  function getMergeButton(): HTMLButtonElement {
    const button = Array.from(container?.querySelectorAll<HTMLButtonElement>('button') ?? []).find(
      (node) => node.textContent?.includes('Merge')
    );
    if (!button) {
      throw new Error('Expected merge button');
    }
    return button;
  }

  it('refreshes once and retries without showing a toast on the first auth failure', async () => {
    mocks.markReadyForReview
      .mockRejectedValueOnce(createAuthError())
      .mockResolvedValueOnce(undefined);
    await renderContainer();

    await act(async () => {
      getReadyButton().click();
    });
    await flushPromises();

    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(mocks.markReadyForReview).toHaveBeenCalledTimes(2);
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it('shows the ready-for-review toast when the retry still fails', async () => {
    mocks.markReadyForReview
      .mockRejectedValueOnce(createAuthError())
      .mockRejectedValueOnce(new Error('still unauthorized'));
    await renderContainer();

    await act(async () => {
      getReadyButton().click();
    });
    await flushPromises();

    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(mocks.markReadyForReview).toHaveBeenCalledTimes(2);
    expect(mocks.toastError).toHaveBeenCalledWith('Failed to mark as ready for review', {
      description: 'still unauthorized',
    });
  });

  it('silently restores the merge action when Convex loses the token action result', async () => {
    mocks.useGitHubPrDetails.mockReturnValue(createPrDetailsResult(mergeablePullRequest));
    mocks.mergePullRequest.mockRejectedValueOnce(
      new Error('Connection lost while action was in flight')
    );
    await renderContainer();

    await act(async () => {
      getMergeButton().click();
    });
    await flushPromises();

    expect(mocks.mergePullRequest).toHaveBeenCalledWith('merge');
    expect(mocks.toastError).not.toHaveBeenCalled();
  });
});
