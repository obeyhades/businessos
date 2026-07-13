'use client';

import type {
  AccountType,
  FiscalPeriodStatus,
  VoucherSource,
  VoucherStatus,
} from '@businessos/types';
import { Badge, type BadgeProps } from '@businessos/ui';
import { useTranslations } from 'next-intl';

type Variant = NonNullable<BadgeProps['variant']>;

const voucherStatusVariant: Record<VoucherStatus, Variant> = {
  DRAFT: 'secondary',
  POSTED: 'default',
  REVERSED: 'outline',
};

const fiscalPeriodStatusVariant: Record<FiscalPeriodStatus, Variant> = {
  OPEN: 'default',
  LOCKED: 'secondary',
  CLOSED: 'outline',
};

export function VoucherStatusBadge({ status }: { status: VoucherStatus }) {
  const t = useTranslations('voucherStatus');
  return <Badge variant={voucherStatusVariant[status]}>{t(status)}</Badge>;
}

export function FiscalPeriodStatusBadge({ status }: { status: FiscalPeriodStatus }) {
  const t = useTranslations('fiscalPeriodStatus');
  return <Badge variant={fiscalPeriodStatusVariant[status]}>{t(status)}</Badge>;
}

export function VoucherSourceBadge({ source }: { source: VoucherSource }) {
  const t = useTranslations('voucherSource');
  return <Badge variant="outline">{t(source)}</Badge>;
}

export function AccountTypeBadge({ type }: { type: AccountType }) {
  const t = useTranslations('accountType');
  return <Badge variant="outline">{t(type)}</Badge>;
}

/** Balanced / unbalanced indicator used across the journal and reports. */
export function BalancedBadge({ balanced }: { balanced: boolean }) {
  const t = useTranslations('accounting');
  return (
    <Badge variant={balanced ? 'default' : 'destructive'}>
      {balanced ? t('balanced') : t('unbalanced')}
    </Badge>
  );
}
