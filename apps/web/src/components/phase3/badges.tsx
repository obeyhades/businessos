'use client';

import type { AbsenceStatus, AbsenceType, EmploymentStatus } from '@businessos/types';
import { Badge, type BadgeProps } from '@businessos/ui';
import { useTranslations } from 'next-intl';

type Variant = NonNullable<BadgeProps['variant']>;

/** Certifications inside this many days of expiry are surfaced as "expires soon". */
export const CERT_EXPIRY_SOON_DAYS = 30;

const employmentStatusVariant: Record<EmploymentStatus, Variant> = {
  ONBOARDING: 'secondary',
  ACTIVE: 'default',
  ON_LEAVE: 'secondary',
  OFFBOARDING: 'outline',
  TERMINATED: 'outline',
};

const absenceStatusVariant: Record<AbsenceStatus, Variant> = {
  PENDING: 'secondary',
  APPROVED: 'default',
  REJECTED: 'destructive',
  CANCELLED: 'outline',
};

export function EmploymentStatusBadge({ status }: { status: EmploymentStatus }) {
  const t = useTranslations('employmentStatus');
  return <Badge variant={employmentStatusVariant[status]}>{t(status)}</Badge>;
}

export function AbsenceStatusBadge({ status }: { status: AbsenceStatus }) {
  const t = useTranslations('absenceStatus');
  return <Badge variant={absenceStatusVariant[status]}>{t(status)}</Badge>;
}

export function AbsenceTypeLabel({ type }: { type: AbsenceType }) {
  const t = useTranslations('absenceType');
  return <>{t(type)}</>;
}

/** Whole days from now until `expiresAt` (negative = already expired), or null. */
export function daysUntil(expiresAt: string | null): number | null {
  if (!expiresAt) return null;
  const expiry = new Date(expiresAt).getTime();
  if (Number.isNaN(expiry)) return null;
  const dayMs = 24 * 60 * 60 * 1000;
  return Math.ceil((expiry - Date.now()) / dayMs);
}

/** Attention badge computed from a certification's expiry; null-safe. */
export function CertificationExpiryBadge({ expiresAt }: { expiresAt: string | null }) {
  const t = useTranslations('certifications');
  const remaining = daysUntil(expiresAt);
  if (remaining === null) return null;
  if (remaining < 0) return <Badge variant="destructive">{t('expired')}</Badge>;
  if (remaining <= CERT_EXPIRY_SOON_DAYS)
    return <Badge variant="secondary">{t('expiringSoon')}</Badge>;
  return null;
}
