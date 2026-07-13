'use client';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@businessos/ui';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { api } from '@/lib/api';

/** Shared query for the org's calendars (colors + names + defaults). */
export function useCalendarsQuery() {
  return useQuery({
    queryKey: ['calendars'],
    queryFn: () => api.calendar.listCalendars(),
  });
}

/** Calendar picker for the event editor. Value is a calendar id. */
export function CalendarSelect({
  value,
  onValueChange,
  id,
  ariaLabel,
}: {
  value: string;
  onValueChange: (value: string) => void;
  id?: string;
  ariaLabel: string;
}) {
  const t = useTranslations('calendar');
  const calendarsQuery = useCalendarsQuery();
  return (
    <Select value={value} onValueChange={onValueChange} disabled={calendarsQuery.isPending}>
      <SelectTrigger id={id} aria-label={ariaLabel}>
        <SelectValue placeholder={t('selectCalendar')} />
      </SelectTrigger>
      <SelectContent>
        {(calendarsQuery.data ?? []).map((calendar) => (
          <SelectItem key={calendar.id} value={calendar.id}>
            <span className="inline-flex items-center gap-2">
              <span
                aria-hidden="true"
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: calendar.color }}
              />
              {calendar.name}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
