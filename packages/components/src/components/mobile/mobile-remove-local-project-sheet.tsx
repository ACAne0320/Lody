import { useEffect, useRef, useState } from 'react';
import type { LocalProjectWorktreeCleanupPreflightResult } from '@lody/shared';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { Spinner } from '@lody/ui/spinner';
import * as stylex from '@stylexjs/stylex';

import { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerTitle } from '@/ui/drawer';
import { Button } from '@lody/ui/button';
import { Checkbox } from '@lody/ui/checkbox';
import { withClassName } from '@/lib/stylex';
import { themeColors } from '../../style/theme-colors.stylex';
import { themeFontWeight, themeRadius, themeSpace } from '../../style/theme-scale.stylex';
import { sheetSurface } from './sheet-surface';

export type MobileRemoveLocalProjectSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Project name, shown in the body. */
  projectName: string;
  /** Absolute path, shown under the description when available. */
  pathLabel?: string | null;
  /** Name of the device that owns the project. */
  deviceName?: string | null;
  /** Whether the owning device can begin processing the durable command now. */
  deviceOnline: boolean;
  /** Number of conversations that will move to Archive. */
  conversationCount: number;
  /** Number of active conversations that will be stopped. */
  runningSessionCount: number;
  canCleanupWorktrees: boolean;
  onPreflightCleanup: () => Promise<LocalProjectWorktreeCleanupPreflightResult>;
  /** Caller's destructive action. The sheet awaits it and shows a spinner on
     the remove button while it's in flight; it closes the sheet on success. */
  onConfirm: (options: { cleanupWorktrees: boolean }) => Promise<boolean>;
};

const styles = stylex.create({
  /** The sheet's description, under the header. */
  description: {
    paddingInline: themeSpace[4],
    paddingBottom: themeSpace[2],
    fontSize: '0.78rem',
    lineHeight: 1.625,
    color: themeColors.mutedForeground,
  },
  /** The device name inside the description. */
  descriptionDevice: {
    fontWeight: themeFontWeight.semibold,
    color: themeColors.foreground,
  },

  /** The sheet's body. */
  body: {
    paddingInline: themeSpace[4],
    paddingBottom: themeSpace[3],
    fontSize: '0.78rem',
    lineHeight: 1.625,
    color: themeColors.mutedForeground,
  },
  /** A block of the body, set apart from the next one. */
  bodyBlock: {
    marginTop: '0px',
    marginBottom: { default: '0px', ':not(:last-child)': '0.75rem' },
  },
  /** A paragraph inside a block. */
  bodyLine: {
    marginTop: '0px',
    marginBottom: { default: '0px', ':not(:last-child)': '0.25rem' },
  },
  /** The paragraph that leads the archive note. */
  archiveNote: { color: 'color-mix(in oklab, hsl(var(--foreground) / 1) 85%, transparent)' },

  /** The note that the original folder is never touched. */
  safeNote: {
    paddingInline: themeSpace[3],
    paddingTop: themeSpace[2.5],
    paddingBottom: themeSpace[2.5],
    borderRadius: themeRadius.lg,
    backgroundColor: 'color-mix(in oklab, hsl(var(--muted) / 1) 60%, transparent)',
  },
  safeNoteLead: {
    fontWeight: themeFontWeight.medium,
    color: 'color-mix(in oklab, hsl(var(--foreground) / 1) 90%, transparent)',
  },
  safeNotePath: {
    marginTop: themeSpace[1],
    wordBreak: 'break-all',
    fontFamily: 'var(--font-mono, ui-monospace, monospace)',
    fontSize: '0.7rem',
  },

  /** The cleanup option. */
  cleanupOption: {
    paddingInline: themeSpace[3],
    paddingTop: themeSpace[2.5],
    paddingBottom: themeSpace[2.5],
    borderRadius: themeRadius.lg,
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'color-mix(in oklab, hsl(var(--border) / 1) 70%, transparent)',
  },
  cleanupLabel: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: themeSpace[3],
  },
  cleanupTitle: {
    display: 'block',
    fontWeight: themeFontWeight.medium,
    color: themeColors.foreground,
  },
  cleanupHelper: {
    display: 'block',
    marginTop: themeSpace[1],
  },
  /** The preflight results, under the option. */
  cleanupResult: {
    marginTop: themeSpace[2],
    borderTopWidth: '1px',
    borderTopStyle: 'solid',
    paddingTop: themeSpace[2],
  },
  /** One line of the preflight results. */
  cleanupResultLine: {
    marginTop: '0px',
    marginBottom: { default: '0px', ':not(:last-child)': '0.25rem' },
  },
  cleanupError: { color: themeColors.destructive },
  /** Keep the existing Tailwind dark-theme scope for the dirty-worktree warning. */
  cleanupDirty: { color: 'var(--color-amber-700, oklch(55.5% 0.163 48.998))' },
  cleanupFailed: { color: themeColors.mutedForeground },
});

