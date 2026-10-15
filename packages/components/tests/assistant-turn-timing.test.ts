import { describe, expect, it } from 'vitest';
import {
  buildAssistantTurnTimingRows,
  formatSilenceCompact,
  formatTurnClockTime,
  resolveTurnSilenceMs,
  TURN_LAST_UPDATE_STALE_MS,
  TURN_SILENCE_NOTICE_MS,
} from '../src/components/ai-gui/assistant-turn-timing';

const OPENED = '2026-10-15T10:41:02.000Z';
const OPENED_MS = Date.parse(OPENED);
const UNITS = { hour: 'h', minute: 'm', second: 's', separator: ' ' };

describe('buildAssistantTurnTimingRows', () => {
  it('reports a live turn as started, running and last updated', () => {
    const nowMs = OPENED_MS + 372_000;
    const rows = buildAssistantTurnTimingRows(
      { timestamp: OPENED, startedAt: OPENED_MS },
      { isLive: true, nowMs, lastUpdateAt: nowMs - 12_000 }
    );
    expect(rows).toEqual([
      { kind: 'started', atMs: OPENED_MS, runningMs: 372_000 },
      { kind: 'lastUpdate', sinceMs: 12_000, stale: false },
    ]);
  });

  it('flags a live turn silent past the threshold, and shows no age before any update', () => {
    const nowMs = OPENED_MS + 600_000;
    const stale = buildAssistantTurnTimingRows(
      { timestamp: OPENED },
      { isLive: true, nowMs, lastUpdateAt: nowMs - TURN_LAST_UPDATE_STALE_MS }
    );
    expect(stale.at(-1)).toEqual({
      kind: 'lastUpdate',
      sinceMs: TURN_LAST_UPDATE_STALE_MS,
      stale: true,
    });
    const unseen = buildAssistantTurnTimingRows(
      { timestamp: OPENED },
      { isLive: true, nowMs, lastUpdateAt: null }
    );
    expect(unseen.at(-1)).toEqual({ kind: 'lastUpdate', sinceMs: null, stale: false });
  });

  it('reports a finished turn as started, ended and its Worked-for duration, without liveness', () => {
    const rows = buildAssistantTurnTimingRows(
      { timestamp: OPENED, endedAt: OPENED_MS + 90_000, permissionWaitMs: 30_000 },
      { isLive: false, nowMs: OPENED_MS + 3_600_000, lastUpdateAt: OPENED_MS + 90_000 }
    );
    expect(rows).toEqual([
      { kind: 'started', atMs: OPENED_MS, runningMs: null },
      { kind: 'ended', atMs: OPENED_MS + 90_000 },
      // Same quantity as "Worked for": the permission wait is not work.
      { kind: 'duration', durationMs: 60_000 },
    ]);
  });

  it('falls back to timestamp when startedAt is missing and tolerates missing fields', () => {
    expect(
      buildAssistantTurnTimingRows(
        { timestamp: OPENED },
        { isLive: false, nowMs: OPENED_MS, lastUpdateAt: null }
      )
    ).toEqual([{ kind: 'started', atMs: OPENED_MS, runningMs: null }]);
    expect(
      buildAssistantTurnTimingRows(
        { timestamp: 'not-a-date', endedAt: OPENED_MS },
        { isLive: false, nowMs: OPENED_MS, lastUpdateAt: null }
      )
    ).toEqual([{ kind: 'ended', atMs: OPENED_MS }]);
  });

  it('prefers a recorded startedAt over the entry timestamp for the start row', () => {
    const rows = buildAssistantTurnTimingRows(
      { timestamp: OPENED, startedAt: OPENED_MS + 2_000 },
      { isLive: false, nowMs: OPENED_MS, lastUpdateAt: null }
    );
    expect(rows[0]).toEqual({ kind: 'started', atMs: OPENED_MS + 2_000, runningMs: null });
  });
});

describe('resolveTurnSilenceMs', () => {
  it('stays quiet below the notice threshold and before any update', () => {
    expect(resolveTurnSilenceMs(null, OPENED_MS)).toBeNull();
    expect(resolveTurnSilenceMs(OPENED_MS, OPENED_MS + TURN_SILENCE_NOTICE_MS - 1)).toBeNull();
    expect(resolveTurnSilenceMs(OPENED_MS, OPENED_MS + 250_000)).toBe(250_000);
  });

  it('formats the silence in whole minutes', () => {
    expect(formatSilenceCompact(250_000, UNITS)).toBe('4m');
    expect(formatSilenceCompact(3_900_000, UNITS)).toBe('1h 05m');
  });
});

describe('formatTurnClockTime', () => {
  const zone = 'Asia/Shanghai';

  it("shows only the time for today's instants, in the given zone", () => {
    const clock = formatTurnClockTime(OPENED_MS, {
      locale: 'en-GB',
      nowMs: OPENED_MS + 60_000,
      timeZone: zone,
    });
    expect(clock.short).toBe('18:41:02');
    expect(clock.full).toContain('18:41:02');
    expect(clock.full).toContain('Thursday');
  });

  it('adds the date across a local midnight even when less than a day has passed', () => {
    // 23:30 local on the 14th, viewed at 00:10 local on the 15th.
    const lateNight = Date.parse('2026-10-14T15:30:00.000Z');
    const clock = formatTurnClockTime(lateNight, {
      locale: 'en-GB',
      nowMs: Date.parse('2026-10-14T16:10:00.000Z'),
      timeZone: zone,
    });
    expect(clock.short).toBe('14 Oct, 23:30:00');
  });

  it('adds the year for an instant from another year', () => {
    const clock = formatTurnClockTime(Date.parse('2025-12-31T02:00:00.000Z'), {
      locale: 'en-GB',
      nowMs: OPENED_MS,
      timeZone: zone,
    });
    expect(clock.short).toContain('2025');
  });
});
