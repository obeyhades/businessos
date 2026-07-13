'use client';

import type { AttendeeResponse, OccurrenceDto } from '@businessos/types';
import {
  Button,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Separator,
} from '@businessos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, MapPin, Pencil, Repeat, Trash2, Users, XCircle } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { ErrorState, ListSkeleton } from '@/components/data-states';
import { api } from '@/lib/api';
import { useApiErrorMessage } from '@/lib/errors';
import { can, useSession } from '@/lib/session';
import { EventStatusBadge, RsvpBadge } from './calendar-indicators';
import { EventEditorDialog } from './event-editor-dialog';
import { OccurrenceOverrideDialog } from './occurrence-override-dialog';

const RSVP_OPTIONS: AttendeeResponse[] = ['ACCEPTED', 'TENTATIVE', 'DECLINED'];

function DetailRow({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 text-sm">
      <span className="mt-0.5 text-muted-foreground" aria-hidden="true">
        {icon}
      </span>
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  );
}

/**
 * Read view for a single occurrence: master details + this occurrence's time,
 * RSVP controls for the current user, and (for managers) the this-occurrence vs
 * whole-series edit/cancel/delete actions.
 */
export function EventDetailDialog({
  open,
  onOpenChange,
  occurrence,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  occurrence: OccurrenceDto;
  onChanged?: () => void;
}) {
  const t = useTranslations('calendar');
  const tCommon = useTranslations('common');
  const format = useFormatter();
  const queryClient = useQueryClient();
  const errorMessage = useApiErrorMessage();
  const { data: session } = useSession();
  const canManage = can(session, 'calendar.manage');
  const currentUserId = session?.user.id;

  const [editorOpen, setEditorOpen] = useState(false);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [cancelOccurrenceOpen, setCancelOccurrenceOpen] = useState(false);
  const [cancelSeriesOpen, setCancelSeriesOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const eventQuery = useQuery({
    queryKey: ['event', occurrence.eventId],
    queryFn: () => api.calendar.getEvent(occurrence.eventId),
    enabled: open,
  });
  const event = eventQuery.data;

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ['events'] });
    await queryClient.invalidateQueries({ queryKey: ['agenda'] });
    await queryClient.invalidateQueries({ queryKey: ['event', occurrence.eventId] });
    onChanged?.();
  };

  const rsvpMutation = useMutation({
    mutationFn: (response: AttendeeResponse) => api.calendar.rsvp(occurrence.eventId, { response }),
    onSuccess: async () => {
      toast.success(t('rsvpSaved'));
      await invalidate();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const cancelOccurrenceMutation = useMutation({
    mutationFn: () =>
      api.calendar.cancelOccurrence(occurrence.eventId, {
        occurrenceStart: occurrence.occurrenceStart,
      }),
    onSuccess: async () => {
      toast.success(t('occurrenceCancelled'));
      setCancelOccurrenceOpen(false);
      onOpenChange(false);
      await invalidate();
    },
    onError: (err) => {
      toast.error(errorMessage(err));
      setCancelOccurrenceOpen(false);
    },
  });

  const cancelSeriesMutation = useMutation({
    mutationFn: () => api.calendar.cancelEvent(occurrence.eventId),
    onSuccess: async () => {
      toast.success(t('eventCancelled'));
      setCancelSeriesOpen(false);
      onOpenChange(false);
      await invalidate();
    },
    onError: (err) => {
      toast.error(errorMessage(err));
      setCancelSeriesOpen(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.calendar.removeEvent(occurrence.eventId),
    onSuccess: async () => {
      toast.success(t('eventDeleted'));
      setDeleteOpen(false);
      onOpenChange(false);
      await invalidate();
    },
    onError: (err) => {
      toast.error(errorMessage(err));
      setDeleteOpen(false);
    },
  });

  const myAttendee = event?.attendees.find((a) => a.userId === currentUserId);

  function formatWhen(): string {
    const start = new Date(occurrence.start);
    const end = new Date(occurrence.end);
    if (occurrence.allDay) {
      return format.dateTime(start, { dateStyle: 'full' });
    }
    return `${format.dateTime(start, { dateStyle: 'medium', timeStyle: 'short' })} – ${format.dateTime(
      end,
      { timeStyle: 'short' },
    )}`;
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {occurrence.title}
              <EventStatusBadge status={occurrence.status} />
            </DialogTitle>
          </DialogHeader>

          {eventQuery.isPending ? (
            <ListSkeleton rows={4} />
          ) : eventQuery.isError ? (
            <ErrorState
              message={errorMessage(eventQuery.error)}
              onRetry={() => void eventQuery.refetch()}
            />
          ) : event ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <DetailRow icon={<CalendarClock className="size-4" />}>{formatWhen()}</DetailRow>
                {occurrence.isRecurring ? (
                  <DetailRow icon={<Repeat className="size-4" />}>
                    {occurrence.isException ? t('isException') : t('isRecurring')}
                  </DetailRow>
                ) : null}
                {event.location ? (
                  <DetailRow icon={<MapPin className="size-4" />}>{event.location}</DetailRow>
                ) : null}
                {event.attendees.length > 0 ? (
                  <DetailRow icon={<Users className="size-4" />}>
                    <span className="flex flex-wrap items-center gap-1.5">
                      {event.attendees.map((attendee) => (
                        <span key={attendee.id} className="inline-flex items-center gap-1">
                          <span>{attendee.name}</span>
                          <RsvpBadge response={attendee.response} />
                        </span>
                      ))}
                    </span>
                  </DetailRow>
                ) : null}
              </div>

              {event.description ? (
                <p className="whitespace-pre-wrap text-sm">{event.description}</p>
              ) : null}

              {myAttendee ? (
                <>
                  <Separator />
                  <div className="space-y-2">
                    <p className="text-sm font-medium">{t('yourResponse')}</p>
                    <div className="flex flex-wrap gap-2">
                      {RSVP_OPTIONS.map((response) => (
                        <Button
                          key={response}
                          type="button"
                          size="sm"
                          variant={myAttendee.response === response ? 'default' : 'outline'}
                          aria-pressed={myAttendee.response === response}
                          loading={rsvpMutation.isPending && rsvpMutation.variables === response}
                          onClick={() => rsvpMutation.mutate(response)}
                        >
                          {t(`rsvp.${response}`)}
                        </Button>
                      ))}
                    </div>
                  </div>
                </>
              ) : null}

              {canManage ? (
                <>
                  <Separator />
                  <div className="space-y-3">
                    {occurrence.isRecurring ? (
                      <div className="space-y-2">
                        <p className="text-sm font-medium">{t('thisOccurrence')}</p>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => setOverrideOpen(true)}
                          >
                            <Pencil aria-hidden="true" />
                            {t('editThisOccurrence')}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => setCancelOccurrenceOpen(true)}
                          >
                            <XCircle aria-hidden="true" />
                            {t('cancelThisOccurrence')}
                          </Button>
                        </div>
                      </div>
                    ) : null}

                    <div className="space-y-2">
                      <p className="text-sm font-medium">
                        {occurrence.isRecurring ? t('wholeSeries') : t('event')}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => setEditorOpen(true)}
                        >
                          <Pencil aria-hidden="true" />
                          {occurrence.isRecurring ? t('editSeries') : tCommon('edit')}
                        </Button>
                        {occurrence.status !== 'CANCELLED' ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => setCancelSeriesOpen(true)}
                          >
                            <XCircle aria-hidden="true" />
                            {occurrence.isRecurring ? t('cancelSeries') : t('cancelEvent')}
                          </Button>
                        ) : null}
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => setDeleteOpen(true)}
                        >
                          <Trash2 aria-hidden="true" />
                          {occurrence.isRecurring ? t('deleteSeries') : t('deleteEvent')}
                        </Button>
                      </div>
                    </div>
                  </div>
                </>
              ) : null}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {event ? (
        <EventEditorDialog
          open={editorOpen}
          onOpenChange={setEditorOpen}
          event={event}
          onSaved={() => onOpenChange(false)}
        />
      ) : null}

      <OccurrenceOverrideDialog
        open={overrideOpen}
        onOpenChange={setOverrideOpen}
        occurrence={occurrence}
        onSaved={() => onOpenChange(false)}
      />

      <ConfirmDialog
        open={cancelOccurrenceOpen}
        onOpenChange={setCancelOccurrenceOpen}
        title={t('cancelThisOccurrence')}
        description={t('cancelOccurrenceConfirm')}
        confirmLabel={t('cancelThisOccurrence')}
        cancelLabel={tCommon('cancel')}
        destructive
        pending={cancelOccurrenceMutation.isPending}
        onConfirm={() => cancelOccurrenceMutation.mutate()}
      />

      <ConfirmDialog
        open={cancelSeriesOpen}
        onOpenChange={setCancelSeriesOpen}
        title={occurrence.isRecurring ? t('cancelSeries') : t('cancelEvent')}
        description={t('cancelSeriesConfirm')}
        confirmLabel={occurrence.isRecurring ? t('cancelSeries') : t('cancelEvent')}
        cancelLabel={tCommon('cancel')}
        destructive
        pending={cancelSeriesMutation.isPending}
        onConfirm={() => cancelSeriesMutation.mutate()}
      />

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={occurrence.isRecurring ? t('deleteSeries') : t('deleteEvent')}
        description={t('deleteConfirm')}
        confirmLabel={occurrence.isRecurring ? t('deleteSeries') : t('deleteEvent')}
        cancelLabel={tCommon('cancel')}
        destructive
        pending={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate()}
      />
    </>
  );
}