/**
 * Mobile-native bottom-sheet confirm for removing a local project, mirroring
 * `MobileDeleteWorkspaceSheet` but without the type-to-confirm guard: removing a
 * project only takes it out of Lody (the folder's files are not deleted), so a
 * single destructive button is enough.
 *
 * On mobile the project always lives on another device, so the body names that
 * device and the removal command is queued for it.
 */
export function MobileRemoveLocalProjectSheet({
  open,
  onOpenChange,
  projectName,
  pathLabel,
  deviceName,
  deviceOnline,
  conversationCount,
  runningSessionCount,
  canCleanupWorktrees,
  onPreflightCleanup,
  onConfirm,
}: MobileRemoveLocalProjectSheetProps) {
  const { t } = useTranslation();
  const [isRemoving, setIsRemoving] = useState(false);
  const [cleanupWorktrees, setCleanupWorktrees] = useState(false);
  const [preflight, setPreflight] = useState(
    null as LocalProjectWorktreeCleanupPreflightResult | null
  );
  const [preflightError, setPreflightError] = useState(null as string | null);
  const [isPreflighting, setIsPreflighting] = useState(false);
  const preflightGeneration = useRef(0);

  useEffect(() => {
    preflightGeneration.current += 1;
    setCleanupWorktrees(false);
    setPreflight(null);
    setPreflightError(null);
    setIsPreflighting(false);
  }, [open, projectName]);

  const device =
    deviceName?.trim() ||
    t('sidebar.localProjects.remove.remoteFallbackDevice', 'the other device');

  // Render the device name in bold within the translated sentence. We
  // interpolate a sentinel for {{device}} and split on it so the bold span
  // lands in the right spot regardless of the language's word order.
  const sentinel = String.fromCharCode(0);
  const [descBefore, descAfter = ''] = t(
    'sidebar.localProjects.remove.remoteDescription',
    'This removes the project from Lody on {{device}}.',
    { device: sentinel }
  ).split(sentinel);

  const handleRemove = async () => {
    if (isRemoving) return;
    setIsRemoving(true);
    try {
      const removed = await onConfirm({ cleanupWorktrees });
      if (removed) onOpenChange(false);
    } finally {
      setIsRemoving(false);
    }
  };

  const handleCleanupChange = async (checked: boolean) => {
    const generation = ++preflightGeneration.current;
    setCleanupWorktrees(checked);
    setPreflight(null);
    setPreflightError(null);
    if (!checked) return;
    setIsPreflighting(true);
    try {
      const result = await onPreflightCleanup();
      if (preflightGeneration.current === generation) setPreflight(result);
    } catch (error) {
      if (preflightGeneration.current === generation) {
        setPreflightError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (preflightGeneration.current === generation) setIsPreflighting(false);
    }
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange} repositionInputs={false}>
      <DrawerContent className="mobile-remove-local-project-sheet h-auto! max-h-[92dvh]! rounded-t-2xl border-border/60">
        <div {...stylex.props(sheetSurface.columnAuto)}>
          <header {...stylex.props(sheetSurface.header, sheetSurface.headerWide)}>
            <DrawerTitle {...stylex.props(sheetSurface.title, sheetSurface.titleFull)}>
              {t('sidebar.localProjects.remove.title', 'Remove “{{name}}” from Lody?', {
                name: projectName,
              })}
            </DrawerTitle>
            <DrawerClose asChild>
              <button
                type="button"
                aria-label={t('common.close', 'Close')}
                disabled={isRemoving}
                {...stylex.props(
                  sheetSurface.iconButton,
                  sheetSurface.iconButtonRight,
                  sheetSurface.iconButtonDisabled
                )}
              >
                <X {...stylex.props(sheetSurface.glyph20)} aria-hidden="true" strokeWidth={1.8} />
              </button>
            </DrawerClose>
          </header>

          {/* The drawer's own description carries a body size; the
              description's own size stays a Tailwind class so it keeps
              winning over it. */}
          <DrawerDescription {...withClassName(stylex.props(styles.description), 'text-[0.78rem]')}>
            {descBefore}
            <span {...stylex.props(styles.descriptionDevice)}>{device}</span>
            {descAfter}
            {!deviceOnline ? (
              <>
                {' '}
                {t(
                  'sidebar.localProjects.remove.offline',
                  'The device is offline; removal starts when it reconnects.'
                )}
              </>
            ) : null}
          </DrawerDescription>

          <div {...stylex.props(styles.body)}>
            <div {...stylex.props(styles.bodyBlock)}>
              <p {...stylex.props(styles.bodyLine, styles.archiveNote)}>
                {conversationCount > 0
                  ? t('sidebar.localProjects.remove.archiveDescription', {
                      count: conversationCount,
                    })
                  : t(
                      'sidebar.localProjects.remove.archiveDescriptionEmpty',
                      'Any conversations in this project will move to Archive.'
                    )}
              </p>
              {runningSessionCount > 0 ? (
                <p {...stylex.props(styles.bodyLine)}>
                  {t('sidebar.localProjects.remove.runningSessionsSummary', {
                    count: runningSessionCount,
                  })}
                </p>
              ) : null}
            </div>
            <div {...stylex.props(styles.bodyBlock, styles.safeNote)}>
              <p {...stylex.props(styles.safeNoteLead)}>
                {t(
                  'sidebar.localProjects.remove.originalDirectorySafe',
                  'Lody never deletes the original project folder or its files.'
                )}
              </p>
              {pathLabel ? <p {...stylex.props(styles.safeNotePath)}>{pathLabel}</p> : null}
            </div>
            <div {...stylex.props(styles.bodyBlock, styles.cleanupOption)}>
              <label {...stylex.props(styles.cleanupLabel)}>
                <Checkbox
                  className="mt-0.5"
                  checked={cleanupWorktrees}
                  disabled={!canCleanupWorktrees || isRemoving}
                  onCheckedChange={(checked) => void handleCleanupChange(checked)}
                />
                <span>
                  <span {...stylex.props(styles.cleanupTitle)}>
                    {t(
                      'sidebar.localProjects.remove.cleanupWorktrees',
                      'Also delete session worktrees created by Lody'
                    )}
                  </span>
                  <span {...stylex.props(styles.cleanupHelper)}>
                    {canCleanupWorktrees
                      ? t(
                          'sidebar.localProjects.remove.cleanupWorktreesHelper',
                          'Only clean worktrees are deleted. Worktrees with changes stay on disk.'
                        )
                      : t(
                          'sidebar.localProjects.remove.cleanupUnavailable',
                          'Connect the device to inspect worktrees. You can still remove the project.'
                        )}
                  </span>
                </span>
              </label>
              {cleanupWorktrees ? (
                <div {...stylex.props(styles.cleanupResult)}>
                  {isPreflighting
                    ? t(
                        'sidebar.localProjects.remove.checkingWorktrees',
                        'Checking each worktree for changes…'
                      )
                    : null}
                  {preflightError ? (
                    <p {...stylex.props(styles.cleanupError)}>{preflightError}</p>
                  ) : null}
                  {preflight ? (
                    <div>
                      <p {...stylex.props(styles.cleanupResultLine)}>
                        {t('sidebar.localProjects.remove.cleanWorktreesSummary', {
                          count: preflight.clean.length,
                        })}
                      </p>
                      {preflight.dirty.length > 0 ? (
                        <p
                          {...withClassName(
                            stylex.props(styles.cleanupResultLine, styles.cleanupDirty),
                            'dark:text-amber-300'
                          )}
                        >
                          {t('sidebar.localProjects.remove.dirtyWorktreesSummary', {
                            count: preflight.dirty.length,
                          })}
                          : {preflight.dirty.map((item) => item.title).join(', ')}
                        </p>
                      ) : null}
                      {preflight.failed.length > 0 ? (
                        <p {...stylex.props(styles.cleanupResultLine, styles.cleanupFailed)}>
                          {t('sidebar.localProjects.remove.inspectFailedSummary', {
                            count: preflight.failed.length,
                          })}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>

          <div {...stylex.props(sheetSurface.footer, sheetSurface.footerPadSafe)}>
            <Button
              type="button"
              variant="secondary"
              className="flex-1"
              onClick={() => onOpenChange(false)}
              disabled={isRemoving}
            >
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="flex-1"
              onClick={() => void handleRemove()}
              disabled={isRemoving || (cleanupWorktrees && (isPreflighting || !preflight))}
            >
              {isRemoving ? (
                <>
                  <Spinner className="mr-1.5 h-3.5 w-3.5" />
                  {t('common.processing', 'Processing...')}
                </>
              ) : (
                t('sidebar.localProjects.remove.confirm', 'Remove project')
              )}
            </Button>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
