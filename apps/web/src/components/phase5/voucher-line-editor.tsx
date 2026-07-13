'use client';

import type { AccountDto, VoucherLineDto, VoucherLineInput } from '@businessos/types';
import {
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@businessos/ui';
import { Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { majorToMinor, minorToMajorText, Money } from '@/components/phase4/money';
import { AccountSelect } from './account-select';

export type VoucherSide = 'debit' | 'credit';

/** A voucher line as edited in the UI. Amount is kept as a major-unit string. */
export interface VoucherEditorLine {
  key: string;
  accountId: string;
  description: string;
  side: VoucherSide;
  amountMajor: string;
}

let keyCounter = 0;
function nextKey(): string {
  keyCounter += 1;
  return `vline-${keyCounter}`;
}

export function newVoucherLine(side: VoucherSide = 'debit'): VoucherEditorLine {
  return { key: nextKey(), accountId: '', description: '', side, amountMajor: '0' };
}

export function voucherEditorLinesFromDto(lines: VoucherLineDto[]): VoucherEditorLine[] {
  return lines.map((line) => {
    const side: VoucherSide = line.debitMinor > 0 ? 'debit' : 'credit';
    const minor = side === 'debit' ? line.debitMinor : line.creditMinor;
    return {
      key: nextKey(),
      accountId: line.accountId,
      description: line.description ?? '',
      side,
      amountMajor: minorToMajorText(minor),
    };
  });
}

/** Converts editor rows into the server voucher-line input shape. */
export function voucherEditorLinesToInput(lines: VoucherEditorLine[]): VoucherLineInput[] {
  return lines.map((line) => {
    const minor = majorToMinor(line.amountMajor);
    return {
      accountId: line.accountId,
      description: line.description.trim() === '' ? undefined : line.description.trim(),
      debitMinor: line.side === 'debit' ? minor : 0,
      creditMinor: line.side === 'credit' ? minor : 0,
    };
  });
}

export interface VoucherTotals {
  totalDebitMinor: number;
  totalCreditMinor: number;
  differenceMinor: number;
  balanced: boolean;
}

/** Live running totals for the editor (client-side hint; server is authoritative). */
export function voucherTotals(lines: VoucherEditorLine[]): VoucherTotals {
  let totalDebitMinor = 0;
  let totalCreditMinor = 0;
  for (const line of lines) {
    const minor = majorToMinor(line.amountMajor);
    if (line.side === 'debit') totalDebitMinor += minor;
    else totalCreditMinor += minor;
  }
  return {
    totalDebitMinor,
    totalCreditMinor,
    differenceMinor: totalDebitMinor - totalCreditMinor,
    balanced: totalDebitMinor === totalCreditMinor && totalDebitMinor > 0,
  };
}

/** True when every line has an account and a positive amount, and there are ≥2 lines. */
export function voucherLinesComplete(lines: VoucherEditorLine[]): boolean {
  return (
    lines.length >= 2 &&
    lines.every((line) => line.accountId !== '' && majorToMinor(line.amountMajor) > 0)
  );
}

export function VoucherLineEditor({
  lines,
  onChange,
  accounts,
  currency,
  disabled = false,
}: {
  lines: VoucherEditorLine[];
  onChange: (lines: VoucherEditorLine[]) => void;
  accounts: AccountDto[];
  currency: string;
  disabled?: boolean;
}) {
  const t = useTranslations('accounting');

  function update(key: string, patch: Partial<VoucherEditorLine>) {
    onChange(lines.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  function addLine() {
    onChange([...lines, newVoucherLine()]);
  }

  function removeLine(key: string) {
    onChange(lines.filter((line) => line.key !== key));
  }

  const totals = voucherTotals(lines);

  return (
    <div className="space-y-4">
      <ul className="space-y-4">
        {lines.map((line) => (
          <li key={line.key} className="rounded-lg border border-border p-4">
            <div className="grid gap-3 sm:grid-cols-12">
              <div className="space-y-1.5 sm:col-span-8">
                <Label htmlFor={`${line.key}-account`}>{t('lineAccount')}</Label>
                <AccountSelect
                  id={`${line.key}-account`}
                  ariaLabel={t('lineAccount')}
                  value={line.accountId}
                  onValueChange={(value) => update(line.key, { accountId: value })}
                  accounts={accounts}
                  disabled={disabled}
                />
              </div>
              <div className="flex items-end justify-end sm:col-span-4">
                {!disabled ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={t('lineRemove')}
                    disabled={lines.length <= 2}
                    onClick={() => removeLine(line.key)}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                ) : null}
              </div>

              <div className="space-y-1.5 sm:col-span-6">
                <Label htmlFor={`${line.key}-description`}>{t('lineDescription')}</Label>
                <Input
                  id={`${line.key}-description`}
                  value={line.description}
                  onChange={(event) => update(line.key, { description: event.target.value })}
                  disabled={disabled}
                />
              </div>
              <div className="space-y-1.5 sm:col-span-3">
                <Label htmlFor={`${line.key}-side`}>{t('lineSide')}</Label>
                <Select
                  value={line.side}
                  onValueChange={(value) => update(line.key, { side: value as VoucherSide })}
                  disabled={disabled}
                >
                  <SelectTrigger id={`${line.key}-side`} aria-label={t('lineSide')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="debit">{t('debit')}</SelectItem>
                    <SelectItem value="credit">{t('credit')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 sm:col-span-3">
                <Label htmlFor={`${line.key}-amount`}>{t('lineAmount')}</Label>
                <Input
                  id={`${line.key}-amount`}
                  inputMode="decimal"
                  value={line.amountMajor}
                  onChange={(event) => update(line.key, { amountMajor: event.target.value })}
                  disabled={disabled}
                />
              </div>
            </div>
          </li>
        ))}
      </ul>

      {!disabled ? (
        <Button type="button" variant="outline" size="sm" onClick={addLine}>
          <Plus aria-hidden="true" />
          {t('addLine')}
        </Button>
      ) : null}

      <div className="rounded-lg border border-border p-4">
        <dl className="space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <dt className="text-muted-foreground">{t('totalDebit')}</dt>
            <dd className="font-medium">
              <Money amountMinor={totals.totalDebitMinor} currency={currency} />
            </dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-muted-foreground">{t('totalCredit')}</dt>
            <dd className="font-medium">
              <Money amountMinor={totals.totalCreditMinor} currency={currency} />
            </dd>
          </div>
          <div className="flex items-center justify-between border-t border-border pt-2">
            <dt className="text-muted-foreground">{t('difference')}</dt>
            <dd
              className={
                totals.balanced ? 'font-medium text-foreground' : 'font-medium text-destructive'
              }
            >
              {totals.balanced ? (
                t('balanced')
              ) : (
                <Money amountMinor={totals.differenceMinor} currency={currency} />
              )}
            </dd>
          </div>
        </dl>
      </div>
    </div>
  );
}

/** Read-only rendering of an immutable voucher's lines. */
export function VoucherLineTable({
  lines,
  currency,
}: {
  lines: VoucherLineDto[];
  currency: string;
}) {
  const t = useTranslations('accounting');
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-muted-foreground">
            <th className="py-2 pr-3 font-medium">{t('lineAccount')}</th>
            <th className="py-2 px-3 font-medium">{t('lineDescription')}</th>
            <th className="py-2 px-3 text-right font-medium">{t('debit')}</th>
            <th className="py-2 pl-3 text-right font-medium">{t('credit')}</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.id} className="border-b border-border last:border-0">
              <td className="py-2 pr-3">
                <span className="font-medium">{line.accountCode}</span> · {line.accountName}
              </td>
              <td className="py-2 px-3">{line.description ?? '—'}</td>
              <td className="py-2 px-3 text-right">
                {line.debitMinor > 0 ? (
                  <Money amountMinor={line.debitMinor} currency={currency} />
                ) : (
                  '—'
                )}
              </td>
              <td className="py-2 pl-3 text-right">
                {line.creditMinor > 0 ? (
                  <Money amountMinor={line.creditMinor} currency={currency} />
                ) : (
                  '—'
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
