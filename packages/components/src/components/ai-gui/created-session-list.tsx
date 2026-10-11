import { useId, useState } from 'react';
import * as stylex from '@stylexjs/stylex';
import { Button } from '@lody/ui/button';
import { space } from '@lody/ui/tokens/scales.stylex';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ComponentProps } from 'react';
import type { SessionHistoryParsed } from '@lody/shared';
import { withClassName } from '@/lib/stylex';
import { CreatedSessionOperationCard } from './created-session-operation-card';

type Card = Omit<ComponentProps<typeof CreatedSessionOperationCard>, 'onNavigateSession'>;

/** Only pure creation records may coalesce; notices and failures keep their own rows. */
export function getCreatedSessionCards(message: SessionHistoryParsed): Card[] | null {
  if (message.role !== 'system' || message.items.length === 0) return null;
  const cards: Card[] = [];
  for (const item of message.items) {
    if (item.type === 'operation_progress') {
      cards.push(
        ...item.items.map((entry) => ({
          sessionId: entry.target.sessionId,
          fallbackTitle: entry.label,
          status: entry.status,
        }))
      );
    } else if (
      item.type === 'operation_completion' &&
      (item.operationKind === 'session_create' || item.operationKind === 'session_create_many') &&
      !item.progressMessageId &&
      !item.continuation &&
      item.completion.type === 'result' &&
      item.completion.value.items.length > 0 &&
      item.completion.value.items.every((entry) => entry.target && entry.status === 'succeeded')
    ) {
      for (const entry of item.completion.value.items) {
        if (entry.target)
          cards.push({
            sessionId: entry.target.sessionId,
            fallbackTitle: entry.label,
            status: 'succeeded',
            detail:
              entry.status === 'succeeded'
                ? summarizeOperationOutput(entry.output?.text)
                : undefined,
          });
      }
    } else return null;
  }
  return cards.length ? cards : null;
}

const styles = stylex.create({
  root: { display: 'flex', flexDirection: 'column', minWidth: 0, gap: space[2] },
  list: { display: 'flex', flexDirection: 'column', minWidth: 0, gap: space[2] },
  bounded: {
    // The relation card is 32px tall; four gaps leave exactly five cards visible.
    maxHeight: `calc(160px + 4 * ${space[2]})`,
    overflowY: 'auto',
    scrollbarGutter: 'stable',
    overscrollBehaviorY: 'contain',
  },
  toggle: { alignSelf: 'flex-start' },
});

export function CreatedSessionList({
  cards,
  onNavigateSession,
}: {
  cards: readonly Card[];
  onNavigateSession?: ComponentProps<typeof CreatedSessionOperationCard>['onNavigateSession'];
}) {
  const { t } = useTranslation();
  const id = useId();
  const [expanded, setExpanded] = useState(false);
  const overflowing = cards.length > 5;
  if (cards.length === 0) return null;
  return (
    <div {...stylex.props(styles.root)} data-created-session-list="">
      <div
        id={id}
        {...withClassName(
          stylex.props(styles.list, overflowing && !expanded && styles.bounded),
          'scrollbar-pro'
        )}
        data-vaul-no-drag=""
        tabIndex={overflowing && !expanded ? 0 : undefined}
        role="region"
        aria-label={t('sessions.openedBy.childCount', { count: cards.length })}
      >
        {cards.map((card, index) => (
          <CreatedSessionOperationCard
            key={`${card.sessionId}-${index}`}
            {...card}
            onNavigateSession={onNavigateSession}
          />
        ))}
      </div>
      {overflowing ? (
        <div {...stylex.props(styles.toggle)}>
          <Button
            variant="ghost"
            size="small"
            aria-expanded={expanded}
            aria-controls={id}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            {t(
              expanded ? 'sessions.openedBy.collapseChildren' : 'sessions.openedBy.expandChildren',
              { count: cards.length }
            )}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** One readable line from a reply preview: collapsed whitespace, capped length. */
export const summarizeOperationOutput = (text: string | undefined): string | undefined => {
  const collapsed = text?.replace(/\s+/g, ' ').trim();
  if (!collapsed) return undefined;
  return collapsed.length > 240 ? `${collapsed.slice(0, 240)}…` : collapsed;
};
