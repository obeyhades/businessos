'use client';

import type { TaxLine } from '@businessos/types';
import { Separator } from '@businessos/ui';
import { useTranslations } from 'next-intl';
import { Money } from './money';

interface TotalsBlockProps {
  currency: string;
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
  taxLines: TaxLine[];
  /** Invoice-only extras. */
  amountPaidMinor?: number;
  creditedMinor?: number;
  amountDueMinor?: number;
}

function Row({
  label,
  amountMinor,
  currency,
  strong = false,
}: {
  label: string;
  amountMinor: number;
  currency: string;
  strong?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between ${strong ? 'text-base font-semibold' : 'text-sm'}`}
    >
      <span className={strong ? '' : 'text-muted-foreground'}>{label}</span>
      <span>
        <Money amountMinor={amountMinor} currency={currency} />
      </span>
    </div>
  );
}

export function TotalsBlock({
  currency,
  subtotalMinor,
  discountMinor,
  taxMinor,
  totalMinor,
  taxLines,
  amountPaidMinor,
  creditedMinor,
  amountDueMinor,
}: TotalsBlockProps) {
  const t = useTranslations('billing');
  return (
    <div className="space-y-2">
      <Row label={t('subtotal')} amountMinor={subtotalMinor} currency={currency} />
      {discountMinor > 0 ? (
        <Row label={t('discount')} amountMinor={-discountMinor} currency={currency} />
      ) : null}
      {taxLines.map((taxLine) => (
        <Row
          key={taxLine.ratePercent}
          label={t('taxAtRate', { rate: taxLine.ratePercent })}
          amountMinor={taxLine.taxMinor}
          currency={currency}
        />
      ))}
      <Row label={t('taxTotal')} amountMinor={taxMinor} currency={currency} />
      <Separator />
      <Row label={t('total')} amountMinor={totalMinor} currency={currency} strong />
      {amountPaidMinor !== undefined || creditedMinor !== undefined ? (
        <>
          <Separator />
          {creditedMinor !== undefined && creditedMinor > 0 ? (
            <Row label={t('credited')} amountMinor={creditedMinor} currency={currency} />
          ) : null}
          {amountPaidMinor !== undefined ? (
            <Row label={t('amountPaid')} amountMinor={amountPaidMinor} currency={currency} />
          ) : null}
          {amountDueMinor !== undefined ? (
            <Row label={t('amountDue')} amountMinor={amountDueMinor} currency={currency} strong />
          ) : null}
        </>
      ) : null}
    </div>
  );
}
