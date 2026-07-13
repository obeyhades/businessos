/**
 * Deterministic recurrence expansion. Occurrences recur on UTC calendar units
 * (day/week/month/year) preserving the series start's UTC time-of-day. This is
 * simple and exact in UTC; DST-correct *local* recurrence (keeping a fixed wall
 * time across a DST boundary) is a documented future enhancement — see
 * docs/legal-review-required.md / architecture notes.
 *
 * COUNT and UNTIL are properties of the whole series (not the queried window),
 * so expansion always iterates from the series start and then filters to the
 * range. A hard iteration cap prevents runaway loops on unbounded series.
 */

export type RecurrenceFrequency = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';

export interface RecurrenceSpec {
  /** First occurrence start (UTC instant). */
  startsAt: Date;
  /** null → single, non-recurring event. */
  freq: RecurrenceFrequency | null;
  /** Every `interval` units. Coerced to >= 1. */
  interval: number;
  /** For WEEKLY: UTC weekdays (0=Sun … 6=Sat). Empty → the start's weekday. */
  byWeekday: number[];
  /** Total number of occurrences in the series (inclusive), or null. */
  count: number | null;
  /** Last possible occurrence start (UTC), inclusive, or null. */
  until: Date | null;
}

export interface Occurrence {
  start: Date;
  end: Date;
}

/** Safety bound: at most this many series occurrences are ever enumerated. */
export const MAX_OCCURRENCES = 3660;

function addUtcDays(d: Date, days: number): Date {
  return new Date(
    Date.UTC(
      d.getUTCFullYear(),
      d.getUTCMonth(),
      d.getUTCDate() + days,
      d.getUTCHours(),
      d.getUTCMinutes(),
      d.getUTCSeconds(),
      d.getUTCMilliseconds(),
    ),
  );
}

/** Add months preserving the day-of-month; returns null if the day rolls over
 *  (e.g. Jan 31 + 1 month), which RRULE skips. */
function addUtcMonths(d: Date, months: number): Date | null {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + months;
  const targetYear = y + Math.floor(m / 12);
  const targetMonth = ((m % 12) + 12) % 12;
  const day = d.getUTCDate();
  const candidate = new Date(
    Date.UTC(
      targetYear,
      targetMonth,
      day,
      d.getUTCHours(),
      d.getUTCMinutes(),
      d.getUTCSeconds(),
      d.getUTCMilliseconds(),
    ),
  );
  return candidate.getUTCMonth() === targetMonth ? candidate : null;
}

function addUtcYears(d: Date, years: number): Date | null {
  const candidate = new Date(
    Date.UTC(
      d.getUTCFullYear() + years,
      d.getUTCMonth(),
      d.getUTCDate(),
      d.getUTCHours(),
      d.getUTCMinutes(),
      d.getUTCSeconds(),
      d.getUTCMilliseconds(),
    ),
  );
  // Feb 29 → non-leap year rolls to Mar 1: skip it.
  return candidate.getUTCMonth() === d.getUTCMonth() ? candidate : null;
}

/**
 * Generates series occurrence starts in chronological order via a callback,
 * stopping when `emit` returns false. Applies interval/byWeekday/count/until
 * and the hard cap. Times-of-day come from the series start.
 */
function forEachStart(spec: RecurrenceSpec, emit: (start: Date) => boolean): void {
  const interval = Math.max(1, Math.floor(spec.interval || 1));
  let produced = 0;
  let iterations = 0;

  const tryEmit = (start: Date): boolean => {
    if (spec.until && start.getTime() > spec.until.getTime()) return false;
    if (spec.count != null && produced >= spec.count) return false;
    produced += 1;
    return emit(start);
  };

  if (!spec.freq) {
    tryEmit(spec.startsAt);
    return;
  }

  if (spec.freq === 'WEEKLY') {
    const weekdays = (spec.byWeekday.length > 0 ? spec.byWeekday : [spec.startsAt.getUTCDay()])
      .filter((w) => w >= 0 && w <= 6)
      .sort((a, b) => a - b);
    if (weekdays.length === 0) return;
    // Anchor to the Sunday of the series-start week, then step interval weeks.
    const weekAnchor = addUtcDays(spec.startsAt, -spec.startsAt.getUTCDay());
    for (let week = 0; ; week += interval) {
      const base = addUtcDays(weekAnchor, week * 7);
      for (const wd of weekdays) {
        const start = addUtcDays(base, wd);
        if (start.getTime() < spec.startsAt.getTime()) continue; // before series start
        if (++iterations > MAX_OCCURRENCES) return;
        if (!tryEmit(start)) return;
      }
      if (iterations > MAX_OCCURRENCES) return;
    }
  }

  // DAILY / MONTHLY / YEARLY: one candidate per step.
  for (let n = 0; ; n += 1) {
    if (++iterations > MAX_OCCURRENCES) return;
    let start: Date | null;
    if (spec.freq === 'DAILY') start = addUtcDays(spec.startsAt, n * interval);
    else if (spec.freq === 'MONTHLY') start = addUtcMonths(spec.startsAt, n * interval);
    else start = addUtcYears(spec.startsAt, n * interval); // YEARLY
    if (start === null) continue; // skipped invalid calendar day
    if (!tryEmit(start)) return;
  }
}

/**
 * Returns every occurrence (start+end) that OVERLAPS [rangeStart, rangeEnd].
 * `durationMs` is applied to each start. Sorted ascending by start.
 */
export function expandOccurrences(
  spec: RecurrenceSpec,
  durationMs: number,
  rangeStart: Date,
  rangeEnd: Date,
): Occurrence[] {
  const out: Occurrence[] = [];
  const rangeStartMs = rangeStart.getTime();
  const rangeEndMs = rangeEnd.getTime();
  forEachStart(spec, (start) => {
    const startMs = start.getTime();
    if (startMs > rangeEndMs) return false; // chronological → nothing later fits
    const endMs = startMs + Math.max(0, durationMs);
    if (endMs > rangeStartMs) out.push({ start, end: new Date(endMs) });
    return true;
  });
  return out;
}

/** Enumerates raw series starts (no range filter) up to the cap — used to place
 *  per-occurrence exceptions and to find the next occurrence for reminders. */
export function seriesStarts(spec: RecurrenceSpec, limit = MAX_OCCURRENCES): Date[] {
  const out: Date[] = [];
  forEachStart(spec, (start) => {
    out.push(start);
    return out.length < limit;
  });
  return out;
}
