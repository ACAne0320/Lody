import { useWorkspaceSyncStuckReport } from '@/hooks/use-workspace-sync-stuck-report';
import { useWorkspaceDataScopeState } from '@/hooks/use-workspace-data-scope-state';

/**
 * Renders nothing. Mounted beside the workspace layout rather than inside the
 * sidebar, which compact and mobile layouts unmount while it is closed — the
 * user is stuck behind the content placeholder either way. Readiness is the
 * route's own (`useResolvedWorkspaceScope`), so this never opens a second
 * organization query.
 */
export function WorkspaceSyncStuckReporter(): null {
  const { targetSlug, scope, workspaceId, organizationsReady, docMetaScanErrorType } =
    useWorkspaceDataScopeState();
  useWorkspaceSyncStuckReport({
    targetSlug,
    scope,
    workspaceId,
    organizationsReady,
    docMetaScanErrorType,
  });
  return null;
}
