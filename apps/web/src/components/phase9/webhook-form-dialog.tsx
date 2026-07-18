'use client';

import type { WebhookEndpointDto, WebhookEndpointWithSecretDto } from '@businessos/types';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@businessos/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ErrorState } from '@/components/data-states';
import { TextareaField, TextField } from '@/components/form-field';
import { api } from '@/lib/api';
import { useApiErrorMessage } from '@/lib/errors';
import { EventTypeField } from './event-type-field';
import { ToggleSwitch } from './webhook-utils';

type Mode = 'create' | 'edit';

export function WebhookFormDialog({
  open,
  onOpenChange,
  mode,
  endpoint,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: Mode;
  endpoint?: WebhookEndpointDto;
  onCreated?: (created: WebhookEndpointWithSecretDto) => void;
}) {
  const t = useTranslations('integrations.form');
  const tEvents = useTranslations('integrations.events');
  const tCommon = useTranslations('common');
  const queryClient = useQueryClient();
  const errorMessage = useApiErrorMessage();

  const [url, setUrl] = useState('');
  const [description, setDescription] = useState('');
  const [eventTypes, setEventTypes] = useState<string[]>(['*']);
  const [enabled, setEnabled] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [eventsError, setEventsError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setEventsError(null);
    if (mode === 'edit' && endpoint) {
      setUrl(endpoint.url);
      setDescription(endpoint.description ?? '');
      setEventTypes(endpoint.eventTypes);
      setEnabled(endpoint.enabled);
    } else {
      setUrl('');
      setDescription('');
      setEventTypes(['*']);
      setEnabled(true);
    }
  }, [open, mode, endpoint]);

  const createMutation = useMutation({
    mutationFn: () =>
      api.webhooks.create({
        url: url.trim(),
        description: description.trim() ? description.trim() : undefined,
        eventTypes,
        enabled,
      }),
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: ['webhooks'] });
      onOpenChange(false);
      onCreated?.(created);
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const updateMutation = useMutation({
    mutationFn: () => {
      if (!endpoint) throw new Error('missing_endpoint');
      return api.webhooks.update(endpoint.id, {
        url: url.trim(),
        description: description.trim() ? description.trim() : null,
        eventTypes,
        enabled,
      });
    },
    onSuccess: async (updated) => {
      queryClient.setQueryData(['webhook', updated.id], updated);
      await queryClient.invalidateQueries({ queryKey: ['webhooks'] });
      toast.success(t('updated'));
      onOpenChange(false);
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const pending = createMutation.isPending || updateMutation.isPending;

  function submit(): void {
    setError(null);
    setEventsError(null);
    if (!url.trim()) {
      setError(t('urlRequired'));
      return;
    }
    if (eventTypes.length === 0) {
      setEventsError(tEvents('selectAtLeastOne'));
      return;
    }
    if (mode === 'edit') updateMutation.mutate();
    else createMutation.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (pending ? undefined : onOpenChange(next))}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{mode === 'edit' ? t('editTitle') : t('addTitle')}</DialogTitle>
          <DialogDescription>
            {mode === 'edit' ? t('editDescription') : t('addDescription')}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {error ? <ErrorState message={error} /> : null}

          <div className="space-y-1">
            <TextField
              id="webhook-url"
              type="url"
              inputMode="url"
              label={t('url')}
              placeholder={t('urlPlaceholder')}
              value={url}
              onChange={(event) => setUrl(event.target.value)}
            />
            <p className="text-sm text-muted-foreground">{t('urlHint')}</p>
          </div>

          <TextareaField
            id="webhook-description"
            label={t('description')}
            placeholder={t('descriptionPlaceholder')}
            rows={2}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />

          <EventTypeField
            value={eventTypes}
            onChange={setEventTypes}
            disabled={pending}
            error={eventsError ?? undefined}
          />

          <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
            <span className="text-sm">{t('enabledLabel')}</span>
            <ToggleSwitch
              checked={enabled}
              disabled={pending}
              onCheckedChange={setEnabled}
              label={t('enabledLabel')}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => onOpenChange(false)}
          >
            {tCommon('cancel')}
          </Button>
          <Button type="button" loading={pending} onClick={submit}>
            {mode === 'edit' ? t('submitEdit') : t('submitAdd')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
