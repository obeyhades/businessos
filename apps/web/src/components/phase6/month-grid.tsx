'use client';

import type { OccurrenceDto } from '@businessos/types';
import { cn } from '@businessos/ui';
import { useLocale, useTranslations } from 'next-intl';
import {
  buildMonthGrid,
  calendarColor,
  dateKey,
  groupByDay,
  isSameMonth,
  occurrenceKey,
  sameDay,
  weekdayOptions,
} from './calendar-utils';
import { OccurrenceChip } from './occurrence-chip';

const MAX_VISIBLE = 3;

/** Month view: a Monday-first 6x7 grid of day cells with occurrence chips. */
export function MonthGrid({
  monthAnchor,
  occurrences,
  colorMap,
  onSelectDay,
  onSelectOccurrence,
  canManage,
}: {
  monthAnchor: Date;
  occurrences: OccurrenceDto[];
  colorMap: Map<string, string>;
  onSelectDay: (day: Date) => void;
  onSelectOccurrence: (occurrence: OccurrenceDto) => void;
  canManage: boolean;
}) {
  const t = useTranslations('calendar');
  const locale = useLocale();
  const cells = buildMonthGrid(monthAnchor);
  const byDay = groupByDay(occurrences);
  const headers = weekdayOptions(locale);
  const today = new Date();

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <div className="grid grid-cols-7 border-b border-border bg-muted/50">
        {headers.map((header) => (
          <div
            key={header.value}
            className="px-2 py-1.5 text-center text-xs font-medium text-muted-foreground"
          >
            {header.label}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((day) => {
          const inMonth = isSameMonth(day, monthAnchor);
          const isToday = sameDay(day, today);
          const dayOccurrences = byDay.get(dateKey(day)) ?? [];
          const visible = dayOccurrences.slice(0, MAX_VISIBLE);
          const overflow = dayOccurrences.length - visible.length;
          return (
            <div
              key={day.toISOString()}
              className={cn(
                'group min-h-24 border-b border-r border-border p-1 last:border-r-0 [&:nth-child(7n)]:border-r-0',
                !inMonth && 'bg-muted/30 text-muted-foreground',
              )}
            >
              <div className="mb-1 flex items-center justify-between">
                <span
                  className={cn(
                    'inline-flex size-6 items-center justify-center rounded-full text-xs',
                    isToday && 'bg-primary font-semibold text-primary-foreground',
                  )}
                >
                  {day.getDate()}
                </span>
                {canManage ? (
                  <button
                    type="button"
                    aria-label={t('addOnDay')}
                    className="rounded px-1 text-xs text-muted-foreground opacity-0 hover:bg-accent focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100"
                    onClick={() => onSelectDay(day)}
                  >
                    +
                  </button>
                ) : null}
              </div>
              <div className="space-y-0.5">
                {visible.map((occurrence) => (
                  <OccurrenceChip
                    key={occurrenceKey(occurrence)}
                    occurrence={occurrence}
                    color={calendarColor(colorMap, occurrence.calendarId)}
                    onClick={() => onSelectOccurrence(occurrence)}
                  />
                ))}
                {overflow > 0 ? (
                  <p className="px-1.5 text-xs text-muted-foreground">
                    {t('moreCount', { count: overflow })}
                  </p>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
