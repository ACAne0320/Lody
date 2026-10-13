import { useCallback, useEffect, useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { useAtomValue } from 'jotai';
import { AlertTriangle } from 'lucide-react';
import * as stylex from '@stylexjs/stylex';
import { colors } from '@lody/ui/tokens/colors.stylex';
import { corner, radius, space, text } from '@lody/ui/tokens/scales.stylex';
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
import { readIdleGapMs } from '@/lib/app-activity-gap';
import {
  armAutomaticCacheClear,
  readAutomaticCacheClearAt,
  readLastLocalClear,
  reloadApp,
  restartIntoCacheClear,
  startHardReset,
  type LocalClearRecord,
} from '@/lib/clear-local-cache';
import { collectClientBuildInfo } from '@/lib/client-build-info';
import { writeTextToClipboard } from '@/lib/clipboard';
import { deferredPostHog } from '@/lib/deferred-posthog';
import {
  buildErrorBoundaryReport,
  collectErrorBoundaryEnvironment,
} from '@/lib/error-boundary-report';
import { capturePostHogEvent, type PostHogAnalyticsProperties } from '@/lib/posthog-analytics';
import { reportRecoveryOutcome } from '@/lib/recovery-outcome';
import { getSessionRenderTraceText, recordSessionRenderTrace } from '@/lib/session-render-trace';
import type { WorkspaceDataScopeBlocker } from '@/lib/workspace-data-scope';

/** How long a blocking wait may last before its ways out are offered. */
export const BLOCKING_WAIT_RECOVERY_DELAY_MS = 30_000;

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
  message: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: space[2],
    margin: 0,
    paddingInline: space[3],
    paddingBlock: space[2],
    borderRadius: radius.medium,
    cornerShape: corner.shape,
    backgroundColor: `color-mix(in oklab, transparent, ${colors.destructive} 8%)`,
    fontSize: text.footnoteSize,
    lineHeight: text.footnoteLeading,
    color: colors.label,
  },
  messageMark: {
    flexShrink: 0,
    width: '14px',
    height: '14px',
    marginTop: '1px',
    color: colors.destructive,
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

function blockerOf(observation: WorkspaceDataScopeObservation): WorkspaceDataScopeBlocker | null {
  return observation.scope?.status === 'switching' ? observation.scope.blocker : null;
}

export type RecoveryDiagnosticsInput = {
  gate: string;
  observation: WorkspaceDataScopeObservation;
  waitedMs: number;
  connectionUiState: string;
  controlConnectionState: string;
  automaticCacheClearAt: number | null;
  lastLocalClear: LocalClearRecord | null;
  idleGapMs: number | null;
  environment: ReturnType<typeof collectErrorBoundaryEnvironment>;
  renderTrace: string | undefined;
};

const isoOrNever = (ms: number | null) => (ms === null ? 'never' : new Date(ms).toISOString());

/** The copyable report: which gate held, why, then the crash-report context. */
export function buildRecoveryDiagnostics(input: RecoveryDiagnosticsInput): string {
  const { observation, lastLocalClear } = input;
  const report = buildErrorBoundaryReport({
    error: `Lody did not open: ${input.gate}`,
    boundaryName: 'blocking-wait',
    environment: input.environment,
    renderTrace: input.renderTrace,
  });
  const fields: Array<[string, string | null]> = [
    ['Gate', input.gate],
    ['Workspace data blocker', blockerOf(observation) ?? 'none'],
    ['Workspace', observation.targetSlug],
    ['Runtime workspace id', observation.workspaceId],
    ['Organizations ready', observation.organizationsReady ? 'yes' : 'no'],
    ['Runtime init error', observation.runtimeInitErrorType],
    ['Doc metadata scan error', observation.docMetaScanErrorType],
    ['Waited', `${Math.round(input.waitedMs / 1000)}s`],
    [
      'Idle before launch',
      input.idleGapMs === null ? null : `${Math.round(input.idleGapMs / 3_600_000)}h`,
    ],
    ['Connection', `${input.connectionUiState} (control: ${input.controlConnectionState})`],
    ['Last automatic cache clear', isoOrNever(input.automaticCacheClearAt)],
    [
      'Last local clear',
      lastLocalClear === null
        ? 'never'
        : `${lastLocalClear.mode} at ${isoOrNever(lastLocalClear.atMs)}, ${
            lastLocalClear.ok ? 'complete' : `${lastLocalClear.failedCount} database(s) left`
          }, attempt ${lastLocalClear.attempts}`,
    ],
  ];
  const section = fields
    .filter((entry): entry is [string, string] => entry[1] !== null)
    .map(([label, value]) => `${label}: ${value}`)
    .join('\n');
  return [report.summary, section, report.details].filter(Boolean).join('\n\n');
}

function captureSafely(name: string, properties: PostHogAnalyticsProperties): void {
  try {
    capturePostHogEvent(deferredPostHog, name, properties);
  } catch {
    // Diagnostics must never stop a recovery.
  }
}

/**
 * One report per screen that offered the ways out: the blocking wait that ran
 * long or failed, and the error screen that had none of its own.
 */
export function reportRecoveryShown(
  gate: string,
  observation: WorkspaceDataScopeObservation,
  failed: boolean
): void {
  const blocker = blockerOf(observation);
  const lastLocalClear = readLastLocalClear();
  console.warn('[blocking-wait] offering recovery', { gate, blocker, failed });
  recordSessionRenderTrace(`blocking-wait recovery ${gate} ${blocker ?? '-'}`);
  captureSafely('workspace/boot_wait_stuck', {
    gate,
    failed,
    blocker,
    organizations_ready: observation.organizationsReady,
    doc_meta_scan_error_type: observation.docMetaScanErrorType,
    runtime_init_error_type: observation.runtimeInitErrorType,
    idle_gap_ms: readIdleGapMs(),
    app_version: collectClientBuildInfo().appVersion ?? null,
    last_local_clear_mode: lastLocalClear?.mode ?? null,
    last_local_clear_ok: lastLocalClear?.ok ?? null,
  });
  reportRecoveryOutcome('stuck_again', gate);
}

type RecoveryState = 'waiting' | 'repairing' | 'slow' | 'failed';

/**
 * A terminal workspace blocker claims the one automatic cache clear and
 * restarts into it — the clear runs at boot, before the runtime reopens the
 * databases it deletes. The cooldown in `armAutomaticCacheClear` bounds that to
 * one per day, so a second failure lands on the manual page instead of a
 * restart loop. Offline, nothing is cleared automatically: the damaged copy
 * could not be downloaded again.
 */
function useBlockingWaitRecovery(
  gate: string,
  observation: WorkspaceDataScopeObservation,
  delayMs: number
): RecoveryState {
  const online = useAtomValue(browserOnlineAtom);
  const blocker = blockerOf(observation);
  const failed = blocker !== null && isTerminalWorkspaceOpenBlocker(blocker);
  const [slow, setSlow] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const latestRef = useRef(observation);
  latestRef.current = observation;

  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), delayMs);
    return () => clearTimeout(timer);
  }, [delayMs]);

  useEffect(() => {
    if (!failed || !online) return;
    if (!armAutomaticCacheClear(Date.now())) return;
    const latest = latestRef.current;
    const properties = {
      gate,
      blocker: blockerOf(latest),
      workspace_id: latest.workspaceId,
      doc_meta_scan_error_type: latest.docMetaScanErrorType,
      runtime_init_error_type: latest.runtimeInitErrorType,
    };
    console.warn('[blocking-wait] clearing local cache automatically', properties);
    recordSessionRenderTrace(`blocking-wait auto cache clear ${String(properties.blocker)}`);
    captureSafely('workspace/auto_cache_clear', properties);
    setRepairing(true);
    void restartIntoCacheClear().then((started) => {
      if (!started) setRepairing(false);
    });
  }, [failed, gate, online]);

  const offered = !repairing && (failed || slow);
  // Once per screen state; a later change of blocker is in the copied diagnostics.
  useEffect(() => {
    if (offered) reportRecoveryShown(gate, latestRef.current, failed);
  }, [offered, gate, failed]);

  if (repairing) return 'repairing';
  if (failed) return 'failed';
  return slow ? 'slow' : 'waiting';
}

