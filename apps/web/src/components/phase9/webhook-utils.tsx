'use client';

import type { WebhookDeliveryStatusDto, WebhookEndpointDto } from '@businessos/types';
import { Badge, cn } from '@businessos/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useApiErrorMessage } from '@/lib/errors';

const DELIVERY_BADGE_VARIANT: Record<
  WebhookDeliveryStatusDto,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  PENDING: 'secondary',
  SUCCEEDED: 'default',
  FAILED: 'destructive',
};

export function DeliveryStatusBadge({ status }: { status: WebhookDeliveryStatusDto }) {
  const t = useTranslations('integrations.status');
  return <Badge variant={DELIVERY_BADGE_VARIANT[status]}>{t(status)}</Badge>;
}

/** Pure, controlled switch UI (no component in the design system yet). */
export function ToggleSwitch({
  checked,
  onCheckedChange,
  disabled = false,
  label,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'bg-primary' : 'bg-input',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'inline-block size-4 rounded-full bg-background shadow-sm transition-transform',
          checked ? 'translate-x-[18px]' : 'translate-x-0.5',
        )}
      />
    </button>
  );
}

/** List-row toggle that persists the enabled flag via the API. */
export function EnabledToggle({
  endpoint,
  canManage,
}: {
  endpoint: WebhookEndpointDto;
  canManage: boolean;
}) {
  const t = useTranslations('integrations');
  const queryClient = useQueryClient();
  const errorMessage = useApiErrorMessage();

  const mutation = useMutation({
    mutationFn: (enabled: boolean) => api.webhooks.update(endpoint.id, { enabled }),
    onSuccess: async (updated) => {
      queryClient.setQueryData(['webhook', updated.id], updated);
      await queryClient.invalidateQueries({ queryKey: ['webhooks'] });
      toast.success(updated.enabled ? t('toggle.enabled') : t('toggle.disabled'));
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <ToggleSwitch
      checked={endpoint.enabled}
      disabled={!canManage || mutation.isPending}
      onCheckedChange={(next) => mutation.mutate(next)}
      label={t('toggleAria')}
    />
  );
}

const MAX_CHIPS = 4;

/** Renders subscribed event types as chips ("All events" when wildcard). */
export function EventChips({ eventTypes }: { eventTypes: string[] }) {
  const t = useTranslations('integrations.list');
  if (eventTypes.includes('*')) {
    return <Badge variant="secondary">{t('allEvents')}</Badge>;
  }
  const shown = eventTypes.slice(0, MAX_CHIPS);
  const extra = eventTypes.length - shown.length;
  return (
    <span className="flex flex-wrap gap-1">
      {shown.map((event) => (
        <Badge key={event} variant="outline" className="font-mono font-normal">
          {event}
        </Badge>
      ))}
      {extra > 0 ? <Badge variant="outline">{t('moreEvents', { count: extra })}</Badge> : null}
    </span>
  );
}
