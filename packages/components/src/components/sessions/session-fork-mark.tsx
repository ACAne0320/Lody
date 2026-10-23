import { useMemo, type MouseEvent } from 'react';
import { useAtomValue } from 'jotai';
import { selectAtom } from 'jotai/utils';
import { GitFork } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getSessionRoomId, type SessionId, type SessionMeta } from '@lody/shared';
import { Tooltip } from '@lody/ui/tooltip';

import { sessionMetaAtomFamily } from '@/atoms/doc-meta';
import { cn } from '@/lib/utils';

type ForkSourceView = { title: string | null; parentSessionId: string | null };

const selectForkSource = (session: SessionMeta | null | undefined): ForkSourceView => ({
  title: session?.title?.trim() || null,
  parentSessionId: session?.parentSessionId ?? null,
});

const forkSourceEqual = (a: ForkSourceView, b: ForkSourceView) =>
  a.title === b.title && a.parentSessionId === b.parentSessionId;

/** Live title and tab parent of the fork source; nulls while unknown / deleted. */
function useForkSource(sourceSessionId: string): ForkSourceView {
  const sourceAtom = useMemo(
    () =>
      selectAtom(
        sessionMetaAtomFamily(getSessionRoomId(sourceSessionId as SessionId)),
        selectForkSource,
        forkSourceEqual
      ),
    [sourceSessionId]
  );
  return useAtomValue(sourceAtom);
}

export type SessionForkMarkProps = {
  /** `SessionMeta.forkedFromSessionId` of the row/tab being rendered. */
  forkedFromSessionId: string;
  /**
   * Navigates to the fork source; omitted renders a tooltip-only mark. When the source is a child Tab, `sessionId`
   * is its root Session (the route) and `tabSessionId` the exact Tab. 
   * `interactive={false}` renders a plain decorative icon, e.g. on touch layouts where hover tooltips do not
   * exist and the whole row is the tap target.
   */
  onNavigate?: (sessionId: string, tabSessionId?: string) => void;
  interactive?: boolean;
  className?: string;
};

/**
 * Fork provenance mark rendered before a conversation title. Replaces the
 * legacy `(fork) ` title prefix: hovering shows the source conversation's
 * title, clicking opens it. It sits above row overlay anchors (`z-20`) and
 * stops propagation so it never also selects the row it lives in.
 */
export function SessionForkMark({
  forkedFromSessionId,
  onNavigate,
  interactive = true,
  className,
}: SessionForkMarkProps) {
  const { t } = useTranslation();
  const { title: sourceTitle, parentSessionId } = useForkSource(forkedFromSessionId);
  const label = sourceTitle
    ? t('sessions.forkedFrom', 'Forked from {{title}}', { title: sourceTitle })
    : t('sessions.forkedFromUnknown', 'Forked conversation');
  const iconClassName = cn('h-3 w-3 shrink-0 text-sidebar-foreground-muted/80', className);

  if (!interactive) {
    return <GitFork aria-label={label} role="img" className={iconClassName} />;
  }

  if (!onNavigate) {
    // Tooltip only: the source is known but this surface cannot open it.
    return (
      <Tooltip.Root>
        <Tooltip.Trigger
          render={
            <span
              aria-label={label}
              role="img"
              data-session-fork-mark=""
              className="relative z-20 inline-flex shrink-0 items-center"
            />
          }
        >
          <GitFork aria-hidden="true" className={iconClassName} />
        </Tooltip.Trigger>
        <Tooltip.Content side="bottom">{label}</Tooltip.Content>
      </Tooltip.Root>
    );
  }

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (parentSessionId) onNavigate(parentSessionId, forkedFromSessionId);
    else onNavigate(forkedFromSessionId);
  };

  return (
    <Tooltip.Root>
      <Tooltip.Trigger
        render={
          <button
            type="button"
            aria-label={label}
            data-session-fork-mark=""
            className="relative z-20 inline-flex shrink-0 cursor-pointer items-center justify-center rounded-sm p-0 text-sidebar-foreground-muted/80 hover:text-sidebar-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
            onClick={handleClick}
            onPointerDown={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
          />
        }
      >
        <GitFork aria-hidden="true" className={cn('h-3 w-3 shrink-0', className)} />
      </Tooltip.Trigger>
      <Tooltip.Content side="bottom">{label}</Tooltip.Content>
    </Tooltip.Root>
  );
}
