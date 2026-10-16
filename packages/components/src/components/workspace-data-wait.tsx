import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { BlockingWaitPlaceholder } from '@/components/blocking-wait-placeholder';
import { preloadMainLayout } from '@/components/preloaded-main-layout';

/**
 * The workspace whose data scope was last ready in this page load. Module-level
 * on purpose: a cold start and a workspace switch both remount the route, and
 * only page lifetime tells them apart.
 */
let lastReadyWorkspaceSlug: string | null = null;

export type WorkspaceDataWaitKind = 'cold-start' | 'reload' | 'switch';

export function resolveWorkspaceDataWaitKind(targetSlug: string): WorkspaceDataWaitKind {
  if (lastReadyWorkspaceSlug === null) return 'cold-start';
  return lastReadyWorkspaceSlug === targetSlug ? 'reload' : 'switch';
}

/** Record the workspace whose data scope just became ready. */
export function useRecordWorkspaceDataReady(readySlug: string | null): void {
  useEffect(() => {
    if (readySlug) lastReadyWorkspaceSlug = readySlug;
  }, [readySlug]);
}

export function resetWorkspaceDataReadyForTests(): void {
  lastReadyWorkspaceSlug = null;
}

/**
 * The wait while a workspace's data scope is not ready. A cold start (an app
 * launch, or a WebView the OS reloaded) continues the boot shell: nothing was
 * open, so there is no workspace to switch from and no layout to keep. Only a
 * real switch says "Switching workspace"; the caller keeps the layout mounted
 * around the pane variants.
 */
export function WorkspaceDataWait({ kind }: { kind: WorkspaceDataWaitKind }) {
  const { t } = useTranslation();

  useEffect(() => {
    if (kind !== 'cold-start') return;
    // The layout mounts only once data is ready; fetch its chunk meanwhile.
    void preloadMainLayout().catch(() => undefined);
  }, [kind]);

  if (kind === 'switch') {
    return (
      <BlockingWaitPlaceholder
        gate="workspace_data"
        variant="content"
        title={t('workspace.route.switchingTitle')}
        description={t('workspace.route.switchingDescription')}
      />
    );
  }
  return (
    <BlockingWaitPlaceholder
      gate="workspace_data"
      variant={kind === 'cold-start' ? 'boot' : 'content'}
      title={t('workspace.route.loadingTitle')}
    />
  );
}
