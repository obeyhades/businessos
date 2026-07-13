'use client';

import {
  voucherSourceSchema,
  voucherStatusSchema,
  type VoucherSource,
  type VoucherStatus,
} from '@businessos/types';
import {
  Alert,
  AlertDescription,
  AlertTitle,
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
import { useFormatter, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { EmptyState, ErrorState, ListSkeleton } from '@/components/data-states';
import { Money } from '@/components/phase4/money';
import { BalancedBadge, VoucherSourceBadge, VoucherStatusBadge } from '@/components/phase5/badges';
import { Pagination } from '@/components/pagination';
import { api } from '@/lib/api';
import { useApiErrorMessage } from '@/lib/errors';
import { can, useSession } from '@/lib/session';

const PAGE_SIZE = 50;
const ALL = 'ALL';
const CURRENCY = 'SEK';

type Mode = 'all' | 'review';

export default function VouchersPage() {
  const t = useTranslations('accounting');
  const tStatus = useTranslations('voucherStatus');
  const tSource = useTranslations('voucherSource');
  const tCommon = useTranslations('common');
  const format = useFormatter();
  const router = useRouter();
  const errorMessage = useApiErrorMessage();
  const { data: session } = useSession();
  const canRead = can(session, 'accounting.read');
  const canManage = can(session, 'accounting.manage');

  const [mode, setMode] = useState<Mode>('all');
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<VoucherStatus | typeof ALL>(ALL);
  const [source, setSource] = useState<VoucherSource | typeof ALL>(ALL);
  const [reconciled, setReconciled] = useState<'true' | 'false' | typeof ALL>(ALL);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [reviewSource, setReviewSource] = useState<'INVOICE' | 'PAYMENT'>('INVOICE');

  const query =
    mode === 'review'
      ? { status: 'DRAFT' as const, source: reviewSource, from, to }
      : {
          status: status === ALL ? undefined : status,
          source: source === ALL ? undefined : source,
          reconciled: reconciled === ALL ? undefined : reconciled,
          from,
          to,
        };

  const vouchersQuery = useQuery({
    queryKey: ['vouchers', { mode, page, query }],
    queryFn: () =>
      api.accounting.listVouchers({
        page,
        pageSize: PAGE_SIZE,
        ...query,
        from: from.length > 0 ? from : undefined,
        to: to.length > 0 ? to : undefined,
      }),
    enabled: canRead,
  });

  if (!canRead) {
    return (
      <div className="mx-auto max-w-6xl">
        <Alert>
          <AlertTitle>{t('vouchersTitle')}</AlertTitle>
          <AlertDescription>{t('restricted')}</AlertDescription>
        </Alert>
      </div>
    );
  }

  function switchMode(next: Mode) {
    setMode(next);
    setPage(1);
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">{t('vouchersTitle')}</h1>
        {canManage ? (
          <Button type="button" onClick={() => router.push('/accounting/vouchers/new')}>
            <Plus aria-hidden="true" />
            {t('newVoucher')}
          </Button>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant={mode === 'all' ? 'default' : 'outline'}
          size="sm"
          onClick={() => switchMode('all')}
        >
          {t('allVouchers')}
        </Button>
        <Button
          type="button"
          variant={mode === 'review' ? 'default' : 'outline'}
          size="sm"
          onClick={() => switchMode('review')}
        >
          {t('draftReview')}
        </Button>
      </div>

      {mode === 'review' ? (
        <div className="flex flex-wrap items-center gap-3">
          <Select
            value={reviewSource}
            onValueChange={(value) => {
              setReviewSource(value as 'INVOICE' | 'PAYMENT');
              setPage(1);
            }}
          >
            <SelectTrigger className="w-full sm:w-48" aria-label={t('filterSource')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="INVOICE">{tSource('INVOICE')}</SelectItem>
              <SelectItem value="PAYMENT">{tSource('PAYMENT')}</SelectItem>
            </SelectContent>
          </Select>
          <Input
            type="date"
            value={from}
            onChange={(event) => {
              setFrom(event.target.value);
              setPage(1);
            }}
            aria-label={t('fromDate')}
            className="w-full sm:w-44"
          />
          <Input
            type="date"
            value={to}
            onChange={(event) => {
              setTo(event.target.value);
              setPage(1);
            }}
            aria-label={t('toDate')}
            className="w-full sm:w-44"
          />
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <Select
            value={status}
            onValueChange={(value) => {
              setStatus(value as VoucherStatus | typeof ALL);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-full sm:w-40" aria-label={t('filterStatus')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t('allStatuses')}</SelectItem>
              {voucherStatusSchema.options.map((option) => (
                <SelectItem key={option} value={option}>
                  {tStatus(option)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={source}
            onValueChange={(value) => {
              setSource(value as VoucherSource | typeof ALL);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-full sm:w-44" aria-label={t('filterSource')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t('allSources')}</SelectItem>
              {voucherSourceSchema.options.map((option) => (
                <SelectItem key={option} value={option}>
                  {tSource(option)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={reconciled}
            onValueChange={(value) => {
              setReconciled(value as 'true' | 'false' | typeof ALL);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-full sm:w-44" aria-label={t('filterReconciled')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t('allReconciled')}</SelectItem>
              <SelectItem value="true">{t('onlyReconciled')}</SelectItem>
              <SelectItem value="false">{t('onlyUnreconciled')}</SelectItem>
            </SelectContent>
          </Select>
          <Input
            type="date"
            value={from}
            onChange={(event) => {
              setFrom(event.target.value);
              setPage(1);
            }}
            aria-label={t('fromDate')}
            className="w-full sm:w-44"
          />
          <Input
            type="date"
            value={to}
            onChange={(event) => {
              setTo(event.target.value);
              setPage(1);
            }}
            aria-label={t('toDate')}
            className="w-full sm:w-44"
          />
        </div>
      )}

      <Card>
        <CardContent className="pt-6">
          {vouchersQuery.isPending ? (
            <ListSkeleton rows={6} />
          ) : vouchersQuery.isError ? (
            <ErrorState
              message={errorMessage(vouchersQuery.error)}
              onRetry={() => void vouchersQuery.refetch()}
            />
          ) : vouchersQuery.data.items.length === 0 ? (
            <EmptyState
              title={mode === 'review' ? t('draftReviewEmpty') : t('vouchersEmpty')}
              description={mode === 'review' ? undefined : t('vouchersEmptyDescription')}
            />
          ) : (
            <>
              <Table>
                <THead>
                  <TR>
                    <TH>{t('voucherNumber')}</TH>
                    <TH>{t('voucherDate')}</TH>
                    <TH>{t('voucherDescription')}</TH>
                    <TH>{t('voucherSourceLabel')}</TH>
                    <TH className="text-right">{t('voucherTotal')}</TH>
                    <TH>{t('balancedLabel')}</TH>
                    <TH>{tCommon('status')}</TH>
                  </TR>
                </THead>
                <TBody>
                  {vouchersQuery.data.items.map((voucher) => (
                    <TR
                      key={voucher.id}
                      className="cursor-pointer"
                      onClick={() => router.push(`/accounting/vouchers/${voucher.id}`)}
                    >
                      <TD className="font-medium">{voucher.number ?? t('draftLabel')}</TD>
                      <TD>{format.dateTime(new Date(voucher.date), { dateStyle: 'medium' })}</TD>
                      <TD className="max-w-xs truncate">{voucher.description}</TD>
                      <TD>
                        <VoucherSourceBadge source={voucher.source} />
                      </TD>
                      <TD className="text-right">
                        <Money amountMinor={voucher.totalDebitMinor} currency={CURRENCY} />
                      </TD>
                      <TD>
                        <BalancedBadge balanced={voucher.isBalanced} />
                      </TD>
                      <TD>
                        <VoucherStatusBadge status={voucher.status} />
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
              <Pagination
                page={vouchersQuery.data.page}
                totalPages={vouchersQuery.data.totalPages}
                onPageChange={setPage}
              />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
