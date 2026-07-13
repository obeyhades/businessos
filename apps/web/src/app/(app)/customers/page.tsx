'use client';

import { CUSTOMER_STATUSES, type CustomerStatus } from '@businessos/types';
import {
  Button,
  Card,
  CardContent,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '@businessos/ui';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { EmptyState, ErrorState, ListSkeleton } from '@/components/data-states';
import { CustomerStatusBadge } from '@/components/phase2/badges';
import { CustomerFormDialog } from '@/components/phase2/customer-form-dialog';
import { Pagination } from '@/components/pagination';
import { api } from '@/lib/api';
import { useApiErrorMessage } from '@/lib/errors';
import { can, useSession } from '@/lib/session';
import { useDebounced } from '@/lib/use-debounced';

const PAGE_SIZE = 25;
const ALL = 'ALL';

export default function CustomersPage() {
  const t = useTranslations('customers');
  const tCommon = useTranslations('common');
  const tStatus = useTranslations('customerStatus');
  const router = useRouter();
  const errorMessage = useApiErrorMessage();
  const { data: session } = useSession();
  const canManage = can(session, 'customers.manage');

  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<CustomerStatus | typeof ALL>(ALL);
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const debouncedSearch = useDebounced(search.trim(), 300);

  const customersQuery = useQuery({
    queryKey: ['customers', { page, status, search: debouncedSearch }],
    queryFn: () =>
      api.customers.list({
        page,
        pageSize: PAGE_SIZE,
        status: status === ALL ? undefined : status,
        search: debouncedSearch.length > 0 ? debouncedSearch : undefined,
      }),
  });

  const hasFilters = status !== ALL || debouncedSearch.length > 0;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        {canManage ? (
          <Button type="button" onClick={() => setCreateOpen(true)}>
            <Plus aria-hidden="true" />
            {t('new')}
          </Button>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Input
          type="search"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
          placeholder={t('searchPlaceholder')}
          aria-label={t('searchPlaceholder')}
          className="w-full sm:w-64"
        />
        <Select
          value={status}
          onValueChange={(value) => {
            setStatus(value as CustomerStatus | typeof ALL);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-full sm:w-48" aria-label={t('filterStatus')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('allStatuses')}</SelectItem>
            {CUSTOMER_STATUSES.map((value) => (
              <SelectItem key={value} value={value}>
                {tStatus(value)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="pt-6">
          {customersQuery.isPending ? (
            <ListSkeleton rows={6} />
          ) : customersQuery.isError ? (
            <ErrorState
              message={errorMessage(customersQuery.error)}
              onRetry={() => void customersQuery.refetch()}
            />
          ) : customersQuery.data.items.length === 0 ? (
            <EmptyState
              title={hasFilters ? t('emptyFiltered') : t('empty')}
              description={hasFilters ? undefined : t('emptyDescription')}
              action={
                canManage && !hasFilters ? (
                  <Button type="button" onClick={() => setCreateOpen(true)}>
                    <Plus aria-hidden="true" />
                    {t('new')}
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <>
              <Table>
                <THead>
                  <TR>
                    <TH>{t('table.name')}</TH>
                    <TH>{tCommon('status')}</TH>
                    <TH>{t('table.city')}</TH>
                    <TH>{tCommon('email')}</TH>
                  </TR>
                </THead>
                <TBody>
                  {customersQuery.data.items.map((customer) => (
                    <TR
                      key={customer.id}
                      className="cursor-pointer"
                      onClick={() => router.push(`/customers/${customer.id}`)}
                    >
                      <TD className="font-medium">{customer.name}</TD>
                      <TD>
                        <CustomerStatusBadge status={customer.status} />
                      </TD>
                      <TD>{customer.city ?? '—'}</TD>
                      <TD>{customer.email ?? '—'}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
              <Pagination
                page={customersQuery.data.page}
                totalPages={customersQuery.data.totalPages}
                onPageChange={setPage}
              />
            </>
          )}
        </CardContent>
      </Card>

      <CustomerFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSaved={(customer) => router.push(`/customers/${customer.id}`)}
      />
    </div>
  );
}
