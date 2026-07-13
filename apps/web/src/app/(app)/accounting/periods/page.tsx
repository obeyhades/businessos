'use client';

import {
  fiscalPeriodStatusSchema,
  type FiscalPeriodDto,
  type FiscalPeriodStatus,
} from '@businessos/types';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { EmptyState, ErrorState, ListSkeleton } from '@/components/data-states';
import { FiscalPeriodStatusBadge } from '@/components/phase5/badges';
import { FiscalYearDialog } from '@/components/phase5/fiscal-year-dialog';
import { api } from '@/lib/api';
import { useApiErrorMessage } from '@/lib/errors';
import { can, useSession } from '@/lib/session';

function PeriodStatusControl({
  period,
  canManage,
}: {
  period: FiscalPeriodDto;
  canManage: boolean;
}) {
  const t = useTranslations('fiscalPeriodStatus');
  const queryClient = useQueryClient();
  const errorMessage = useApiErrorMessage();

  const mutation = useMutation({
    mutationFn: (status: FiscalPeriodStatus) =>
      api.accounting.setPeriodStatus(period.id, { status }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['fiscal-years'] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (!canManage) return <FiscalPeriodStatusBadge status={period.status} />;

  return (
    <Select
      value={period.status}
      onValueChange={(value) => mutation.mutate(value as FiscalPeriodStatus)}
      disabled={mutation.isPending}
    >
      <SelectTrigger className="w-36" aria-label={t(period.status)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {fiscalPeriodStatusSchema.options.map((option) => (
          <SelectItem key={option} value={option}>
            {t(option)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export default function PeriodsPage() {
  const t = useTranslations('accounting');
  const tCommon = useTranslations('common');
  const format = useFormatter();
  const errorMessage = useApiErrorMessage();
  const { data: session } = useSession();
  const canRead = can(session, 'accounting.read');
  const canManage = can(session, 'accounting.manage');
  const [createOpen, setCreateOpen] = useState(false);

  const yearsQuery = useQuery({
    queryKey: ['fiscal-years'],
    queryFn: () => api.accounting.listFiscalYears(),
    enabled: canRead,
  });

  if (!canRead) {
    return (
      <div className="mx-auto max-w-6xl">
        <Alert>
          <AlertTitle>{t('periodsTitle')}</AlertTitle>
          <AlertDescription>{t('restricted')}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">{t('periodsTitle')}</h1>
        {canManage ? (
          <Button type="button" onClick={() => setCreateOpen(true)}>
            <Plus aria-hidden="true" />
            {t('newFiscalYear')}
          </Button>
        ) : null}
      </div>

      {yearsQuery.isPending ? (
        <ListSkeleton rows={6} />
      ) : yearsQuery.isError ? (
        <ErrorState
          message={errorMessage(yearsQuery.error)}
          onRetry={() => void yearsQuery.refetch()}
        />
      ) : yearsQuery.data.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <EmptyState
              title={t('periodsEmpty')}
              description={t('periodsEmptyDescription')}
              action={
                canManage ? (
                  <Button type="button" onClick={() => setCreateOpen(true)}>
                    <Plus aria-hidden="true" />
                    {t('newFiscalYear')}
                  </Button>
                ) : undefined
              }
            />
          </CardContent>
        </Card>
      ) : (
        yearsQuery.data.map((year) => (
          <Card key={year.id}>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center justify-between gap-3">
                <span>{year.name}</span>
                <span className="text-sm font-normal text-muted-foreground">
                  {format.dateTime(new Date(year.startDate), { dateStyle: 'medium' })} –{' '}
                  {format.dateTime(new Date(year.endDate), { dateStyle: 'medium' })}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {year.periods.length === 0 ? (
                <EmptyState title={t('noPeriods')} />
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>{t('periodName')}</TH>
                      <TH>{t('periodStart')}</TH>
                      <TH>{t('periodEnd')}</TH>
                      <TH className="text-right">{tCommon('status')}</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {year.periods.map((period) => (
                      <TR key={period.id}>
                        <TD className="font-medium">{period.name}</TD>
                        <TD>
                          {format.dateTime(new Date(period.startDate), { dateStyle: 'medium' })}
                        </TD>
                        <TD>
                          {format.dateTime(new Date(period.endDate), { dateStyle: 'medium' })}
                        </TD>
                        <TD className="text-right">
                          <div className="flex justify-end">
                            <PeriodStatusControl period={period} canManage={canManage} />
                          </div>
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

      <FiscalYearDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
