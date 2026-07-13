import type { CalendarDto, OccurrenceDto } from '@businessos/types';

/**
 * Date math + ISO<->input conversions for the calendar UI, built on the native
 * `Date` (no calendar library dependency). The API stores/returns UTC instants;
 * everything the user sees or types is interpreted in their local timezone.
 *
 * Weeks start on Monday (Swedish/European convention). Recurrence weekday codes
 * follow the API contract: 0=Sunday .. 6=Saturday.
 */

function pad2(value: number): string {
  return value.toString().padStart(2, '0');
}

export function startOfDay(date: Date): Date {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

export function addDays(date: Date, amount: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

export function addMonths(date: Date, amount: number): Date {
  const next = new Date(date);
  next.setMonth(next.getMonth() + amount);
  return next;
}

export function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function isSameMonth(date: Date, monthAnchor: Date): boolean {
  return (
    date.getFullYear() === monthAnchor.getFullYear() && date.getMonth() === monthAnchor.getMonth()
  );
}

/** Monday-based start of the week containing `date`. */
export function startOfWeek(date: Date): Date {
  const day = date.getDay(); // 0=Sun..6=Sat
  const diff = (day + 6) % 7; // days since Monday
  return startOfDay(addDays(date, -diff));
}

/** Local `YYYY-MM-DD` key, safe for grouping occurrences into day cells. */
export function dateKey(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** The 6x7 grid (Mon-first) covering the month that `monthAnchor` falls in. */
export function buildMonthGrid(monthAnchor: Date): Date[] {
  const first = startOfDay(new Date(monthAnchor.getFullYear(), monthAnchor.getMonth(), 1));
  const gridStart = startOfWeek(first);
  const cells: Date[] = [];
  for (let i = 0; i < 42; i += 1) {
    cells.push(addDays(gridStart, i));
  }
  return cells;
}

/** The seven Monday-first days of the week containing `date`. */
export function buildWeekDays(date: Date): Date[] {
  const start = startOfWeek(date);
  const days: Date[] = [];
  for (let i = 0; i < 7; i += 1) {
    days.push(addDays(start, i));
  }
  return days;
}

/** UTC-ISO range [from, to) spanning the visible month grid. */
export function monthRange(monthAnchor: Date): { from: string; to: string } {
  const grid = buildMonthGrid(monthAnchor);
  const start = grid[0] ?? startOfDay(monthAnchor);
  const lastCell = grid[grid.length - 1] ?? start;
  const end = addDays(lastCell, 1);
  return { from: start.toISOString(), to: end.toISOString() };
}

/** UTC-ISO range [from, to) spanning the visible week. */
export function weekRange(date: Date): { from: string; to: string } {
  const start = startOfWeek(date);
  return { from: start.toISOString(), to: addDays(start, 7).toISOString() };
}

// ---------------------------------------------------------------------------
// <input> value <-> ISO conversions (all local-time based)
// ---------------------------------------------------------------------------

/** ISO instant -> `YYYY-MM-DDTHH:mm` for a `datetime-local` input. */
export function isoToDateTimeInput(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(
    d.getHours(),
  )}:${pad2(d.getMinutes())}`;
}

/** `datetime-local` value (local time) -> UTC ISO instant. */
export function dateTimeInputToIso(value: string): string {
  return new Date(value).toISOString();
}

/** ISO instant -> `YYYY-MM-DD` for a `date` input. */
export function isoToDateInput(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** `date` value -> UTC ISO instant at local midnight (or end of day). */
export function dateInputToIso(value: string, endOfDay = false): string {
  const [y, m, d] = value.split('-').map((part) => Number.parseInt(part, 10));
  const date = new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
  if (endOfDay) date.setHours(23, 59, 0, 0);
  return date.toISOString();
}

/** Default new-event bounds for a clicked day: 09:00-10:00 local, as ISO. */
export function defaultEventBounds(day: Date): { startsAt: string; endsAt: string } {
  const start = new Date(day);
  start.setHours(9, 0, 0, 0);
  const end = new Date(start);
  end.setHours(10, 0, 0, 0);
  return { startsAt: start.toISOString(), endsAt: end.toISOString() };
}

// ---------------------------------------------------------------------------
// Occurrences & calendars
// ---------------------------------------------------------------------------

/** Group occurrences into local day buckets keyed by `dateKey`. */
export function groupByDay(occurrences: OccurrenceDto[]): Map<string, OccurrenceDto[]> {
  const map = new Map<string, OccurrenceDto[]>();
  for (const occ of occurrences) {
    const key = dateKey(new Date(occ.start));
    const bucket = map.get(key);
    if (bucket) bucket.push(occ);
    else map.set(key, [occ]);
  }
  for (const bucket of map.values()) {
    bucket.sort((a, b) => {
      if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
      return new Date(a.start).getTime() - new Date(b.start).getTime();
    });
  }
  return map;
}

/** Stable identity for an occurrence (recurring series share an eventId). */
export function occurrenceKey(occ: OccurrenceDto): string {
  return `${occ.eventId}:${occ.occurrenceStart}`;
}

const FALLBACK_COLOR = '#64748b';

/** Map calendarId -> hex color for coloring occurrence chips. */
export function calendarColorMap(calendars: CalendarDto[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const cal of calendars) map.set(cal.id, cal.color || FALLBACK_COLOR);
  return map;
}

export function calendarColor(map: Map<string, string>, calendarId: string): string {
  return map.get(calendarId) ?? FALLBACK_COLOR;
}

/** Monday-first weekday codes with locale-aware short labels (0=Sun..6=Sat). */
export function weekdayOptions(locale: string): { value: number; label: string }[] {
  // 2023-01-01 was a Sunday, so getDay() of (base + v) === v.
  const baseSunday = new Date(2023, 0, 1);
  const formatter = new Intl.DateTimeFormat(locale, { weekday: 'short' });
  const order = [1, 2, 3, 4, 5, 6, 0];
  return order.map((value) => ({
    value,
    label: formatter.format(addDays(baseSunday, value)),
  }));
}
