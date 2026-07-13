'use client';

import type { AccountDto } from '@businessos/types';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@businessos/ui';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { api } from '@/lib/api';

const ACCOUNT_PAGE_SIZE = 500;

/** Shared query for a flat list of active accounts used to populate pickers. */
export function useAccountOptions(activeOnly = true) {
  return useQuery({
    queryKey: ['accounts', 'options', { activeOnly }],
    queryFn: () =>
      api.accounting.listAccounts({
        page: 1,
        pageSize: ACCOUNT_PAGE_SIZE,
        active: activeOnly ? 'true' : undefined,
      }),
  });
}

function accountLabel(account: AccountDto): string {
  return `${account.code} · ${account.name}`;
}

/**
 * Account picker. Value is an account id (empty string means nothing selected).
 * Optionally include a "none" entry to allow clearing (used by account mapping).
 */
export function AccountSelect({
  value,
  onValueChange,
  id,
  ariaLabel,
  accounts,
  disabled = false,
  noneLabel,
}: {
  value: string;
  onValueChange: (value: string) => void;
  id?: string;
  ariaLabel: string;
  accounts: AccountDto[];
  disabled?: boolean;
  noneLabel?: string;
}) {
  const t = useTranslations('accounting');
  const NONE = '__none__';
  return (
    <Select
      value={value === '' && noneLabel ? NONE : value}
      onValueChange={(next) => onValueChange(next === NONE ? '' : next)}
      disabled={disabled}
    >
      <SelectTrigger id={id} aria-label={ariaLabel}>
        <SelectValue placeholder={t('selectAccount')} />
      </SelectTrigger>
      <SelectContent>
        {noneLabel ? <SelectItem value={NONE}>{noneLabel}</SelectItem> : null}
        {accounts.map((account) => (
          <SelectItem key={account.id} value={account.id}>
            {accountLabel(account)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
