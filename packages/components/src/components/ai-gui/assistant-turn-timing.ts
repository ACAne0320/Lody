import type { SessionHistoryParsed } from '@lody/shared';
import type { DurationUnitLabels } from '@/lib/format-duration';
import {
  resolveLiveSessionHistoryDurationMs,
  resolveSessionHistoryDurationMs,
} from '@/lib/session-history-duration';

/**
 * Silence on a live turn after which its "Last update" reads as a weak
 * warning: long enough that a token stream has clearly paused, short enough to
 * flag a stuck turn before the user gives up on it. A long command run can
 * cross it legitimately, so the warning says "may", never "stuck".
 */
export const TURN_LAST_UPDATE_STALE_MS = 60_000;

/** Silence after which the live status line itself says "no output for …". */
export const TURN_SILENCE_NOTICE_MS = 2 * 60_000;

export type AssistantTurnTimingMessage = Pick<
  SessionHistoryParsed,
  'timestamp' | 'startedAt' | 'endedAt' | 'permissionWaitMs'
>;

/**
 * Timing facts for the turn-configuration popover, in display order. Kept as
 * data so the clock and locale stay with the caller.
 *
 * - `started`: the turn's start; `runningMs` is set while the turn is live.
 * - `ended` / `duration`: a turn that is no longer live and recorded `endedAt`.
 *   `duration` is the same quantity as the "Worked for" label.
 * - `lastUpdate`: live turns only; `sinceMs` is `null` until this view has
 *   received a history update since it opened.
 */
export type AssistantTurnTimingRow =
  | { kind: 'started'; atMs: number; runningMs: number | null }
  | { kind: 'ended'; atMs: number }
  | { kind: 'duration'; durationMs: number }
  | { kind: 'lastUpdate'; sinceMs: number | null; stale: boolean };

const finiteNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/** `startedAt` when recorded, else the turn's `timestamp` (older entries carry only that). */
export const resolveAssistantTurnStartMs = (message: AssistantTurnTimingMessage): number | null => {
  const startedAt = finiteNumber(message.startedAt);
  if (startedAt !== null) return startedAt;
  const parsed = Date.parse(message.timestamp);
  return Number.isFinite(parsed) ? parsed : null;
};

export const buildAssistantTurnTimingRows = (
  message: AssistantTurnTimingMessage,
  {
    isLive,
    nowMs,
    lastUpdateAt,
  }: {
    /** The conversation's newest assistant turn, still unfinished. */
    isLive: boolean;
    nowMs: number;
    /** `ConversationView.lastUpdateAt`. */
    lastUpdateAt: number | null;
  }
): AssistantTurnTimingRow[] => {
  const rows: AssistantTurnTimingRow[] = [];
  const startMs = resolveAssistantTurnStartMs(message);
  if (startMs !== null) {
    rows.push({
      kind: 'started',
      atMs: startMs,
      runningMs: isLive ? resolveLiveSessionHistoryDurationMs(message, nowMs) : null,
    });
  }
  if (isLive) {
    const sinceMs = lastUpdateAt === null ? null : Math.max(0, nowMs - lastUpdateAt);
    rows.push({
      kind: 'lastUpdate',
      sinceMs,
      stale: sinceMs !== null && sinceMs >= TURN_LAST_UPDATE_STALE_MS,
    });
    return rows;
  }
  const endedAt = finiteNumber(message.endedAt);
  if (endedAt === null) return rows;
  rows.push({ kind: 'ended', atMs: endedAt });
  const durationMs = resolveSessionHistoryDurationMs(message);
  if (durationMs !== null) rows.push({ kind: 'duration', durationMs });
  return rows;
};

/**
 * How long a live turn has gone without a history update, once that reaches
 * {@link TURN_SILENCE_NOTICE_MS}; otherwise `null`, including before the first
 * update since opening (no evidence either way).
 */
export const resolveTurnSilenceMs = (lastUpdateAt: number | null, nowMs: number): number | null => {
  if (lastUpdateAt === null || !Number.isFinite(nowMs)) return null;
  const silence = nowMs - lastUpdateAt;
  return silence >= TURN_SILENCE_NOTICE_MS ? silence : null;
};

/** Whole minutes ("4m", "1h 05m"): a silence notice that ticks every second reads as noise. */
export const formatSilenceCompact = (durationMs: number, units: DurationUnitLabels): string => {
  if (!Number.isFinite(durationMs) || durationMs < 0) return '';
  const sep = units.separator ?? ' ';
  const totalMinutes = Math.floor(durationMs / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) {
    return `${hours}${units.hour}${sep}${String(minutes).padStart(2, '0')}${units.minute}`;
  }
  return `${minutes}${units.minute}`;
};

const CLOCK_FORMATS = {
  time: { hour: '2-digit', minute: '2-digit', second: '2-digit' },
  monthDayTime: {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  },
  fullDateTime: {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  },
  full: { dateStyle: 'full', timeStyle: 'long' },
  /** `en-CA` renders this as `YYYY-MM-DD`: a comparable calendar-day key. */
  dayKey: { year: 'numeric', month: '2-digit', day: '2-digit' },
} satisfies Record<string, Intl.DateTimeFormatOptions>;

const clockFormatters = new Map<string, Intl.DateTimeFormat>();

const clockFormatter = (
  locale: string | undefined,
  kind: keyof typeof CLOCK_FORMATS,
  timeZone: string | undefined
): Intl.DateTimeFormat => {
  const key = `${locale ?? ''}|${kind}|${timeZone ?? ''}`;
  let formatter = clockFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, { ...CLOCK_FORMATS[kind], timeZone });
    clockFormatters.set(key, formatter);
  }
  return formatter;
};

/** Calendar day of `ms` in `timeZone` (the runtime's local zone when omitted). */
const calendarDay = (ms: number, timeZone: string | undefined): string =>
  clockFormatter('en-CA', 'dayKey', timeZone).format(ms);

/**
 * A turn instant in the user's local time: seconds-precise because the popover
 * exists to judge liveness. Today's instants show the time alone; other days
 * add the date (and the year when it differs). `full` is the hover text,
 * including the weekday and time zone. `timeZone` exists for tests only.
 */
export const formatTurnClockTime = (
  ms: number,
  { locale, nowMs, timeZone }: { locale: string | undefined; nowMs: number; timeZone?: string }
): { short: string; full: string } => {
  if (!Number.isFinite(ms)) return { short: '', full: '' };
  const full = clockFormatter(locale, 'full', timeZone).format(ms);
  const day = calendarDay(ms, timeZone);
  const today = calendarDay(nowMs, timeZone);
  if (day === today) return { short: clockFormatter(locale, 'time', timeZone).format(ms), full };
  const sameYear = day.slice(0, 4) === today.slice(0, 4);
  return {
    short: clockFormatter(locale, sameYear ? 'monthDayTime' : 'fullDateTime', timeZone).format(ms),
    full,
  };
};
