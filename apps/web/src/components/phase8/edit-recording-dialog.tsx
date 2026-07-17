'use client';

import type { RecordingDto } from '@businessos/types';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
} from '@businessos/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ErrorState } from '@/components/data-states';
import { TextField } from '@/components/form-field';
import type { BusinessLinks } from '@/components/phase6/business-link-fields';
import { BusinessLinkFields } from '@/components/phase6/business-link-fields';
import { dateTimeInputToIso, isoToDateTimeInput } from '@/components/phase6/calendar-utils';
import { api } from '@/lib/api';
import { useApiErrorMessage } from '@/lib/errors';

/** Edits a recording's title, date and business links. */
export function EditRecordingDialog({
  open,
  onOpenChange,
  recording,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recording: RecordingDto;
}) {
  const t = useTranslations('recordings.edit');
  const tCommon = useTranslations('common');
  const queryClient = useQueryClient();
  const errorMessage = useApiErrorMessage();

  const [title, setTitle] = useState('');
  const [occurredAt, setOccurredAt] = useState('');
  const [links, setLinks] = useState<BusinessLinks>({
    customerId: null,
    projectId: null,
    taskId: null,
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTitle(recording.title);
    setOccurredAt(isoToDateTimeInput(recording.occurredAt));
    setLinks({
      customerId: recording.customerId,
      projectId: recording.projectId,
      taskId: recording.taskId,
    });
    setError(null);
  }, [open, recording]);

  const mutation = useMutation({
    mutationFn: () =>
      api.recordings.update(recording.id, {
        title: title.trim(),
        occurredAt: occurredAt ? dateTimeInputToIso(occurredAt) : undefined,
        customerId: links.customerId,
        projectId: links.projectId,
        taskId: links.taskId,
      }),
    onSuccess: async () => {
      toast.success(t('saved'));
      await queryClient.invalidateQueries({ queryKey: ['recordings'] });
      await queryClient.invalidateQueries({ queryKey: ['recording', recording.id] });
      onOpenChange(false);
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
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {error ? <ErrorState message={error} /> : null}

          <TextField
            id="edit-recording-title"
            label={t('titleLabel')}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />

          <div className="space-y-2">
            <Label htmlFor="edit-recording-occurredAt">{t('occurredAt')}</Label>
            <input
              id="edit-recording-occurredAt"
              type="datetime-local"
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={occurredAt}
              onChange={(event) => setOccurredAt(event.target.value)}
            />
          </div>

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
            {tCommon('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
