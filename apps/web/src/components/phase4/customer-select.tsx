'use client';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@businessos/ui';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { api } from '@/lib/api';

const CUSTOMER_PAGE_SIZE = 100;

/** Shared query for a flat list of customers used to populate pickers. */
export function useCustomerOptions() {
  return useQuery({
    queryKey: ['customers', 'options'],
    queryFn: () => api.customers.list({ page: 1, pageSize: CUSTOMER_PAGE_SIZE }),
  });
}

/**
 * Customer picker for create forms. Value is a customer id (empty string means
 * nothing selected). Used inside react-hook-form Controllers.
 */
export function CustomerSelect({
  value,
  onValueChange,
  id,
  ariaLabel,
}: {
  value: string;
  onValueChange: (value: string) => void;
  id?: string;
  ariaLabel: string;
}) {
  const t = useTranslations('billing');
  const customersQuery = useCustomerOptions();
  return (
    <Select value={value} onValueChange={onValueChange} disabled={customersQuery.isPending}>
      <SelectTrigger id={id} aria-label={ariaLabel}>
        <SelectValue placeholder={t('selectCustomer')} />
      </SelectTrigger>
      <SelectContent>
        {(customersQuery.data?.items ?? []).map((customer) => (
          <SelectItem key={customer.id} value={customer.id}>
            {customer.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const ALL = 'ALL';

/** Customer filter for list pages. Emits `undefined` when "all" is selected. */
export function CustomerFilter({
  value,
  onChange,
  ariaLabel,
}: {
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  ariaLabel: string;
}) {
  const t = useTranslations('billing');
  const customersQuery = useCustomerOptions();
  return (
    <Select
      value={value ?? ALL}
      onValueChange={(next) => onChange(next === ALL ? undefined : next)}
    >
      <SelectTrigger className="w-full sm:w-56" aria-label={ariaLabel}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{t('allCustomers')}</SelectItem>
        {(customersQuery.data?.items ?? []).map((customer) => (
          <SelectItem key={customer.id} value={customer.id}>
            {customer.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
