'use client';

import { INVOICE_STATUSES, type InvoiceStatus } from '@businessos/types';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
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
import { useFormatter, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { EmptyState, ErrorState, ListSkeleton } from '@/components/data-states';
import { InvoiceStatusBadge } from '@/components/phase4/badges';
import { CustomerFilter } from '@/components/phase4/customer-select';
import { InvoiceCreateDialog } from '@/components/phase4/invoice-create-dialog';
import { Money } from '@/components/phase4/money';
import { Pagination } from '@/components/pagination';
import { api } from '@/lib/api';
import { useApiErrorMessage } from '@/lib/errors';
import { can, useSession } from '@/lib/session';

const PAGE_SIZE = 25;
const ALL = 'ALL';

export default function InvoicesPage() {
  const t = useTranslations('invoices');
  const tBilling = useTranslations('billing');
  const tCommon = useTranslations('common');
  const tStatus = useTranslations('invoiceStatus');
  const router = useRouter();
  const format = useFormatter();
  const errorMessage = useApiErrorMessage();
  const { data: session } = useSession();
  const canRead = can(session, 'invoices.read');
  const canManage = can(session, 'invoices.manage');

  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<InvoiceStatus | typeof ALL>(ALL);
  const [customerId, setCustomerId] = useState<string | undefined>(undefined);
  const [createOpen, setCreateOpen] = useState(false);

  const invoicesQuery = useQuery({
    queryKey: ['invoices', { page, status, customerId }],
    queryFn: () =>
      api.invoices.list({
        page,
        pageSize: PAGE_SIZE,
        status: status === ALL ? undefined : status,
        customerId,
      }),
    enabled: canRead,
  });

  if (!canRead) {
    return (
      <div className="mx-auto max-w-6xl">
        <Alert>
          <AlertTitle>{t('title')}</AlertTitle>
          <AlertDescription>{t('restricted')}</AlertDescription>
        </Alert>
      </div>
    );
  }

  const hasFilters = status !== ALL || customerId !== undefined;

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
        <Select
          value={status}
          onValueChange={(value) => {
            setStatus(value as InvoiceStatus | typeof ALL);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-full sm:w-48" aria-label={tBilling('filterStatus')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{tBilling('allStatuses')}</SelectItem>
            {INVOICE_STATUSES.map((value) => (
              <SelectItem key={value} value={value}>
                {tStatus(value)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <CustomerFilter
          value={customerId}
          onChange={(value) => {
            setCustomerId(value);
            setPage(1);
          }}
          ariaLabel={tBilling('filterCustomer')}
        />
      </div>

      <Card>
        <CardContent className="pt-6">
          {invoicesQuery.isPending ? (
            <ListSkeleton rows={6} />
          ) : invoicesQuery.isError ? (
            <ErrorState
              message={errorMessage(invoicesQuery.error)}
              onRetry={() => void invoicesQuery.refetch()}
            />
          ) : invoicesQuery.data.items.length === 0 ? (
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
                    <TH>{tBilling('number')}</TH>
                    <TH>{tBilling('customer')}</TH>
                    <TH>{tCommon('status')}</TH>
                    <TH>{tBilling('issueDate')}</TH>
                    <TH>{tBilling('dueDate')}</TH>
                    <TH className="text-right">{tBilling('total')}</TH>
                    <TH className="text-right">{tBilling('amountDue')}</TH>
                  </TR>
                </THead>
                <TBody>
                  {invoicesQuery.data.items.map((invoice) => (
                    <TR
                      key={invoice.id}
                      className="cursor-pointer"
                      onClick={() => router.push(`/invoices/${invoice.id}`)}
                    >
                      <TD className="font-medium">{invoice.number ?? t('draftLabel')}</TD>
                      <TD>{invoice.customer.name}</TD>
                      <TD>
                        <InvoiceStatusBadge status={invoice.status} isOverdue={invoice.isOverdue} />
                      </TD>
                      <TD>
                        {format.dateTime(new Date(invoice.issueDate), { dateStyle: 'medium' })}
                      </TD>
                      <TD>{format.dateTime(new Date(invoice.dueDate), { dateStyle: 'medium' })}</TD>
                      <TD className="text-right">
                        <Money amountMinor={invoice.totalMinor} currency={invoice.currency} />
                      </TD>
                      <TD className="text-right">
                        <Money amountMinor={invoice.amountDueMinor} currency={invoice.currency} />
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
              <Pagination
                page={invoicesQuery.data.page}
                totalPages={invoicesQuery.data.totalPages}
                onPageChange={setPage}
              />
            </>
          )}
        </CardContent>
      </Card>

      <InvoiceCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(invoice) => router.push(`/invoices/${invoice.id}`)}
      />
    </div>
  );
}
