import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useCloudMutation, useCloudQuery } from '@lody/platform/react';
import { cloudOperations } from '@/lib/cloud-api-operations';
import { useAuthenticatedConvex } from './use-authenticated-convex';

/** One identity gate for PR details, comment reads and comment writes. */
export function useGitHubPrIdentity({
  workspaceId,
  sessionId,
  repoFullName,
  prNumber,
  enabled = true,
  visible = true,
}: {
  workspaceId?: string | null;
  sessionId?: string;
  repoFullName?: string | null;
  prNumber?: number | null;
  enabled?: boolean;
  visible?: boolean;
}) {
  const { t } = useTranslation();
  const { isAuthenticated } = useAuthenticatedConvex();
  const requestedRepoFullName = repoFullName?.trim() || null;
  const hasInputs = Boolean(
    enabled && workspaceId && requestedRepoFullName && prNumber && prNumber > 0
  );
  const serverVersions = useCloudQuery(
    cloudOperations.github.getPrCacheVersions,
    hasInputs
      ? {
          workspaceId: workspaceId!,
          repoFullName: requestedRepoFullName!,
          prNumber: prNumber!,
          ...(sessionId ? { sessionId } : {}),
        }
      : 'skip'
  );
  const resolveLegacy = useCloudMutation(cloudOperations.github.resolveLegacyPrRepositoryIdentity);
  const repositoryId = serverVersions?.repositoryId;
  const ready =
    hasInputs &&
    !serverVersions?.identityPending &&
    (!sessionId || (typeof repositoryId === 'number' && Boolean(serverVersions?.repoFullName)));
  const unresolved = hasInputs && !ready && serverVersions !== undefined;
  const retry = useCallback(async () => {
    if (!hasInputs || !sessionId || !isAuthenticated) return;
    try {
      await resolveLegacy({
        workspaceId: workspaceId!,
        repoFullName: requestedRepoFullName!,
        prNumber: prNumber!,
        sessionId,
      });
    } catch {
      // Keep the explanatory blocked state and its Retry control. In particular,
      // a deployment gap or network failure must never release the identity gate.
    }
  }, [
    hasInputs,
    isAuthenticated,
    prNumber,
    requestedRepoFullName,
    resolveLegacy,
    sessionId,
    workspaceId,
  ]);
  const attemptedKey = useRef<string | null>(null);
  const key = JSON.stringify([workspaceId, sessionId, requestedRepoFullName, prNumber]);
  useEffect(() => {
    if (!visible || !unresolved || !isAuthenticated || !sessionId || attemptedKey.current === key)
      return;
    attemptedKey.current = key;
    // The query subscription publishes repaired identity. Failure remains a
    // visible, retryable blocked state, never permission to fall back to a name.
    void retry().catch(() => {});
  }, [isAuthenticated, key, retry, sessionId, unresolved, visible]);
  const error = useMemo(
    () =>
      unresolved
        ? new Error(
            serverVersions?.associationMissing
              ? t(
                  'sessions.prTab.associationMissing',
                  'This session has no verified PR association. Retry can repair existing legacy records, but cannot reconstruct a missing one. A workspace administrator can verify the current PR and explicitly associate it. You can still open it on GitHub.'
                )
              : t(
                  'sessions.prTab.repositoryIdentityUnresolved',
                  'Cannot verify this session’s repository identity. GitHub operations are paused. Ask a workspace administrator to check Settings > GitHub, the active GitHub App installation, repository access and the original PR association. Background association stops after 6 failed attempts; after fixing access, restart this machine’s Lody background agent and retry. Signing in again does not repair a missing repository link.'
                )
          )
        : null,
    [serverVersions?.associationMissing, t, unresolved]
  );
  return {
    serverVersions,
    repositoryId,
    repoFullName: serverVersions?.repoFullName ?? requestedRepoFullName,
    ready,
    canReassociate: unresolved && isAuthenticated && serverVersions?.canReassociate === true,
    error,
    retry,
  };
}
