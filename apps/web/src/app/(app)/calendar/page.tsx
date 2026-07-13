'use client';

import type { OccurrenceDto } from '@businessos/types';
import { Alert, AlertDescription, AlertTitle, Button, Card, CardContent } from '@businessos/ui';
import { CalendarRange, ChevronLeft, ChevronRight, ListChecks, Plus } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { EmptyState, ErrorState, ListSkeleton } from '@/components/data-states';
import { CalendarFilterSidebar } from '@/components/phase6/calendar-filter-sidebar';
import { useCalendarsQuery } from '@/components/phase6/calendar-select';
import {
  addDays,
  addMonths,
  calendarColorMap,
  defaultEventBounds,
  monthRange,
  startOfWeek,
  weekRange,
} from '@/components/phase6/calendar-utils';
import { EventDetailDialog } from '@/components/phase6/event-detail-dialog';
import {
  EventEditorDialog,
  type EventEditorInitial,
} from '@/components/phase6/event-editor-dialog';
import { MonthGrid } from '@/components/phase6/month-grid';
import { WeekView } from '@/components/phase6/week-view';
import { api } from '@/lib/api';
import { useApiErrorMessage } from '@/lib/errors';
import { can, useSession } from '@/lib/session';

type View = 'month' | 'week';

export default function CalendarPage() {
  const t = useTranslations('calendar');
  const format = useFormatter();
  const errorMessage = useApiErrorMessage();
  const { data: session } = useSession();
  const canRead = can(session, 'calendar.read');
  const canManage = can(session, 'calendar.manage');

  const [view, setView] = useState<View>('month');
  const [cursor, setCursor] = useState<Date>(() => new Date());
  const [hiddenCalendarIds, setHiddenCalendarIds] = useState<Set<string>>(new Set());
  const [mine, setMine] = useState(false);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editorInitial, setEditorInitial] = useState<EventEditorInitial | undefined>(undefined);
  const [detailOccurrence, setDetailOccurrence] = useState<OccurrenceDto | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const calendarsQuery = useCalendarsQuery();
  const calendars = useMemo(() => calendarsQuery.data ?? [], [calendarsQuery.data]);
  const colorMap = useMemo(() => calendarColorMap(calendars), [calendars]);

  const range = view === 'month' ? monthRange(cursor) : weekRange(cursor);

  const eventsQuery = useQuery({
    queryKey: ['events', { from: range.from, to: range.to, mine }],
    queryFn: () =>
      api.calendar.listEvents({
        from: range.from,
        to: range.to,
        mine: mine ? 'true' : undefined,
      }),
    enabled: canRead,
  });

  const occurrences = useMemo(
    () => (eventsQuery.data ?? []).filter((o) => !hiddenCalendarIds.has(o.calendarId)),
    [eventsQuery.data, hiddenCalendarIds],
  );

  if (!canRead) {
    return (
      <div className="mx-auto max-w-6xl">
        <Alert>
          <AlertTitle>{t('title')}</AlertTitle>
          <AlertDescription>{t('restricted')}</AlertDescription>
        </Alert>
      </div>
    );
  }

  function goPrev() {
    setCursor((c) => (view === 'month' ? addMonths(c, -1) : addDays(c, -7)));
  }
  function goNext() {
    setCursor((c) => (view === 'month' ? addMonths(c, 1) : addDays(c, 7)));
  }

  function toggleCalendar(calendarId: string) {
    setHiddenCalendarIds((prev) => {
      const next = new Set(prev);
      if (next.has(calendarId)) next.delete(calendarId);
      else next.add(calendarId);
      return next;
    });
  }

  function openNewEvent(day: Date) {
    setEditorInitial(defaultEventBounds(day));
    setEditorOpen(true);
  }

  function openOccurrence(occurrence: OccurrenceDto) {
    setDetailOccurrence(occurrence);
    setDetailOpen(true);
  }

  const rangeLabel =
    view === 'month'
      ? format.dateTime(cursor, { month: 'long', year: 'numeric' })
      : `${format.dateTime(startOfWeek(cursor), { day: 'numeric', month: 'short' })} – ${format.dateTime(
          addDays(startOfWeek(cursor), 6),
          { day: 'numeric', month: 'short', year: 'numeric' },
        )}`;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline">
            <Link href="/calendar/agenda">
              <ListChecks aria-hidden="true" />
              {t('agenda')}
            </Link>
          </Button>
          {canManage ? (
            <Button type="button" onClick={() => openNewEvent(new Date())}>
              <Plus aria-hidden="true" />
              {t('newEvent')}
            </Button>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label={t('previous')}
            onClick={goPrev}
          >
            <ChevronLeft aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label={t('next')}
            onClick={goNext}
          >
            <ChevronRight aria-hidden="true" />
          </Button>
          <Button type="button" variant="outline" onClick={() => setCursor(new Date())}>
            {t('today')}
          </Button>
          <span className="ml-1 text-lg font-medium capitalize">{rangeLabel}</span>
        </div>
        <div className="flex items-center gap-1 rounded-md border border-border p-1">
          <Button
            type="button"
            size="sm"
            variant={view === 'month' ? 'default' : 'ghost'}
            aria-pressed={view === 'month'}
            onClick={() => setView('month')}
          >
            <CalendarRange aria-hidden="true" />
            {t('viewMonth')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant={view === 'week' ? 'default' : 'ghost'}
            aria-pressed={view === 'week'}
            onClick={() => setView('week')}
          >
            {t('viewWeek')}
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
        <CalendarFilterSidebar
          calendars={calendars}
          isLoading={calendarsQuery.isPending}
          hiddenCalendarIds={hiddenCalendarIds}
          onToggleCalendar={toggleCalendar}
          mine={mine}
          onToggleMine={() => setMine((v) => !v)}
          canManage={canManage}
        />

        <div>
          {eventsQuery.isPending ? (
            <Card>
              <CardContent className="pt-6">
                <ListSkeleton rows={6} />
              </CardContent>
            </Card>
          ) : eventsQuery.isError ? (
            <ErrorState
              message={errorMessage(eventsQuery.error)}
              onRetry={() => void eventsQuery.refetch()}
            />
          ) : view === 'month' ? (
            <MonthGrid
              monthAnchor={cursor}
              occurrences={occurrences}
              colorMap={colorMap}
              onSelectDay={openNewEvent}
              onSelectOccurrence={openOccurrence}
              canManage={canManage}
            />
          ) : occurrences.length === 0 ? (
            <>
              <WeekView
                weekAnchor={cursor}
                occurrences={occurrences}
                colorMap={colorMap}
                onSelectDay={openNewEvent}
                onSelectOccurrence={openOccurrence}
                canManage={canManage}
              />
              <div className="mt-4">
                <EmptyState title={t('emptyWeek')} />
              </div>
            </>
          ) : (
            <WeekView
              weekAnchor={cursor}
              occurrences={occurrences}
              colorMap={colorMap}
              onSelectDay={openNewEvent}
              onSelectOccurrence={openOccurrence}
              canManage={canManage}
            />
          )}
        </div>
      </div>

      <EventEditorDialog open={editorOpen} onOpenChange={setEditorOpen} initial={editorInitial} />

      {detailOccurrence ? (
        <EventDetailDialog
          open={detailOpen}
          onOpenChange={setDetailOpen}
          occurrence={detailOccurrence}
        />
      ) : null}
    </div>
  );
}
