'use client';

import type { AttendeeResponse, EventStatus, OccurrenceDto } from '@businessos/types';
import { Badge, type BadgeProps } from '@businessos/ui';
import { Ban, Lock, Pencil, Repeat } from 'lucide-react';
import { useTranslations } from 'next-intl';

type Variant = NonNullable<BadgeProps['variant']>;

const eventStatusVariant: Record<EventStatus, Variant> = {
  CONFIRMED: 'default',
  TENTATIVE: 'secondary',
  CANCELLED: 'destructive',
};

export function EventStatusBadge({ status }: { status: EventStatus }) {
  const t = useTranslations('calendar.eventStatus');
  return <Badge variant={eventStatusVariant[status]}>{t(status)}</Badge>;
}

const rsvpVariant: Record<AttendeeResponse, Variant> = {
  NEEDS_ACTION: 'outline',
  ACCEPTED: 'default',
  DECLINED: 'destructive',
  TENTATIVE: 'secondary',
};

export function RsvpBadge({ response }: { response: AttendeeResponse }) {
  const t = useTranslations('calendar.rsvp');
  return <Badge variant={rsvpVariant[response]}>{t(response)}</Badge>;
}

/**
 * Inline icon indicators for an occurrence chip: recurring, per-occurrence
 * exception, private visibility, cancelled. Purely decorative, labelled for AT.
 */
export function OccurrenceIndicators({
  occurrence,
  className,
}: {
  occurrence: OccurrenceDto;
  className?: string;
}) {
  const t = useTranslations('calendar.indicators');
  return (
    <span className={className}>
      {occurrence.status === 'CANCELLED' ? (
        <Ban className="inline size-3" aria-label={t('cancelled')} />
      ) : null}
      {occurrence.visibility === 'PRIVATE' ? (
        <Lock className="inline size-3" aria-label={t('private')} />
      ) : null}
      {occurrence.isException ? (
        <Pencil className="inline size-3" aria-label={t('exception')} />
      ) : occurrence.isRecurring ? (
        <Repeat className="inline size-3" aria-label={t('recurring')} />
      ) : null}
    </span>
  );
}
