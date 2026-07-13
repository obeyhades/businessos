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

/** Safety bound: at most this many occurrences are ever RETURNED for a query. */
export const MAX_OCCURRENCES = 3660;
/** Raw iteration guard for enumerate-from-start paths (well above any bounded
 *  series so heavy impossible-day skipping can't truncate below COUNT/UNTIL). */
const RAW_ITERATION_CAP = MAX_OCCURRENCES * 8;

function timeOfDayMatches(a: Date, b: Date): boolean {
  return (
    a.getUTCHours() === b.getUTCHours() &&
    a.getUTCMinutes() === b.getUTCMinutes() &&
    a.getUTCSeconds() === b.getUTCSeconds() &&
    a.getUTCMilliseconds() === b.getUTCMilliseconds()
  );
}

function sortedWeekdays(spec: RecurrenceSpec): number[] {
  return (spec.byWeekday.length > 0 ? spec.byWeekday : [spec.startsAt.getUTCDay()])
    .filter((w) => w >= 0 && w <= 6)
    .sort((a, b) => a - b);
}

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
    const weekdays = sortedWeekdays(spec);
    if (weekdays.length === 0) return;
    // Anchor to the Sunday of the series-start week, then step interval weeks.
    const weekAnchor = addUtcDays(spec.startsAt, -spec.startsAt.getUTCDay());
    for (let week = 0; ; week += interval) {
      const base = addUtcDays(weekAnchor, week * 7);
      for (const wd of weekdays) {
        const start = addUtcDays(base, wd);
        if (start.getTime() < spec.startsAt.getTime()) continue; // before series start
        if (++iterations > RAW_ITERATION_CAP) return;
        if (!tryEmit(start)) return;
      }
      if (iterations > RAW_ITERATION_CAP) return;
    }
  }

  // DAILY / MONTHLY / YEARLY: one candidate per step.
  for (let n = 0; ; n += 1) {
    if (++iterations > RAW_ITERATION_CAP) return;
    let start: Date | null;
    if (spec.freq === 'DAILY') start = addUtcDays(spec.startsAt, n * interval);
    else if (spec.freq === 'MONTHLY') start = addUtcMonths(spec.startsAt, n * interval);
    else start = addUtcYears(spec.startsAt, n * interval); // YEARLY
    if (start === null) continue; // skipped invalid calendar day
    if (!tryEmit(start)) return;
  }
}

/**
 * Fast-forward generation for UNBOUNDED / until-only series: positions the first
 * candidate near `skipTo` arithmetically so a far-future window is reached
 * without enumerating from the (possibly years-old) series start. COUNT-bounded
 * series never use this path — they are short and enumerate from the start.
 */
function forEachStartFrom(
  spec: RecurrenceSpec,
  skipTo: Date,
  emit: (start: Date) => boolean,
): void {
  const interval = Math.max(1, Math.floor(spec.interval || 1));
  const ss = spec.startsAt;
  const untilMs = spec.until ? spec.until.getTime() : null;
  const DAY = 86_400_000;
  let raw = 0;
  const consider = (start: Date): boolean => {
    if (untilMs !== null && start.getTime() > untilMs) return false;
    return emit(start);
  };

  if (spec.freq === 'WEEKLY') {
    const weekdays = sortedWeekdays(spec);
    if (weekdays.length === 0) return;
    const weekAnchor = addUtcDays(ss, -ss.getUTCDay());
    const blockMs = interval * 7 * DAY;
    const b0 = Math.max(0, Math.floor((skipTo.getTime() - weekAnchor.getTime()) / blockMs) - 1);
    for (let b = b0; ; b += 1) {
      if (++raw > RAW_ITERATION_CAP) return;
      const base = addUtcDays(weekAnchor, b * interval * 7);
      for (const wd of weekdays) {
        const start = addUtcDays(base, wd);
        if (start.getTime() < ss.getTime()) continue;
        if (!consider(start)) return;
      }
    }
  }

  let n0 = 0;
  if (spec.freq === 'DAILY') {
    n0 = Math.max(0, Math.floor((skipTo.getTime() - ss.getTime()) / (interval * DAY)) - 1);
  } else if (spec.freq === 'MONTHLY') {
    const months =
      (skipTo.getUTCFullYear() - ss.getUTCFullYear()) * 12 +
      (skipTo.getUTCMonth() - ss.getUTCMonth());
    n0 = Math.max(0, Math.floor(months / interval) - 1);
  } else {
    // YEARLY
    n0 = Math.max(0, Math.floor((skipTo.getUTCFullYear() - ss.getUTCFullYear()) / interval) - 1);
  }
  for (let n = n0; ; n += 1) {
    if (++raw > RAW_ITERATION_CAP) return;
    let start: Date | null;
    if (spec.freq === 'DAILY') start = addUtcDays(ss, n * interval);
    else if (spec.freq === 'MONTHLY') start = addUtcMonths(ss, n * interval);
    else start = addUtcYears(ss, n * interval);
    if (start === null || start.getTime() < ss.getTime()) continue;
    if (!consider(start)) return;
  }
}

