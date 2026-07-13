'use client';

import { QUOTE_STATUSES, type QuoteStatus } from '@businessos/types';
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
import { QuoteStatusBadge } from '@/components/phase4/badges';
import { CustomerFilter } from '@/components/phase4/customer-select';
import { Money } from '@/components/phase4/money';
import { QuoteCreateDialog } from '@/components/phase4/quote-create-dialog';
import { Pagination } from '@/components/pagination';
import { api } from '@/lib/api';
import { useApiErrorMessage } from '@/lib/errors';
import { can, useSession } from '@/lib/session';

const PAGE_SIZE = 25;
const ALL = 'ALL';

export default function QuotesPage() {
  const t = useTranslations('quotes');
  const tBilling = useTranslations('billing');
  const tCommon = useTranslations('common');
  const tStatus = useTranslations('quoteStatus');
  const router = useRouter();
  const format = useFormatter();
  const errorMessage = useApiErrorMessage();
  const { data: session } = useSession();
  const canRead = can(session, 'invoices.read');
  const canManage = can(session, 'invoices.manage');

  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<QuoteStatus | typeof ALL>(ALL);
  const [customerId, setCustomerId] = useState<string | undefined>(undefined);
  const [createOpen, setCreateOpen] = useState(false);

  const quotesQuery = useQuery({
    queryKey: ['quotes', { page, status, customerId }],
    queryFn: () =>
      api.quotes.list({
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
            setStatus(value as QuoteStatus | typeof ALL);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-full sm:w-48" aria-label={tBilling('filterStatus')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{tBilling('allStatuses')}</SelectItem>
            {QUOTE_STATUSES.map((value) => (
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
          {quotesQuery.isPending ? (
            <ListSkeleton rows={6} />
          ) : quotesQuery.isError ? (
            <ErrorState
              message={errorMessage(quotesQuery.error)}
              onRetry={() => void quotesQuery.refetch()}
            />
          ) : quotesQuery.data.items.length === 0 ? (
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
                    <TH className="text-right">{tBilling('total')}</TH>
                    <TH>{tBilling('validUntil')}</TH>
                  </TR>
                </THead>
                <TBody>
                  {quotesQuery.data.items.map((quote) => (
                    <TR
                      key={quote.id}
                      className="cursor-pointer"
                      onClick={() => router.push(`/quotes/${quote.id}`)}
                    >
                      <TD className="font-medium">{quote.number ?? t('draftLabel')}</TD>
                      <TD>{quote.customer.name}</TD>
                      <TD>
                        <QuoteStatusBadge status={quote.status} />
                      </TD>
                      <TD className="text-right">
                        <Money amountMinor={quote.totalMinor} currency={quote.currency} />
                      </TD>
                      <TD>
                        {quote.validUntil
                          ? format.dateTime(new Date(quote.validUntil), { dateStyle: 'medium' })
                          : '—'}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
              <Pagination
                page={quotesQuery.data.page}
                totalPages={quotesQuery.data.totalPages}
                onPageChange={setPage}
              />
            </>
          )}
        </CardContent>
      </Card>

      <QuoteCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(quote) => router.push(`/quotes/${quote.id}`)}
      />
    </div>
  );
}
