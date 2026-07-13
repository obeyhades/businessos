'use client';

import type { OccurrenceDto } from '@businessos/types';
import { Button, cn } from '@businessos/ui';
import { Plus } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import {
  buildWeekDays,
  calendarColor,
  dateKey,
  groupByDay,
  occurrenceKey,
  sameDay,
} from './calendar-utils';
import { OccurrenceChip } from './occurrence-chip';

/** Week / agenda view: the seven days of the week, each with its occurrences. */
export function WeekView({
  weekAnchor,
  occurrences,
  colorMap,
  onSelectDay,
  onSelectOccurrence,
  canManage,
}: {
  weekAnchor: Date;
  occurrences: OccurrenceDto[];
  colorMap: Map<string, string>;
  onSelectDay: (day: Date) => void;
  onSelectOccurrence: (occurrence: OccurrenceDto) => void;
  canManage: boolean;
}) {
  const t = useTranslations('calendar');
  const format = useFormatter();
  const days = buildWeekDays(weekAnchor);
  const byDay = groupByDay(occurrences);
  const today = new Date();

  return (
    <div className="divide-y divide-border rounded-lg border border-border">
      {days.map((day) => {
        const dayOccurrences = byDay.get(dateKey(day)) ?? [];
        const isToday = sameDay(day, today);
        return (
          <div key={day.toISOString()} className="flex flex-col gap-2 p-3 sm:flex-row">
            <div className="flex w-full items-center justify-between sm:w-40 sm:flex-col sm:items-start sm:justify-start">
              <div>
                <p className={cn('text-sm font-medium', isToday && 'text-primary')}>
                  {format.dateTime(day, { weekday: 'long' })}
                </p>
                <p className="text-xs text-muted-foreground">
                  {format.dateTime(day, { day: 'numeric', month: 'short' })}
                </p>
              </div>
              {canManage ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  aria-label={t('addOnDay')}
                  onClick={() => onSelectDay(day)}
                >
                  <Plus aria-hidden="true" className="size-4" />
                </Button>
              ) : null}
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              {dayOccurrences.length === 0 ? (
                <p className="py-1 text-sm text-muted-foreground">{t('noEventsDay')}</p>
              ) : (
                dayOccurrences.map((occurrence) => (
                  <OccurrenceChip
                    key={occurrenceKey(occurrence)}
                    occurrence={occurrence}
                    color={calendarColor(colorMap, occurrence.calendarId)}
                    onClick={() => onSelectOccurrence(occurrence)}
                  />
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