/**
 * Every screen that blocks the whole app or workspace while something loads.
 * It stays the ordinary spinner while the wait is ordinary, and becomes a
 * status page with the ways out — reload, clear the local cache, copy
 * diagnostics, wipe — once the wait has failed or outlasted `recoveryDelayMs`.
 * Those ways out otherwise live in Settings, which a person stuck here cannot
 * reach; a waiting screen without them is how users end up reinstalling.
 *
 * `gate` names the wait in reports, so a stuck user's report says which
 * condition never resolved.
 */
export function BlockingWaitPlaceholder({
  gate,
  variant,
  title,
  description,
  recoveryDelayMs = BLOCKING_WAIT_RECOVERY_DELAY_MS,
}: {
  gate: string;
  variant: 'content' | 'boot';
  title: string;
  description?: string;
  recoveryDelayMs?: number;
}) {
  const { t } = useTranslation();
  const observation = useWorkspaceDataScopeState();
  const state = useBlockingWaitRecovery(gate, observation, recoveryDelayMs);
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
    <RecoveryPage
      layout={variant === 'boot' ? 'window' : 'pane'}
      gate={gate}
      failed={state === 'failed'}
      observation={observation}
      waitStartedAt={waitStartedAt}
    />
  );
}

/** The ways out, once a wait has failed or run long. Exported for `RouteMessage` and stories. */
export function RecoveryPage({
  layout,
  gate,
  failed,
  observation,
  waitStartedAt,
}: {
  layout: 'window' | 'pane';
  gate: string;
  failed: boolean;
  observation: WorkspaceDataScopeObservation;
  waitStartedAt: number;
}) {
  const { t } = useTranslation();
  const connectionUiState = useAtomValue(lodyConnectionUiStateAtom);
  const controlConnectionState = useAtomValue(lodyControlConnectionStateAtom);
  const [clearOpen, setClearOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearNotStarted, setClearNotStarted] = useState(false);
  const [hardResetOpen, setHardResetOpen] = useState(false);
  const [hardResetting, setHardResetting] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [lastLocalClear] = useState(readLastLocalClear);

  const readDiagnostics = () =>
    buildRecoveryDiagnostics({
      gate,
      observation,
      waitedMs: Date.now() - waitStartedAt,
      connectionUiState,
      controlConnectionState,
      automaticCacheClearAt: readAutomaticCacheClearAt(),
      lastLocalClear: readLastLocalClear(),
      idleGapMs: readIdleGapMs(),
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

  // The URL already names this screen's destination, and a restart keeps it.
  const handleClear = useCallback(() => {
    setClearing(true);
    void restartIntoCacheClear().then((started) => {
      if (started) return;
      setClearing(false);
      setClearOpen(false);
      setClearNotStarted(true);
    });
  }, []);

  const handleHardReset = useCallback(() => {
    setHardResetting(true);
    void Promise.resolve(startHardReset()).catch(() => setHardResetting(false));
  }, []);

  const hasTarget = observation.targetSlug !== null;
  return (
    <StatusPage
      layout={layout}
      role={failed ? 'alert' : 'status'}
      illustration="broken"
      title={
        failed
          ? hasTarget
            ? t('workspace.route.recovery.failedTitle')
            : t('workspace.route.recovery.failedTitleGeneric')
          : hasTarget
            ? t('workspace.route.recovery.slowTitle')
            : t('workspace.route.recovery.slowTitleGeneric')
      }
      description={t('workspace.route.recovery.description')}
    >
      <StatusPageActions>
        <Button type="button" size="small" onClick={() => reloadApp()}>
          {t('errorBoundary.reload')}
        </Button>
        <Button type="button" variant="secondary" size="small" onClick={() => setClearOpen(true)}>
          {t('workspace.route.recovery.clearCache')}
        </Button>
        <Button type="button" variant="ghost" size="small" onClick={() => void handleCopy()}>
          {copied ? t('errorBoundary.copied') : t('workspace.route.recovery.copyDiagnostics')}
        </Button>
      </StatusPageActions>

      {clearNotStarted || (lastLocalClear !== null && !lastLocalClear.ok) ? (
        <p role="status" {...stylex.props(styles.message)}>
          <AlertTriangle {...stylex.props(styles.messageMark)} aria-hidden="true" />
          {t(
            clearNotStarted
              ? 'workspace.route.recovery.clearNotStarted'
              : 'workspace.route.recovery.clearIncomplete'
          )}
        </p>
      ) : null}

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

/** `RecoveryPage` for a screen that has already failed, outside any wait. */
export function FailedScreenRecovery({ gate }: { gate: string }) {
  const observation = useWorkspaceDataScopeState();
  const [shownAt] = useState(() => Date.now());
  return (
    <RecoveryPage
      layout="window"
      gate={gate}
      failed
      observation={observation}
      waitStartedAt={shownAt}
    />
  );
}
