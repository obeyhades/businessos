'use client';

import type { CreditNoteStatus, InvoiceStatus, QuoteStatus } from '@businessos/types';
import { Badge, type BadgeProps } from '@businessos/ui';
import { useTranslations } from 'next-intl';

type Variant = NonNullable<BadgeProps['variant']>;

const quoteStatusVariant: Record<QuoteStatus, Variant> = {
  DRAFT: 'secondary',
  SENT: 'default',
  ACCEPTED: 'default',
  DECLINED: 'destructive',
  EXPIRED: 'outline',
};

const invoiceStatusVariant: Record<InvoiceStatus, Variant> = {
  DRAFT: 'secondary',
  OPEN: 'default',
  SENT: 'default',
  PARTIALLY_PAID: 'secondary',
  PAID: 'outline',
  OVERDUE: 'destructive',
  CANCELLED: 'outline',
  CREDITED: 'outline',
};

const creditNoteStatusVariant: Record<CreditNoteStatus, Variant> = {
  DRAFT: 'secondary',
  ISSUED: 'default',
};

export function QuoteStatusBadge({ status }: { status: QuoteStatus }) {
  const t = useTranslations('quoteStatus');
  return <Badge variant={quoteStatusVariant[status]}>{t(status)}</Badge>;
}

/**
 * Invoice status badge. When `isOverdue` is true and the stored status is not
 * already OVERDUE (a derived flag can precede the nightly job), an extra
 * destructive "Overdue" badge is shown alongside the status.
 */
export function InvoiceStatusBadge({
  status,
  isOverdue = false,
}: {
  status: InvoiceStatus;
  isOverdue?: boolean;
}) {
  const t = useTranslations('invoiceStatus');
  const showOverdue = isOverdue && status !== 'OVERDUE';
  return (
    <span className="inline-flex items-center gap-1.5">
      <Badge variant={invoiceStatusVariant[status]}>{t(status)}</Badge>
      {showOverdue ? <Badge variant="destructive">{t('OVERDUE')}</Badge> : null}
    </span>
  );
}

export function CreditNoteStatusBadge({ status }: { status: CreditNoteStatus }) {
  const t = useTranslations('creditNoteStatus');
  return <Badge variant={creditNoteStatusVariant[status]}>{t(status)}</Badge>;
}
