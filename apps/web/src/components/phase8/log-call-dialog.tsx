'use client';

import type { CallDirection } from '@businessos/types';
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
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ErrorState } from '@/components/data-states';
import { TextField, TextareaField } from '@/components/form-field';
import type { BusinessLinks } from '@/components/phase6/business-link-fields';
import { BusinessLinkFields } from '@/components/phase6/business-link-fields';
import { dateTimeInputToIso, isoToDateTimeInput } from '@/components/phase6/calendar-utils';
import { api } from '@/lib/api';
import { useApiErrorMessage } from '@/lib/errors';

const DIRECTIONS: CallDirection[] = ['INBOUND', 'OUTBOUND'];

function emptyLinks(): BusinessLinks {
  return { customerId: null, projectId: null, taskId: null };
}

/** Records a phone call as a note (no audio required). */
export function LogCallDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('recordings.call');
  const tDirection = useTranslations('recordings.direction');
  const tCommon = useTranslations('common');
  const queryClient = useQueryClient();
  const errorMessage = useApiErrorMessage();
  const router = useRouter();

  const [title, setTitle] = useState('');
  const [direction, setDirection] = useState<CallDirection>('INBOUND');
  const [fromNumber, setFromNumber] = useState('');
  const [toNumber, setToNumber] = useState('');
  const [duration, setDuration] = useState('');
  const [occurredAt, setOccurredAt] = useState('');
  const [notes, setNotes] = useState('');
  const [links, setLinks] = useState<BusinessLinks>(emptyLinks);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTitle('');
    setDirection('INBOUND');
    setFromNumber('');
    setToNumber('');
    setDuration('');
    setOccurredAt(isoToDateTimeInput(new Date().toISOString()));
    setNotes('');
    setLinks(emptyLinks());
    setError(null);
  }, [open]);

  const mutation = useMutation({
    mutationFn: () => {
      const parsedDuration = Number.parseInt(duration, 10);
      return api.recordings.createCallLog({
        title: title.trim(),
        direction,
        fromNumber: fromNumber.trim() || undefined,
        toNumber: toNumber.trim() || undefined,
        durationSeconds:
          Number.isFinite(parsedDuration) && parsedDuration >= 0 ? parsedDuration : undefined,
        occurredAt: occurredAt ? dateTimeInputToIso(occurredAt) : undefined,
        notes: notes.trim() || undefined,
        customerId: links.customerId ?? undefined,
        projectId: links.projectId ?? undefined,
        taskId: links.taskId ?? undefined,
      });
    },
    onSuccess: async (recording) => {
      toast.success(t('logged'));
      await queryClient.invalidateQueries({ queryKey: ['recordings'] });
      onOpenChange(false);
      router.push(`/recordings/${recording.id}`);
    },
    onError: (err) => setError(errorMessage(err)),
  });

  function submit() {
    setError(null);
    if (!title.trim()) {
      setError(t('titleRequired'));
      return;
    }
    mutation.mutate();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (mutation.isPending ? undefined : onOpenChange(next))}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {error ? <ErrorState message={error} /> : null}

          <TextField
            id="call-title"
            label={t('titleLabel')}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="call-direction">{t('direction')}</Label>
              <Select
                value={direction}
                onValueChange={(value) => setDirection(value as CallDirection)}
              >
                <SelectTrigger id="call-direction" aria-label={t('direction')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DIRECTIONS.map((value) => (
                    <SelectItem key={value} value={value}>
                      {tDirection(value)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="call-occurredAt">{t('occurredAt')}</Label>
              <input
                id="call-occurredAt"
                type="datetime-local"
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={occurredAt}
                onChange={(event) => setOccurredAt(event.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <TextField
              id="call-from"
              label={t('fromNumber')}
              value={fromNumber}
              onChange={(event) => setFromNumber(event.target.value)}
            />
            <TextField
              id="call-to"
              label={t('toNumber')}
              value={toNumber}
              onChange={(event) => setToNumber(event.target.value)}
            />
            <TextField
              id="call-duration"
              type="number"
              min={0}
              inputMode="numeric"
              label={t('durationSeconds')}
              value={duration}
              onChange={(event) => setDuration(event.target.value)}
            />
          </div>

          <TextareaField
            id="call-notes"
            label={t('notes')}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />

          <BusinessLinkFields value={links} onChange={setLinks} enabled={open} />
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
            {t('submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
