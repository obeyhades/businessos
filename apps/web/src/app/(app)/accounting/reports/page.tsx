'use client';

import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '@businessos/ui';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { EmptyState, ErrorState, ListSkeleton } from '@/components/data-states';
import { Money } from '@/components/phase4/money';
import { AccountTypeBadge, BalancedBadge } from '@/components/phase5/badges';
import { API_BASE_URL, api } from '@/lib/api';
import { useApiErrorMessage } from '@/lib/errors';
import { can, useSession } from '@/lib/session';

const CURRENCY = 'SEK';

type View = 'trial' | 'ledger';

export default function ReportsPage() {
  const t = useTranslations('accounting');
  const format = useFormatter();
  const errorMessage = useApiErrorMessage();
  const { data: session } = useSession();
  const canRead = can(session, 'accounting.read');

  const [view, setView] = useState<View>('trial');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [includeDrafts, setIncludeDrafts] = useState(false);

  const reportQuery = {
    from: from.length > 0 ? from : undefined,
    to: to.length > 0 ? to : undefined,
    includeDrafts: includeDrafts ? ('true' as const) : undefined,
  };

  const trialQuery = useQuery({
    queryKey: ['trial-balance', reportQuery],
    queryFn: () => api.accounting.trialBalance(reportQuery),
    enabled: canRead && view === 'trial',
  });

  const ledgerQuery = useQuery({
    queryKey: ['general-ledger', reportQuery],
    queryFn: () => api.accounting.generalLedger(reportQuery),
    enabled: canRead && view === 'ledger',
  });

  function exportUrl(path: string): string {
    const params = new URLSearchParams();
    if (from.length > 0) params.set('from', from);
    if (to.length > 0) params.set('to', to);
    if (includeDrafts) params.set('includeDrafts', 'true');
    const qs = params.toString();
    return `${API_BASE_URL}${path}${qs.length > 0 ? `?${qs}` : ''}`;
  }

  if (!canRead) {
    return (
      <div className="mx-auto max-w-6xl">
        <Alert>
          <AlertTitle>{t('reportsTitle')}</AlertTitle>
          <AlertDescription>{t('restricted')}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t('reportsTitle')}</h1>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant={view === 'trial' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setView('trial')}
        >
          {t('trialBalance')}
        </Button>
        <Button
          type="button"
          variant={view === 'ledger' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setView('ledger')}
        >
          {t('generalLedger')}
        </Button>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-2">
          <Label htmlFor="report-from">{t('fromDate')}</Label>
          <Input
            id="report-from"
            type="date"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
            className="w-44"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="report-to">{t('toDate')}</Label>
          <Input
            id="report-to"
            type="date"
            value={to}
            onChange={(event) => setTo(event.target.value)}
            className="w-44"
          />
        </div>
        <div className="flex items-center gap-2 pb-2.5">
          <input
            id="report-include-drafts"
            type="checkbox"
            className="size-4 rounded border-input"
            checked={includeDrafts}
            onChange={(event) => setIncludeDrafts(event.target.checked)}
          />
          <label htmlFor="report-include-drafts" className="text-sm">
            {t('includeDrafts')}
          </label>
        </div>
        <div className="flex flex-1 flex-wrap justify-end gap-2">
          <Button asChild variant="outline" size="sm">
            <a
              href={exportUrl('/v1/accounting/exports/trial-balance.csv')}
              target="_blank"
              rel="noreferrer"
            >
              <Download aria-hidden="true" />
              {t('exportTrialBalance')}
            </a>
          </Button>
          <Button asChild variant="outline" size="sm">
            <a
              href={exportUrl('/v1/accounting/exports/journal.csv')}
              target="_blank"
              rel="noreferrer"
            >
              <Download aria-hidden="true" />
              {t('exportJournal')}
            </a>
          </Button>
        </div>
      </div>

      {view === 'trial' ? (
        <Card>
          <CardContent className="pt-6">
            {trialQuery.isPending ? (
              <ListSkeleton rows={8} />
            ) : trialQuery.isError ? (
              <ErrorState
                message={errorMessage(trialQuery.error)}
                onRetry={() => void trialQuery.refetch()}
              />
            ) : trialQuery.data.rows.length === 0 ? (
              <EmptyState title={t('reportsEmpty')} />
            ) : (
              <>
                <div className="mb-4 flex items-center justify-end gap-2 text-sm">
                  <span className="text-muted-foreground">{t('balancedLabel')}</span>
                  <BalancedBadge balanced={trialQuery.data.isBalanced} />
                </div>
                <Table>
                  <THead>
                    <TR>
                      <TH>{t('accountCode')}</TH>
                      <TH>{t('accountName')}</TH>
                      <TH>{t('accountTypeLabel')}</TH>
                      <TH className="text-right">{t('debit')}</TH>
                      <TH className="text-right">{t('credit')}</TH>
                      <TH className="text-right">{t('balance')}</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {trialQuery.data.rows.map((row) => (
                      <TR key={row.accountId}>
                        <TD className="font-medium">{row.code}</TD>
                        <TD>{row.name}</TD>
                        <TD>
                          <AccountTypeBadge type={row.type} />
                        </TD>
                        <TD className="text-right">
                          <Money amountMinor={row.debitMinor} currency={CURRENCY} />
                        </TD>
                        <TD className="text-right">
                          <Money amountMinor={row.creditMinor} currency={CURRENCY} />
                        </TD>
                        <TD className="text-right">
                          <Money amountMinor={row.balanceMinor} currency={CURRENCY} />
                        </TD>
                      </TR>
                    ))}
                    <TR className="border-t-2 border-border">
                      <TD className="font-semibold" colSpan={3}>
                        {t('totals')}
                      </TD>
                      <TD className="text-right font-semibold">
                        <Money amountMinor={trialQuery.data.totalDebitMinor} currency={CURRENCY} />
                      </TD>
                      <TD className="text-right font-semibold">
                        <Money amountMinor={trialQuery.data.totalCreditMinor} currency={CURRENCY} />
                      </TD>
                      <TD />
                    </TR>
                  </TBody>
                </Table>
              </>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {ledgerQuery.isPending ? (
            <ListSkeleton rows={8} />
          ) : ledgerQuery.isError ? (
            <ErrorState
              message={errorMessage(ledgerQuery.error)}
              onRetry={() => void ledgerQuery.refetch()}
            />
          ) : ledgerQuery.data.accounts.length === 0 ? (
            <Card>
              <CardContent className="pt-6">
                <EmptyState title={t('reportsEmpty')} />
              </CardContent>
            </Card>
          ) : (
            ledgerQuery.data.accounts.map((account) => (
              <Card key={account.accountId}>
                <CardHeader>
                  <CardTitle className="flex flex-wrap items-center justify-between gap-3">
                    <span>
                      {account.code} · {account.name}
                    </span>
                    <span className="text-sm font-normal text-muted-foreground">
                      {t('openingBalance')}:{' '}
                      <Money amountMinor={account.openingBalanceMinor} currency={CURRENCY} /> →{' '}
                      {t('closingBalance')}:{' '}
                      <Money amountMinor={account.closingBalanceMinor} currency={CURRENCY} />
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {account.entries.length === 0 ? (
                    <EmptyState title={t('noEntries')} />
                  ) : (
                    <Table>
                      <THead>
                        <TR>
                          <TH>{t('voucherDate')}</TH>
                          <TH>{t('voucherNumber')}</TH>
                          <TH>{t('voucherDescription')}</TH>
                          <TH className="text-right">{t('debit')}</TH>
                          <TH className="text-right">{t('credit')}</TH>
                          <TH className="text-right">{t('runningBalance')}</TH>
                        </TR>
                      </THead>
                      <TBody>
                        {account.entries.map((entry) => (
                          <TR key={`${entry.voucherId}-${entry.runningBalanceMinor}-${entry.date}`}>
                            <TD>
                              {format.dateTime(new Date(entry.date), { dateStyle: 'medium' })}
                            </TD>
                            <TD className="font-medium">
                              {entry.voucherNumber ?? t('draftLabel')}
                            </TD>
                            <TD className="max-w-xs truncate">{entry.description}</TD>
                            <TD className="text-right">
                              {entry.debitMinor > 0 ? (
                                <Money amountMinor={entry.debitMinor} currency={CURRENCY} />
                              ) : (
                                '—'
                              )}
                            </TD>
                            <TD className="text-right">
                              {entry.creditMinor > 0 ? (
                                <Money amountMinor={entry.creditMinor} currency={CURRENCY} />
                              ) : (
                                '—'
                              )}
                            </TD>
                            <TD className="text-right">
                              <Money amountMinor={entry.runningBalanceMinor} currency={CURRENCY} />
                            </TD>
                          </TR>
                        ))}
                      </TBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            ))
          )}
        </div>
      )}
    </div>
  );
}
