'use client';

import { webhookableEventTypes } from '@businessos/types';
import { Label } from '@businessos/ui';
import { useTranslations } from 'next-intl';

/**
 * Event-type picker. `value` is the raw subscription array sent to the API:
 * either `['*']` (all events) or a list of specific event types.
 */
export function EventTypeField({
  value,
  onChange,
  disabled = false,
  error,
}: {
  value: string[];
  onChange: (value: string[]) => void;
  disabled?: boolean;
  error?: string;
}) {
  const t = useTranslations('integrations.events');
  const tForm = useTranslations('integrations.form');
  const all = value.includes('*');
  const selected = new Set(value.filter((v) => v !== '*'));
  const errorId = 'webhook-events-error';

  function toggleEvent(event: string): void {
    const next = new Set(selected);
    if (next.has(event)) next.delete(event);
    else next.add(event);
    onChange([...next]);
  }

  return (
    <fieldset
      className="space-y-3"
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? errorId : undefined}
    >
      <legend className="mb-2 text-sm font-medium leading-none">{tForm('events')}</legend>

      <label className="flex items-start gap-3">
        <input
          type="radio"
          name="webhook-event-mode"
          className="mt-0.5 size-4 accent-primary"
          checked={all}
          disabled={disabled}
          onChange={() => onChange(['*'])}
        />
        <span className="space-y-0.5">
          <span className="block text-sm font-medium">{t('all')}</span>
          <span className="block text-sm text-muted-foreground">{t('allHint')}</span>
        </span>
      </label>

      <label className="flex items-start gap-3">
        <input
          type="radio"
          name="webhook-event-mode"
          className="mt-0.5 size-4 accent-primary"
          checked={!all}
          disabled={disabled}
          onChange={() => onChange([])}
        />
        <span className="space-y-0.5">
          <span className="block text-sm font-medium">{t('specific')}</span>
          {!all ? (
            <span className="block text-sm text-muted-foreground">
              {t('selectedCount', { count: selected.size })}
            </span>
          ) : null}
        </span>
      </label>

      {!all ? (
        <div className="max-h-56 space-y-1 overflow-y-auto rounded-md border border-border p-3">
          {webhookableEventTypes.map((event) => {
            const id = `webhook-event-${event}`;
            return (
              <label key={event} htmlFor={id} className="flex items-center gap-2 py-0.5">
                <input
                  id={id}
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={selected.has(event)}
                  disabled={disabled}
                  onChange={() => toggleEvent(event)}
                />
                <Label htmlFor={id} className="cursor-pointer font-mono text-xs font-normal">
                  {event}
                </Label>
              </label>
            );
          })}
        </div>
      ) : null}

      {error ? (
        <p id={errorId} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
