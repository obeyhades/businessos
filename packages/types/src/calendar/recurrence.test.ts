import { describe, expect, it } from 'vitest';
import { expandOccurrences, seriesStarts, type RecurrenceSpec } from './recurrence.js';

/** UTC instant builder so every assertion below is timezone-independent. */
function utc(year: number, month1: number, day: number, hour = 0, minute = 0): Date {
  return new Date(Date.UTC(year, month1 - 1, day, hour, minute, 0, 0));
}

/** A recurrence spec with sensible defaults; override per test. */
function spec(
  overrides: Partial<RecurrenceSpec> & Pick<RecurrenceSpec, 'startsAt'>,
): RecurrenceSpec {
  return {
    freq: null,
    interval: 1,
    byWeekday: [],
    count: null,
    until: null,
    ...overrides,
  };
}

const HOUR_MS = 60 * 60 * 1000;

// 2026-01-05 is a Monday (UTC); 2026-01-07 a Wednesday. These fixed anchors keep
// every weekday-based assertion stable regardless of when the suite runs.
const MON = 1;
const WED = 3;

describe('expandOccurrences', () => {
  it('weekly by-weekday (Mon+Wed) yields both days each week in chronological order', () => {
    const s = spec({
      startsAt: utc(2026, 1, 5, 9), // Monday 09:00Z
      freq: 'WEEKLY',
      interval: 1,
      byWeekday: [WED, MON], // deliberately unsorted; expander must sort
    });
    // Three-week window: Jan 5..Jan 25 inclusive of the Jan 21 Wednesday.
    const occ = expandOccurrences(s, HOUR_MS, utc(2026, 1, 5), utc(2026, 1, 25));

    const starts = occ.map((o) => o.start.toISOString());
    expect(starts).toEqual([
      '2026-01-05T09:00:00.000Z',
      '2026-01-07T09:00:00.000Z',
      '2026-01-12T09:00:00.000Z',
      '2026-01-14T09:00:00.000Z',
      '2026-01-19T09:00:00.000Z',
      '2026-01-21T09:00:00.000Z',
    ]);
    // Every occurrence is a Monday or Wednesday at 09:00Z with a 1h duration.
    for (const o of occ) {
      expect([MON, WED]).toContain(o.start.getUTCDay());
      expect(o.start.getUTCHours()).toBe(9);
      expect(o.end.getTime() - o.start.getTime()).toBe(HOUR_MS);
    }
    // Strictly ascending.
    for (let i = 1; i < occ.length; i += 1) {
      expect(occ[i]!.start.getTime()).toBeGreaterThan(occ[i - 1]!.start.getTime());
    }
  });

  it('monthly-on-the-31st skips months that have no 31st (Feb/Apr/Jun)', () => {
    const s = spec({
      startsAt: utc(2026, 1, 31, 12), // Jan 31 12:00Z
      freq: 'MONTHLY',
      interval: 1,
    });
    const occ = expandOccurrences(s, HOUR_MS, utc(2026, 1, 1), utc(2026, 9, 1));
    const starts = occ.map((o) => o.start.toISOString());
    // Only 31-day months in the window: Jan, Mar, May, Jul, Aug.
    expect(starts).toEqual([
      '2026-01-31T12:00:00.000Z',
      '2026-03-31T12:00:00.000Z',
      '2026-05-31T12:00:00.000Z',
      '2026-07-31T12:00:00.000Z',
      '2026-08-31T12:00:00.000Z',
    ]);
    // Never rolls into Feb/Apr/Jun and always lands on the 31st.
    for (const o of occ) {
      expect(o.start.getUTCDate()).toBe(31);
      expect([1, 3, 5]).not.toContain(o.start.getUTCMonth()); // 1=Feb,3=Apr,5=Jun (0-based)
    }
  });

  it('daily with interval + count produces exactly `count` occurrences spaced by interval', () => {
    const s = spec({
      startsAt: utc(2026, 1, 5, 8),
      freq: 'DAILY',
      interval: 3,
      count: 4,
    });
    // Window far wider than the series so count is the only limiter.
    const occ = expandOccurrences(s, HOUR_MS, utc(2026, 1, 1), utc(2027, 1, 1));
    const starts = occ.map((o) => o.start.toISOString());
    expect(starts).toEqual([
      '2026-01-05T08:00:00.000Z',
      '2026-01-08T08:00:00.000Z',
      '2026-01-11T08:00:00.000Z',
      '2026-01-14T08:00:00.000Z',
    ]);
    // seriesStarts agrees on the count-bounded length.
    expect(seriesStarts(s)).toHaveLength(4);
  });

  it('weekly with an `until` bound stops at the last start <= until (inclusive semantics)', () => {
    const s = spec({
      startsAt: utc(2026, 1, 5, 9), // Monday
      freq: 'WEEKLY',
      interval: 1,
      byWeekday: [MON],
      until: utc(2026, 1, 26), // 00:00Z; the Jan 26 09:00 start is past this
    });
    const occ = expandOccurrences(s, HOUR_MS, utc(2026, 1, 1), utc(2027, 1, 1));
    const starts = occ.map((o) => o.start.toISOString());
    expect(starts).toEqual([
      '2026-01-05T09:00:00.000Z',
      '2026-01-12T09:00:00.000Z',
      '2026-01-19T09:00:00.000Z',
    ]);
  });

  it('single event (freq null) appears exactly once when the window overlaps, never otherwise', () => {
    const s = spec({ startsAt: utc(2026, 3, 10, 14) }); // 14:00Z, 2h long
    const twoHours = 2 * HOUR_MS;

    // Overlapping window.
    expect(expandOccurrences(s, twoHours, utc(2026, 3, 10), utc(2026, 3, 11))).toHaveLength(1);
    // Window entirely before the event.
    expect(expandOccurrences(s, twoHours, utc(2026, 3, 1), utc(2026, 3, 9))).toHaveLength(0);
    // Window entirely after the event.
    expect(expandOccurrences(s, twoHours, utc(2026, 3, 11), utc(2026, 3, 20))).toHaveLength(0);
  });

  it('yearly Feb-29 skips non-leap years, keeping only leap-year occurrences', () => {
    const s = spec({
      startsAt: utc(2024, 2, 29, 10), // 2024 is a leap year
      freq: 'YEARLY',
      interval: 1,
    });
    const occ = expandOccurrences(s, HOUR_MS, utc(2024, 1, 1), utc(2033, 1, 1));
    const starts = occ.map((o) => o.start.toISOString());
    expect(starts).toEqual([
      '2024-02-29T10:00:00.000Z',
      '2028-02-29T10:00:00.000Z',
      '2032-02-29T10:00:00.000Z',
    ]);
    for (const o of occ) {
      expect(o.start.getUTCMonth()).toBe(1); // February
      expect(o.start.getUTCDate()).toBe(29);
    }
  });

  it('range-overlap filter keeps an occurrence that starts before the window but overlaps into it', () => {
    // Daily 23:00Z event lasting 2h, so each occurrence spills into the next day.
    const s = spec({
      startsAt: utc(2026, 1, 1, 23),
      freq: 'DAILY',
      interval: 1,
    });
    const twoHours = 2 * HOUR_MS;
    // Narrow window on Jan 3 00:00..00:30 only overlaps the Jan 2 23:00 occurrence
    // (which runs to Jan 3 01:00). The Jan 3 23:00 occurrence starts after the window.
    const occ = expandOccurrences(s, twoHours, utc(2026, 1, 3, 0, 0), utc(2026, 1, 3, 0, 30));
    expect(occ).toHaveLength(1);
    expect(occ[0]!.start.toISOString()).toBe('2026-01-02T23:00:00.000Z');
    expect(occ[0]!.end.toISOString()).toBe('2026-01-03T01:00:00.000Z');
  });

  it('COUNT limits the whole series even when the query window starts mid-series', () => {
    const s = spec({
      startsAt: utc(2026, 1, 1, 0),
      freq: 'DAILY',
      interval: 1,
      count: 5, // Jan 1..Jan 5 only
    });
    // Window opens on Jan 3: a window-relative counter would wrongly emit Jan 3..7.
    // Because COUNT is a property of the whole series (counted from Jan 1), only
    // Jan 3, 4, 5 survive.
    const occ = expandOccurrences(s, HOUR_MS, utc(2026, 1, 3), utc(2026, 1, 31));
    const starts = occ.map((o) => o.start.toISOString());
    expect(starts).toEqual([
      '2026-01-03T00:00:00.000Z',
      '2026-01-04T00:00:00.000Z',
      '2026-01-05T00:00:00.000Z',
    ]);
    // The full series is exactly 5, none past Jan 5.
    const all = seriesStarts(s);
    expect(all).toHaveLength(5);
    expect(all[all.length - 1]!.toISOString()).toBe('2026-01-05T00:00:00.000Z');
  });
});

describe('seriesStarts', () => {
  it('honours an explicit limit for otherwise-unbounded series', () => {
    const s = spec({ startsAt: utc(2026, 1, 1), freq: 'DAILY', interval: 1 });
    expect(seriesStarts(s, 10)).toHaveLength(10);
  });

  it('returns a single start for a non-recurring spec', () => {
    const s = spec({ startsAt: utc(2026, 6, 1, 9) });
    const starts = seriesStarts(s);
    expect(starts).toHaveLength(1);
    expect(starts[0]!.toISOString()).toBe('2026-06-01T09:00:00.000Z');
  });
});
