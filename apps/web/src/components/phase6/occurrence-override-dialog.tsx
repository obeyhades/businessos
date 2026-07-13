'use client';

import type { EventStatus, OccurrenceDto, OverrideOccurrenceBody } from '@businessos/types';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
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
import { TextField } from '@/components/form-field';
import { api } from '@/lib/api';
import { useApiErrorMessage } from '@/lib/errors';
import {
  dateInputToIso,
  dateTimeInputToIso,
  isoToDateInput,
  isoToDateTimeInput,
} from './calendar-utils';

const STATUSES: EventStatus[] = ['CONFIRMED', 'TENTATIVE', 'CANCELLED'];

/**
 * Edit a single occurrence of a recurring series without touching the master.
 * Sends the occurrence's original `occurrenceStart` as the identity plus the
 * overridden fields.
 */
export function OccurrenceOverrideDialog({
  open,
  onOpenChange,
  occurrence,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  occurrence: OccurrenceDto;
  onSaved?: () => void;
}) {
  const t = useTranslations('calendar');
  const tStatus = useTranslations('calendar.eventStatus');
  const tCommon = useTranslations('common');
  const queryClient = useQueryClient();
  const errorMessage = useApiErrorMessage();

  const [title, setTitle] = useState(occurrence.title);
  const [startsAtIso, setStartsAtIso] = useState(occurrence.start);
  const [endsAtIso, setEndsAtIso] = useState(occurrence.end);
  const [location, setLocation] = useState(occurrence.location ?? '');
  const [status, setStatus] = useState<EventStatus>(occurrence.status);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTitle(occurrence.title);
      setStartsAtIso(occurrence.start);
      setEndsAtIso(occurrence.end);
      setLocation(occurrence.location ?? '');
      setStatus(occurrence.status);
      setError(null);
    }
  }, [open, occurrence]);

  const mutation = useMutation({
    mutationFn: (body: OverrideOccurrenceBody) =>
      api.calendar.overrideOccurrence(occurrence.eventId, body),
    onSuccess: async () => {
      toast.success(t('occurrenceUpdated'));
      await queryClient.invalidateQueries({ queryKey: ['events'] });
      await queryClient.invalidateQueries({ queryKey: ['agenda'] });
      await queryClient.invalidateQueries({ queryKey: ['event', occurrence.eventId] });
      onOpenChange(false);
      onSaved?.();
    },
    onError: (err) => setError(errorMessage(err)),
  });

  function submit() {
    setError(null);
    if (!title.trim()) {
      setError(t('errors.titleRequired'));
      return;
    }
    let endsAt = endsAtIso;
    if (new Date(endsAt).getTime() < new Date(startsAtIso).getTime()) endsAt = startsAtIso;
    mutation.mutate({
      occurrenceStart: occurrence.occurrenceStart,
      title: title.trim(),
      startsAt: startsAtIso,
      endsAt,
      location: location.trim() ? location.trim() : null,
      status,
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (mutation.isPending ? undefined : onOpenChange(next))}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('editOccurrence')}</DialogTitle>
          <DialogDescription>{t('editOccurrenceHint')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {error ? <ErrorState message={error} /> : null}

          <TextField
            id="occurrence-title"
            label={t('fields.title')}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="occurrence-start">{t('fields.start')}</Label>
              {occurrence.allDay ? (
                <input
                  id="occurrence-start"
                  type="date"
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={isoToDateInput(startsAtIso)}
                  onChange={(e) =>
                    e.target.value ? setStartsAtIso(dateInputToIso(e.target.value)) : null
                  }
                />
              ) : (
                <input
                  id="occurrence-start"
                  type="datetime-local"
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={isoToDateTimeInput(startsAtIso)}
                  onChange={(e) =>
                    e.target.value ? setStartsAtIso(dateTimeInputToIso(e.target.value)) : null
                  }
                />
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="occurrence-end">{t('fields.end')}</Label>
              {occurrence.allDay ? (
                <input
                  id="occurrence-end"
                  type="date"
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={isoToDateInput(endsAtIso)}
                  onChange={(e) =>
                    e.target.value ? setEndsAtIso(dateInputToIso(e.target.value)) : null
                  }
                />
              ) : (
                <input
                  id="occurrence-end"
                  type="datetime-local"
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={isoToDateTimeInput(endsAtIso)}
                  onChange={(e) =>
                    e.target.value ? setEndsAtIso(dateTimeInputToIso(e.target.value)) : null
                  }
                />
              )}
            </div>
          </div>

          <TextField
            id="occurrence-location"
            label={t('fields.location')}
            value={location}
            onChange={(e) => setLocation(e.target.value)}
          />

          <div className="space-y-2">
            <Label htmlFor="occurrence-status">{t('fields.status')}</Label>
            <Select value={status} onValueChange={(next) => setStatus(next as EventStatus)}>
              <SelectTrigger id="occurrence-status" aria-label={t('fields.status')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUSES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {tStatus(value)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
