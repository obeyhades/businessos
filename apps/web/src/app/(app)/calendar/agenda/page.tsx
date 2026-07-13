'use client';

import type { AgendaItemDto } from '@businessos/types';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  Label,
} from '@businessos/ui';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, CalendarClock, CircleCheck } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState } from 'react';
import { EmptyState, ErrorState, ListSkeleton } from '@/components/data-states';
import { EventStatusBadge } from '@/components/phase6/calendar-indicators';
import {
  addDays,
  dateInputToIso,
  dateKey,
  isoToDateInput,
} from '@/components/phase6/calendar-utils';
import { api } from '@/lib/api';
import { useApiErrorMessage } from '@/lib/errors';
import { can, useSession } from '@/lib/session';

function groupAgenda(
  items: AgendaItemDto[],
): { key: string; date: Date; items: AgendaItemDto[] }[] {
  const sorted = [...items].sort(
    (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime(),
  );
  const groups = new Map<string, { key: string; date: Date; items: AgendaItemDto[] }>();
  for (const item of sorted) {
    const date = new Date(item.start);
    const key = dateKey(date);
    const group = groups.get(key);
    if (group) group.items.push(item);
    else groups.set(key, { key, date, items: [item] });
  }
  return [...groups.values()];
}

export default function AgendaPage() {
  const t = useTranslations('calendar');
  const format = useFormatter();
  const errorMessage = useApiErrorMessage();
  const { data: session } = useSession();
  const canRead = can(session, 'calendar.read');

  const [fromDate, setFromDate] = useState(() => isoToDateInput(new Date().toISOString()));
  const [toDate, setToDate] = useState(() => isoToDateInput(addDays(new Date(), 30).toISOString()));

  const from = dateInputToIso(fromDate);
  const to = dateInputToIso(toDate, true);

  const agendaQuery = useQuery({
    queryKey: ['agenda', { from, to }],
    queryFn: () => api.calendar.agenda({ from, to }),
    enabled: canRead && Boolean(fromDate) && Boolean(toDate),
  });

  if (!canRead) {
    return (
      <div className="mx-auto max-w-4xl">
        <Alert>
          <AlertTitle>{t('agenda')}</AlertTitle>
          <AlertDescription>{t('restricted')}</AlertDescription>
        </Alert>
      </div>
    );
  }

  const groups = groupAgenda(agendaQuery.data ?? []);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2 text-muted-foreground">
          <Link href="/calendar">
            <ArrowLeft aria-hidden="true" />
            {t('backToCalendar')}
          </Link>
        </Button>
        <h1 className="text-2xl font-semibold tracking-tight">{t('agenda')}</h1>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-2">
          <Label htmlFor="agenda-from">{t('from')}</Label>
          <input
            id="agenda-from"
            type="date"
            className="flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="agenda-to">{t('to')}</Label>
          <input
            id="agenda-to"
            type="date"
            className="flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
          />
        </div>
      </div>

      {agendaQuery.isPending ? (
        <Card>
          <CardContent className="pt-6">
            <ListSkeleton rows={6} />
          </CardContent>
        </Card>
      ) : agendaQuery.isError ? (
        <ErrorState
          message={errorMessage(agendaQuery.error)}
          onRetry={() => void agendaQuery.refetch()}
        />
      ) : groups.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <EmptyState title={t('agendaEmpty')} description={t('agendaEmptyDescription')} />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {groups.map((group) => (
            <Card key={group.key}>
              <CardContent className="pt-6">
                <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  {format.dateTime(group.date, { weekday: 'long', day: 'numeric', month: 'long' })}
                </h2>
                <ul className="divide-y divide-border">
                  {group.items.map((item) =>
                    item.kind === 'event' ? (
                      <li
                        key={`event-${item.id}-${item.occurrenceStart}`}
                        className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0"
                      >
                        <CalendarClock
                          aria-hidden="true"
                          className="size-4 shrink-0 text-muted-foreground"
                        />
                        <span className="shrink-0 tabular-nums text-sm text-muted-foreground">
                          {`${format.dateTime(new Date(item.start), { timeStyle: 'short' })} – ${format.dateTime(
                            new Date(item.end),
                            { timeStyle: 'short' },
                          )}`}
                        </span>
                        <span className="min-w-0 flex-1 font-medium">{item.title}</span>
                        <EventStatusBadge status={item.status} />
                      </li>
                    ) : (
                      <li
                        key={`task-${item.id}`}
                        className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0"
                      >
                        <CircleCheck
                          aria-hidden="true"
                          className="size-4 shrink-0 text-muted-foreground"
                        />
                        <span className="shrink-0 tabular-nums text-sm text-muted-foreground">
                          {format.dateTime(new Date(item.start), { timeStyle: 'short' })}
                        </span>
                        <Link
                          href={`/tasks/${item.id}`}
                          className="min-w-0 flex-1 font-medium hover:underline"
                        >
                          {item.title}
                        </Link>
                        <Badge variant="outline">{t('taskBadge')}</Badge>
                      </li>
                    ),
                  )}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
