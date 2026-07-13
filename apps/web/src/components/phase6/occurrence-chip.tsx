'use client';

import type { OccurrenceDto } from '@businessos/types';
import { cn } from '@businessos/ui';
import { useFormatter, useTranslations } from 'next-intl';
import { OccurrenceIndicators } from './calendar-indicators';

/** A compact, clickable pill for one occurrence inside a day cell or list. */
export function OccurrenceChip({
  occurrence,
  color,
  onClick,
}: {
  occurrence: OccurrenceDto;
  color: string;
  onClick: () => void;
}) {
  const t = useTranslations('calendar');
  const format = useFormatter();
  const cancelled = occurrence.status === 'CANCELLED';

  return (
    <button
      type="button"
      onClick={onClick}
      title={occurrence.title}
      className={cn(
        'flex w-full items-center gap-1 rounded px-1.5 py-0.5 text-left text-xs hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        cancelled && 'opacity-60',
      )}
    >
      <span
        aria-hidden="true"
        className="size-2 shrink-0 rounded-full"
        style={{ backgroundColor: color }}
      />
      {!occurrence.allDay ? (
        <span className="shrink-0 tabular-nums text-muted-foreground">
          {format.dateTime(new Date(occurrence.start), { timeStyle: 'short' })}
        </span>
      ) : (
        <span className="shrink-0 text-muted-foreground">{t('allDayShort')}</span>
      )}
      <span className={cn('min-w-0 flex-1 truncate', cancelled && 'line-through')}>
        {occurrence.title}
      </span>
      <OccurrenceIndicators
        occurrence={occurrence}
        className="flex shrink-0 items-center gap-0.5"
      />
    </button>
  );
}
