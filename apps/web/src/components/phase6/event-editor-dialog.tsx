'use client';

import type {
  CreateEventBody,
  EventDto,
  EventStatus,
  EventVisibility,
  UpdateEventBody,
} from '@businessos/types';
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@businessos/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ErrorState } from '@/components/data-states';
import { TextField, TextareaField } from '@/components/form-field';
import { api } from '@/lib/api';
import { useApiErrorMessage } from '@/lib/errors';
import { AttendeePicker } from './attendee-picker';
import type { BusinessLinks } from './business-link-fields';
import { BusinessLinkFields } from './business-link-fields';
import { CalendarSelect, useCalendarsQuery } from './calendar-select';
import {
  dateInputToIso,
  isoToDateInput,
  isoToDateTimeInput,
  dateTimeInputToIso,
} from './calendar-utils';
import type { RecurrenceState } from './recurrence-fields';
import { RecurrenceFields, recurrenceStateFromEvent, toRecurrenceInput } from './recurrence-fields';
import type { ReminderState } from './reminder-fields';
import { ReminderFields, remindersFromEvent, toReminderInput } from './reminder-fields';

const STATUSES: EventStatus[] = ['CONFIRMED', 'TENTATIVE', 'CANCELLED'];
const VISIBILITIES: EventVisibility[] = ['DEFAULT', 'PRIVATE'];

export interface EventEditorInitial {
  startsAt: string;
  endsAt: string;
  calendarId?: string;
}

interface FormState {
  calendarId: string;
  title: string;
  description: string;
  location: string;
  allDay: boolean;
  startsAtIso: string;
  endsAtIso: string;
  status: EventStatus;
  visibility: EventVisibility;
  links: BusinessLinks;
  recurrence: RecurrenceState;
  reminders: ReminderState[];
  attendees: string[];
}

function buildForm(
  event: EventDto | undefined,
  initial: EventEditorInitial | undefined,
  defaultCalendarId: string,
): FormState {
  if (event) {
    return {
      calendarId: event.calendarId,
      title: event.title,
      description: event.description ?? '',
      location: event.location ?? '',
      allDay: event.allDay,
      startsAtIso: event.startsAt,
      endsAtIso: event.endsAt,
      status: event.status,
      visibility: event.visibility,
      links: {
        customerId: event.customerId,
        projectId: event.projectId,
        taskId: event.taskId,
      },
      recurrence: recurrenceStateFromEvent(event),
      reminders: remindersFromEvent(event),
      attendees: event.attendees.map((a) => a.userId),
    };
  }
  const now = new Date();
  const start = new Date(now);
  start.setHours(9, 0, 0, 0);
  const end = new Date(start);
  end.setHours(10, 0, 0, 0);
  return {
    calendarId: initial?.calendarId ?? defaultCalendarId,
    title: '',
    description: '',
    location: '',
    allDay: false,
    startsAtIso: initial?.startsAt ?? start.toISOString(),
    endsAtIso: initial?.endsAt ?? end.toISOString(),
    status: 'CONFIRMED',
    visibility: 'DEFAULT',
    links: { customerId: null, projectId: null, taskId: null },
    recurrence: recurrenceStateFromEvent(undefined),
    reminders: [],
    attendees: [],
  };
}

/**
 * Create/edit dialog for a master event. Handles all-day toggling, recurrence,
 * reminders, attendees and optional business links. Times are edited in the
 * user's local timezone and submitted as UTC ISO instants.
 */
