import { useCallback, useEffect, useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { useAtomValue } from 'jotai';
import * as stylex from '@stylexjs/stylex';
import { colors } from '@lody/ui/tokens/colors.stylex';
import { Button } from '@lody/ui/button';
import {
  browserOnlineAtom,
  lodyConnectionUiStateAtom,
  lodyControlConnectionStateAtom,
} from '@/atoms/control-connection';
import { LoadingPlaceholder } from '@/components/loading-placeholder';
import {
  StatusPage,
  StatusPageActions,
  StatusPageCode,
  StatusPageDetails,
  StatusPageFootnote,
} from '@/components/status-page';
import { HardResetConfirmDialog } from '@/components/error-boundary-fallback';
import { ClearCacheConfirmDialog } from '@/components/settings/clear-cache';
import {
  useWorkspaceDataScopeState,
  type WorkspaceDataScopeObservation,
} from '@/hooks/use-workspace-data-scope-state';
import {
  armAutomaticCacheClear,
  markCacheClearPending,
  readAutomaticCacheClearAt,
  reloadApp,
  startHardReset,
} from '@/lib/clear-local-cache';
import { writeTextToClipboard } from '@/lib/clipboard';
import { deferredPostHog } from '@/lib/deferred-posthog';
import {
  buildErrorBoundaryReport,
  collectErrorBoundaryEnvironment,
} from '@/lib/error-boundary-report';
import { capturePostHogEvent } from '@/lib/posthog-analytics';
import { getSessionRenderTraceText, recordSessionRenderTrace } from '@/lib/session-render-trace';
import type { WorkspaceDataScopeBlocker } from '@/lib/workspace-data-scope';

/** How long a workspace may stay unopened before the ways out are offered. */
export const WORKSPACE_OPEN_RECOVERY_DELAY_MS = 20_000;

const COPIED_RESET_MS = 2000;

const styles = stylex.create({
  quietLink: {
    margin: 0,
    padding: 0,
    borderWidth: 0,
    backgroundColor: 'transparent',
    fontFamily: 'inherit',
    fontSize: 'inherit',
    lineHeight: 'inherit',
    fontWeight: 500,
    cursor: 'pointer',
    color: { default: colors.secondaryLabel, ':hover': colors.label },
    textDecorationLine: 'underline',
    textUnderlineOffset: '3px',
    textDecorationColor: `color-mix(in oklab, transparent, ${colors.secondaryLabel} 50%)`,
  },
});

/**
 * Blockers nothing retries within this page load: the runtime or its first
 * metadata scan rejected while reading local storage. Every other blocker can
 * still resolve on its own.
 */
export function isTerminalWorkspaceOpenBlocker(blocker: WorkspaceDataScopeBlocker): boolean {
  return blocker === 'runtime_init_failed' || blocker === 'doc_meta_scan_failed';
}

export type WorkspaceOpenDiagnosticsInput = {
  observation: WorkspaceDataScopeObservation;
  waitedMs: number;
  connectionUiState: string;
  controlConnectionState: string;
  automaticCacheClearAt: number | null;
  environment: ReturnType<typeof collectErrorBoundaryEnvironment>;
  renderTrace: string | undefined;
};

/** The copyable report: what holds the workspace back, then the crash-report context. */
export function buildWorkspaceOpenDiagnostics(input: WorkspaceOpenDiagnosticsInput): string {
  const { observation } = input;
  const blocker = observation.scope?.status === 'switching' ? observation.scope.blocker : 'none';
  const report = buildErrorBoundaryReport({
    error: `Workspace did not open: ${blocker}`,
    boundaryName: 'workspace-open',
    environment: input.environment,
    renderTrace: input.renderTrace,
  });
  const fields: Array<[string, string | null]> = [
    ['Workspace', observation.targetSlug],
    ['Runtime workspace id', observation.workspaceId],
    ['Organizations ready', observation.organizationsReady ? 'yes' : 'no'],
    ['Runtime init error', observation.runtimeInitErrorType],
    ['Doc metadata scan error', observation.docMetaScanErrorType],
    ['Waited', `${Math.round(input.waitedMs / 1000)}s`],
    ['Connection', `${input.connectionUiState} (control: ${input.controlConnectionState})`],
    [
      'Last automatic cache clear',
      input.automaticCacheClearAt === null
        ? 'never'
        : new Date(input.automaticCacheClearAt).toISOString(),
    ],
  ];
  const workspaceSection = fields
    .filter((entry): entry is [string, string] => entry[1] !== null)
    .map(([label, value]) => `${label}: ${value}`)
    .join('\n');
  return [report.summary, workspaceSection, report.details].filter(Boolean).join('\n\n');
}

type RecoveryState = 'waiting' | 'repairing' | 'slow' | 'failed';

/**
 * Turns a scope stuck short of `ready` into something the person can act on.
 *
 * A terminal blocker arms one automatic cache clear and reloads — the clear
 * runs at boot, before the runtime reopens the databases it deletes. The
 * cooldown in `armAutomaticCacheClear` bounds that to one per day, so a second
 * failure lands on the manual page instead of a reload loop. Offline, nothing
 * is cleared automatically: the damaged copy could not be downloaded again.
 */
function useWorkspaceOpenRecovery(
  observation: WorkspaceDataScopeObservation,
  delayMs: number
): RecoveryState {
  const online = useAtomValue(browserOnlineAtom);
  const blocker = observation.scope?.status === 'switching' ? observation.scope.blocker : null;
  const waiting = blocker !== null;
  const failed = blocker !== null && isTerminalWorkspaceOpenBlocker(blocker);
  const [slow, setSlow] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const latestRef = useRef(observation);
  latestRef.current = observation;

  useEffect(() => {
    if (!waiting) {
      setSlow(false);
      return undefined;
    }
    const timer = setTimeout(() => setSlow(true), delayMs);
    return () => clearTimeout(timer);
  }, [waiting, delayMs]);

  useEffect(() => {
    if (!failed || !online) return;
    if (!armAutomaticCacheClear(Date.now())) return;
    const latest = latestRef.current;
    const properties = {
      blocker: latest.scope?.status === 'switching' ? latest.scope.blocker : null,
      workspace_id: latest.workspaceId,
      doc_meta_scan_error_type: latest.docMetaScanErrorType,
      runtime_init_error_type: latest.runtimeInitErrorType,
    };
    console.warn('[workspace-open] clearing local cache automatically', properties);
    recordSessionRenderTrace(`workspace-open auto cache clear ${String(properties.blocker)}`);
    try {
      capturePostHogEvent(deferredPostHog, 'workspace/auto_cache_clear', properties);
    } catch {
      // Diagnostics must never stop the repair.
    }
    setRepairing(true);
    reloadApp();
  }, [failed, online]);

  if (repairing) return 'repairing';
  if (failed) return 'failed';
  return slow ? 'slow' : 'waiting';
}

/**
 * The placeholder shown while the route's workspace scope is not ready. It
 * stays a spinner while the wait is ordinary, and becomes a status page with
 * the ways out — clear the local cache, reload, copy diagnostics, wipe — once
 * the wait has failed or outlasted `recoveryDelayMs`. Those ways out otherwise
 * live in Settings, which a person stuck here cannot reach.
 */
export function WorkspaceOpenPlaceholder({
  variant,
  title,
  description,
  recoveryDelayMs = WORKSPACE_OPEN_RECOVERY_DELAY_MS,
}: {
  variant: 'content' | 'boot';
  title: string;
  description: string;
  recoveryDelayMs?: number;
}) {
  const { t } = useTranslation();
  const observation = useWorkspaceDataScopeState();
  const state = useWorkspaceOpenRecovery(observation, recoveryDelayMs);
  const [waitStartedAt] = useState(() => Date.now());

  if (state === 'waiting') {
    return <LoadingPlaceholder variant={variant} title={title} description={description} />;
  }
  if (state === 'repairing') {
    return (
      <LoadingPlaceholder
        variant={variant}
        title={t('workspace.route.recovery.repairingTitle')}
        description={t('workspace.route.recovery.repairingDescription')}
      />
    );
  }
  return (
    <WorkspaceOpenRecoveryPage
      layout={variant === 'boot' ? 'window' : 'pane'}
      failed={state === 'failed'}
      observation={observation}
      waitStartedAt={waitStartedAt}
    />
  );
}

/** The ways out, once waiting has failed or run long. Exported for its stories. */
export function WorkspaceOpenRecoveryPage({
  layout,
  failed,
  observation,
  waitStartedAt,
}: {
  layout: 'window' | 'pane';
  failed: boolean;
  observation: WorkspaceDataScopeObservation;
  waitStartedAt: number;
}) {
  const { t } = useTranslation();
  const connectionUiState = useAtomValue(lodyConnectionUiStateAtom);
  const controlConnectionState = useAtomValue(lodyControlConnectionStateAtom);
  const [clearOpen, setClearOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [hardResetOpen, setHardResetOpen] = useState(false);
  const [hardResetting, setHardResetting] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const readDiagnostics = () =>
    buildWorkspaceOpenDiagnostics({
      observation,
      waitedMs: Date.now() - waitStartedAt,
      connectionUiState,
      controlConnectionState,
      automaticCacheClearAt: readAutomaticCacheClearAt(),
      environment: collectErrorBoundaryEnvironment(),
      renderTrace: getSessionRenderTraceText(),
    });

  useEffect(() => {
    if (!copied) return undefined;
    const timer = setTimeout(() => setCopied(false), COPIED_RESET_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  const handleCopy = async () => {
    if (await writeTextToClipboard(readDiagnostics())) {
      setCopied(true);
    } else {
      // Blocked: open the text so it can be selected by hand.
      setDetailsOpen(true);
    }
  };

  // The URL is already this workspace, and a reload keeps it.
  const handleClear = useCallback(() => {
    setClearing(true);
    markCacheClearPending();
    reloadApp();
  }, []);

  const handleHardReset = useCallback(() => {
    setHardResetting(true);
    void Promise.resolve(startHardReset()).catch(() => setHardResetting(false));
  }, []);

  return (
    <StatusPage
      layout={layout}
      role={failed ? 'alert' : 'status'}
      illustration="broken"
      title={
        failed ? t('workspace.route.recovery.failedTitle') : t('workspace.route.recovery.slowTitle')
      }
      description={t('workspace.route.recovery.description')}
    >
      <StatusPageActions>
        <Button type="button" size="small" onClick={() => setClearOpen(true)}>
          {t('workspace.route.recovery.clearCache')}
        </Button>
        <Button type="button" variant="secondary" size="small" onClick={() => reloadApp()}>
          {t('errorBoundary.reload')}
        </Button>
        <Button type="button" variant="ghost" size="small" onClick={() => void handleCopy()}>
          {copied ? t('errorBoundary.copied') : t('workspace.route.recovery.copyDiagnostics')}
        </Button>
      </StatusPageActions>

      <StatusPageDetails
        label={t('errorBoundary.technicalDetails')}
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
      >
        <StatusPageCode size="details">{readDiagnostics()}</StatusPageCode>
      </StatusPageDetails>

      <StatusPageFootnote>
        <Trans
          i18nKey="workspace.route.recovery.stillStuck"
          components={{
            reset: (
              <button
                type="button"
                {...stylex.props(styles.quietLink)}
                onClick={() => setHardResetOpen(true)}
              />
            ),
          }}
        />
      </StatusPageFootnote>

      <ClearCacheConfirmDialog
        open={clearOpen}
        onOpenChange={setClearOpen}
        isClearing={clearing}
        onConfirm={handleClear}
      />
      <HardResetConfirmDialog
        open={hardResetOpen}
        onOpenChange={setHardResetOpen}
        isResetting={hardResetting}
        onConfirm={handleHardReset}
      />
    </StatusPage>
  );
}