/**
 * Returns every occurrence (start+end) that OVERLAPS the half-open window
 * [rangeStart, rangeEnd). `durationMs` is applied to each start. Sorted
 * ascending by start; capped at MAX_OCCURRENCES returned rows.
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
  const dur = Math.max(0, durationMs);
  const emit = (start: Date): boolean => {
    const startMs = start.getTime();
    if (startMs >= rangeEndMs) return false; // half-open: stop at/after `to`
    if (startMs + dur > rangeStartMs) out.push({ start, end: new Date(startMs + dur) });
    return out.length < MAX_OCCURRENCES;
  };

  if (!spec.freq) {
    emit(spec.startsAt);
  } else if (spec.count != null) {
    // COUNT-bounded (≤ schema max 1000): enumerate from the start.
    forEachStart(spec, emit);
  } else {
    // Unbounded / until-only: fast-forward. Position by (rangeStart − duration)
    // so a long event overlapping from before the window is still captured.
    forEachStartFrom(spec, new Date(rangeStartMs - dur), emit);
  }
  out.sort((a, b) => a.start.getTime() - b.start.getTime());
  return out;
}

/** True if `target` is a genuine occurrence start of the series — used to reject
 *  per-occurrence exceptions/overrides on phantom (non-rule) slots. */
export function isValidOccurrenceStart(spec: RecurrenceSpec, target: Date): boolean {
  if (!spec.freq) return target.getTime() === spec.startsAt.getTime();
  const ss = spec.startsAt;
  if (target.getTime() < ss.getTime()) return false;
  if (spec.until && target.getTime() > spec.until.getTime()) return false;
  if (!timeOfDayMatches(target, ss)) return false;
  const interval = Math.max(1, Math.floor(spec.interval || 1));
  const DAY = 86_400_000;
  let shapeOk = false;
  if (spec.freq === 'DAILY') {
    shapeOk = (target.getTime() - ss.getTime()) % (interval * DAY) === 0;
  } else if (spec.freq === 'WEEKLY') {
    if (!sortedWeekdays(spec).includes(target.getUTCDay())) return false;
    const weekAnchor = addUtcDays(ss, -ss.getUTCDay());
    const targetAnchor = addUtcDays(target, -target.getUTCDay());
    const weeks = Math.round((targetAnchor.getTime() - weekAnchor.getTime()) / (7 * DAY));
    shapeOk = weeks >= 0 && weeks % interval === 0;
  } else if (spec.freq === 'MONTHLY') {
    if (target.getUTCDate() !== ss.getUTCDate()) return false;
    const months =
      (target.getUTCFullYear() - ss.getUTCFullYear()) * 12 +
      (target.getUTCMonth() - ss.getUTCMonth());
    shapeOk = months >= 0 && months % interval === 0;
  } else {
    if (target.getUTCMonth() !== ss.getUTCMonth() || target.getUTCDate() !== ss.getUTCDate()) {
      return false;
    }
    shapeOk = (target.getUTCFullYear() - ss.getUTCFullYear()) % interval === 0;
  }
  if (!shapeOk) return false;
  // For COUNT-bounded series, confirm the target is within the first `count`.
  if (spec.count != null) {
    return seriesStarts(spec, spec.count).some((s) => s.getTime() === target.getTime());
  }
  return true;
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
