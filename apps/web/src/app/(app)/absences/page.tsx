'use client';

import { ABSENCE_STATUSES, type AbsenceStatus } from '@businessos/types';
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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { EmptyState, ErrorState, ListSkeleton } from '@/components/data-states';
import { AbsenceStatusBadge } from '@/components/phase3/badges';
import { Pagination } from '@/components/pagination';
import { api } from '@/lib/api';
import { useApiErrorMessage } from '@/lib/errors';
import { can, useSession } from '@/lib/session';

const PAGE_SIZE = 25;
const ALL = 'ALL';

export default function AbsencesPage() {
  const t = useTranslations('absences');
  const tType = useTranslations('absenceType');
  const tStatus = useTranslations('absenceStatus');
  const tCommon = useTranslations('common');
  const format = useFormatter();
  const router = useRouter();
  const queryClient = useQueryClient();
  const errorMessage = useApiErrorMessage();
  const { data: session } = useSession();
  const canRead = can(session, 'personnel.read');
  const canManage = can(session, 'personnel.manage');

  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<AbsenceStatus | typeof ALL>(ALL);

  const queryKey = ['absences', { page, status }] as const;
  const absencesQuery = useQuery({
    queryKey,
    queryFn: () =>
      api.absences.list({
        page,
        pageSize: PAGE_SIZE,
        status: status === ALL ? undefined : status,
      }),
    enabled: canRead,
  });

  async function invalidate() {
    await queryClient.invalidateQueries({ queryKey: ['absences'] });
  }

  const reviewMutation = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: 'APPROVED' | 'REJECTED' }) =>
      api.absences.review(id, { decision, reviewNote: null }),
    onSuccess: async (_data, variables) => {
      toast.success(variables.decision === 'APPROVED' ? t('approved') : t('rejected'));
      await invalidate();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => api.absences.cancel(id),
    onSuccess: async () => {
      toast.success(t('cancelled'));
      await invalidate();
    },
    onError: (error) => toast.error(errorMessage(error)),
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

  const hasFilters = status !== ALL;

  function formatDate(value: string): string {
    return format.dateTime(new Date(value), { dateStyle: 'medium' });
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={status}
          onValueChange={(value) => {
            setStatus(value as AbsenceStatus | typeof ALL);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-full sm:w-48" aria-label={t('filterStatus')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('allStatuses')}</SelectItem>
            {ABSENCE_STATUSES.map((value) => (
              <SelectItem key={value} value={value}>
                {tStatus(value)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="pt-6">
          {absencesQuery.isPending ? (
            <ListSkeleton rows={6} />
          ) : absencesQuery.isError ? (
            <ErrorState
              message={errorMessage(absencesQuery.error)}
              onRetry={() => void absencesQuery.refetch()}
            />
          ) : absencesQuery.data.items.length === 0 ? (
            <EmptyState title={hasFilters ? t('emptyFiltered') : t('empty')} />
          ) : (
            <>
              <Table>
                <THead>
                  <TR>
                    <TH>{t('table.employee')}</TH>
                    <TH>{t('table.type')}</TH>
                    <TH>{t('table.period')}</TH>
                    <TH>{t('table.status')}</TH>
                    {canManage ? <TH>{tCommon('actions')}</TH> : null}
                  </TR>
                </THead>
                <TBody>
                  {absencesQuery.data.items.map((absence) => (
                    <TR key={absence.id}>
                      <TD className="font-medium">
                        <button
                          type="button"
                          className="hover:underline"
                          onClick={() => router.push(`/employees/${absence.employee.id}`)}
                        >
                          {absence.employee.name}
                        </button>
                      </TD>
                      <TD>{tType(absence.type)}</TD>
                      <TD>
                        {t('period', {
                          start: formatDate(absence.startDate),
                          end: formatDate(absence.endDate),
                        })}
                      </TD>
                      <TD>
                        <AbsenceStatusBadge status={absence.status} />
                      </TD>
                      {canManage ? (
                        <TD>
                          {absence.status === 'PENDING' ? (
                            <div className="flex gap-2">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                loading={
                                  reviewMutation.isPending &&
                                  reviewMutation.variables?.id === absence.id
                                }
                                onClick={() =>
                                  reviewMutation.mutate({ id: absence.id, decision: 'APPROVED' })
                                }
                              >
                                {t('approve')}
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() =>
                                  reviewMutation.mutate({ id: absence.id, decision: 'REJECTED' })
                                }
                              >
                                {t('reject')}
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                loading={
                                  cancelMutation.isPending &&
                                  cancelMutation.variables === absence.id
                                }
                                onClick={() => cancelMutation.mutate(absence.id)}
                              >
                                {t('cancel')}
                              </Button>
                            </div>
                          ) : null}
                        </TD>
                      ) : null}
                    </TR>
                  ))}
                </TBody>
              </Table>
              <Pagination
                page={absencesQuery.data.page}
                totalPages={absencesQuery.data.totalPages}
                onPageChange={setPage}
              />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