export function EventEditorDialog({
  open,
  onOpenChange,
  event,
  initial,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event?: EventDto;
  initial?: EventEditorInitial;
  onSaved?: (event: EventDto) => void;
}) {
  const t = useTranslations('calendar');
  const tStatus = useTranslations('calendar.eventStatus');
  const tVisibility = useTranslations('calendar.visibility');
  const tCommon = useTranslations('common');
  const queryClient = useQueryClient();
  const errorMessage = useApiErrorMessage();
  const isEdit = event !== undefined;

  const calendarsQuery = useCalendarsQuery();
  const defaultCalendarId =
    calendarsQuery.data?.find((c) => c.isDefault)?.id ?? calendarsQuery.data?.[0]?.id ?? '';

  const [form, setForm] = useState<FormState>(() => buildForm(event, initial, defaultCalendarId));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm(buildForm(event, initial, defaultCalendarId));
      setError(null);
    }
    // Reset only when the dialog (re)opens for a given target.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, event?.id, initial?.startsAt, initial?.endsAt, initial?.calendarId, defaultCalendarId]);

  const patch = (next: Partial<FormState>) => setForm((prev) => ({ ...prev, ...next }));

  const mutation = useMutation({
    mutationFn: (
      payload:
        | { kind: 'create'; body: CreateEventBody }
        | { kind: 'update'; id: string; body: UpdateEventBody },
    ) =>
      payload.kind === 'create'
        ? api.calendar.createEvent(payload.body)
        : api.calendar.updateEvent(payload.id, payload.body),
    onSuccess: async (saved) => {
      toast.success(isEdit ? t('updated') : t('created'));
      await queryClient.invalidateQueries({ queryKey: ['events'] });
      await queryClient.invalidateQueries({ queryKey: ['agenda'] });
      if (isEdit) await queryClient.invalidateQueries({ queryKey: ['event', saved.id] });
      onOpenChange(false);
      onSaved?.(saved);
    },
    onError: (err) => setError(errorMessage(err)),
  });

  function resolveBounds(): { startsAt: string; endsAt: string } {
    let startsAt = form.startsAtIso;
    let endsAt = form.endsAtIso;
    if (form.allDay) {
      startsAt = dateInputToIso(isoToDateInput(form.startsAtIso));
      endsAt = dateInputToIso(isoToDateInput(form.endsAtIso));
    }
    if (new Date(endsAt).getTime() < new Date(startsAt).getTime()) endsAt = startsAt;
    return { startsAt, endsAt };
  }

  function submit() {
    setError(null);
    if (!form.calendarId) {
      setError(t('errors.calendarRequired'));
      return;
    }
    if (!form.title.trim()) {
      setError(t('errors.titleRequired'));
      return;
    }
    const { startsAt, endsAt } = resolveBounds();
    const timezone =
      event?.timezone ?? (Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Stockholm');
    const description = form.description.trim();
    const location = form.location.trim();
    const recurrence = toRecurrenceInput(form.recurrence);
    const reminders = toReminderInput(form.reminders);

    if (isEdit && event) {
      const body: UpdateEventBody = {
        calendarId: form.calendarId,
        title: form.title.trim(),
        description: description ? description : null,
        location: location ? location : null,
        startsAt,
        endsAt,
        allDay: form.allDay,
        timezone,
        status: form.status,
        visibility: form.visibility,
        customerId: form.links.customerId,
        projectId: form.links.projectId,
        taskId: form.links.taskId,
        recurrence,
        reminders,
        attendeeUserIds: form.attendees,
      };
      mutation.mutate({ kind: 'update', id: event.id, body });
      return;
    }

    const body: CreateEventBody = {
      calendarId: form.calendarId,
      title: form.title.trim(),
      description: description || undefined,
      location: location || undefined,
      startsAt,
      endsAt,
      allDay: form.allDay,
      timezone,
      status: form.status,
      visibility: form.visibility,
      customerId: form.links.customerId,
      projectId: form.links.projectId,
      taskId: form.links.taskId,
      recurrence,
      reminders,
      attendeeUserIds: form.attendees,
    };
    mutation.mutate({ kind: 'create', body });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (mutation.isPending ? undefined : onOpenChange(next))}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? t('editEvent') : t('newEvent')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {error ? <ErrorState message={error} /> : null}

          <TextField
            id="event-title"
            label={t('fields.title')}
            value={form.title}
            onChange={(e) => patch({ title: e.target.value })}
          />

          <div className="space-y-2">
            <Label htmlFor="event-calendar">{t('fields.calendar')}</Label>
            <CalendarSelect
              id="event-calendar"
              ariaLabel={t('fields.calendar')}
              value={form.calendarId}
              onValueChange={(calendarId) => patch({ calendarId })}
            />
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant={form.allDay ? 'default' : 'outline'}
              aria-pressed={form.allDay}
              onClick={() => patch({ allDay: !form.allDay })}
            >
              {t('fields.allDay')}
            </Button>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="event-start">{t('fields.start')}</Label>
              {form.allDay ? (
                <input
                  id="event-start"
                  type="date"
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={isoToDateInput(form.startsAtIso)}
                  onChange={(e) =>
                    e.target.value ? patch({ startsAtIso: dateInputToIso(e.target.value) }) : null
                  }
                />
              ) : (
                <input
                  id="event-start"
                  type="datetime-local"
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={isoToDateTimeInput(form.startsAtIso)}
                  onChange={(e) =>
                    e.target.value
                      ? patch({ startsAtIso: dateTimeInputToIso(e.target.value) })
                      : null
                  }
                />
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="event-end">{t('fields.end')}</Label>
              {form.allDay ? (
                <input
                  id="event-end"
                  type="date"
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={isoToDateInput(form.endsAtIso)}
                  onChange={(e) =>
                    e.target.value ? patch({ endsAtIso: dateInputToIso(e.target.value) }) : null
                  }
                />
              ) : (
                <input
                  id="event-end"
                  type="datetime-local"
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={isoToDateTimeInput(form.endsAtIso)}
                  onChange={(e) =>
                    e.target.value ? patch({ endsAtIso: dateTimeInputToIso(e.target.value) }) : null
                  }
                />
              )}
            </div>
          </div>

          <TextField
            id="event-location"
            label={t('fields.location')}
            value={form.location}
            onChange={(e) => patch({ location: e.target.value })}
          />

          <TextareaField
            id="event-description"
            label={t('fields.description')}
            value={form.description}
            onChange={(e) => patch({ description: e.target.value })}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="event-status">{t('fields.status')}</Label>
              <Select
                value={form.status}
                onValueChange={(status) => patch({ status: status as EventStatus })}
              >
                <SelectTrigger id="event-status" aria-label={t('fields.status')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUSES.map((status) => (
                    <SelectItem key={status} value={status}>
                      {tStatus(status)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="event-visibility">{t('fields.visibility')}</Label>
              <Select
                value={form.visibility}
                onValueChange={(visibility) => patch({ visibility: visibility as EventVisibility })}
              >
                <SelectTrigger id="event-visibility" aria-label={t('fields.visibility')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {VISIBILITIES.map((visibility) => (
                    <SelectItem key={visibility} value={visibility}>
                      {tVisibility(visibility)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <BusinessLinkFields
            value={form.links}
            onChange={(links) => patch({ links })}
            enabled={open}
          />

          <div className="rounded-lg border border-border p-4">
            <RecurrenceFields
              value={form.recurrence}
              onChange={(recurrence) => patch({ recurrence })}
            />
          </div>

          <div className="rounded-lg border border-border p-4">
            <ReminderFields value={form.reminders} onChange={(reminders) => patch({ reminders })} />
          </div>

          <div className="space-y-2">
            <Label>{t('fields.attendees')}</Label>
            <AttendeePicker
              value={form.attendees}
              onChange={(attendees) => patch({ attendees })}
              responses={event?.attendees}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={mutation.isPending}
            onClick={() => onOpenChange(false)}
          >
            {tCommon('cancel')}
          </Button>
          <Button type="button" loading={mutation.isPending} onClick={submit}>
            {tCommon('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
