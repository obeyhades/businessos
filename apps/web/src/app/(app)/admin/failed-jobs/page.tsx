'use client';

import type { FailedJobDto } from '@businessos/types';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '@businessos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { EmptyState, ErrorState, ListSkeleton } from '@/components/data-states';
import { Pagination } from '@/components/pagination';
import { api } from '@/lib/api';
import { useApiErrorMessage } from '@/lib/errors';
import { useSession } from '@/lib/session';

const PAGE_SIZE = 25;

function FailedJobsTable() {
  const t = useTranslations('admin.failedJobs');
  const tCommon = useTranslations('common');
  const format = useFormatter();
  const queryClient = useQueryClient();
  const errorMessage = useApiErrorMessage();
  const [page, setPage] = useState(1);
  const [retryTarget, setRetryTarget] = useState<FailedJobDto | null>(null);

  const jobsQuery = useQuery({
    queryKey: ['failed-jobs', page],
    queryFn: () => api.admin.listFailedJobs({ page, pageSize: PAGE_SIZE }),
  });

  const retryMutation = useMutation({
    mutationFn: (failedJobId: string) => api.admin.retryFailedJob(failedJobId),
    onSuccess: async () => {
      toast.success(t('retrySuccess'));
      setRetryTarget(null);
      await queryClient.invalidateQueries({ queryKey: ['failed-jobs'] });
    },
    onError: (error) => {
      toast.error(errorMessage(error));
      setRetryTarget(null);
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent>
        {jobsQuery.isPending ? (
          <ListSkeleton rows={5} />
        ) : jobsQuery.isError ? (
          <ErrorState
            message={errorMessage(jobsQuery.error)}
            onRetry={() => void jobsQuery.refetch()}
          />
        ) : jobsQuery.data.items.length === 0 ? (
          <EmptyState title={t('empty')} />
        ) : (
          <>
            <Table>
              <THead>
                <TR>
                  <TH>{t('table.queue')}</TH>
                  <TH>{t('table.type')}</TH>
                  <TH>{t('table.error')}</TH>
                  <TH>{t('table.attempts')}</TH>
                  <TH>{t('table.failedAt')}</TH>
                  <TH className="w-28" />
                </TR>
              </THead>
              <TBody>
                {jobsQuery.data.items.map((job) => (
                  <TR key={job.id}>
                    <TD className="whitespace-nowrap font-medium">{job.queue}</TD>
                    <TD className="whitespace-nowrap">{job.messageType}</TD>
                    <TD className="max-w-md">
                      <span className="line-clamp-2 text-muted-foreground">{job.error}</span>
                    </TD>
                    <TD>{job.attempts}</TD>
                    <TD className="whitespace-nowrap">
                      {format.dateTime(new Date(job.failedAt), {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    </TD>
                    <TD className="text-right">
                      {job.retriedAt ? (
                        <Badge variant="secondary">{t('retried')}</Badge>
                      ) : (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setRetryTarget(job)}
                        >
                          {t('retry')}
                        </Button>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <Pagination
              page={jobsQuery.data.page}
              totalPages={jobsQuery.data.totalPages}
              onPageChange={setPage}
            />
          </>
        )}
      </CardContent>

      <ConfirmDialog
        open={retryTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRetryTarget(null);
        }}
        title={t('retryTitle')}
        description={
          retryTarget
            ? t('retryDescription', { type: retryTarget.messageType, queue: retryTarget.queue })
            : undefined
        }
        confirmLabel={t('retry')}
        cancelLabel={tCommon('cancel')}
        pending={retryMutation.isPending}
        onConfirm={() => {
          if (retryTarget) retryMutation.mutate(retryTarget.id);
        }}
      />
    </Card>
  );
}

export default function FailedJobsPage() {
  const t = useTranslations('admin.failedJobs');
  const { data: session } = useSession();

  if (!session) return null;

  if (!session.user.isPlatformAdmin) {
    return (
      <div className="mx-auto max-w-2xl pt-12">
        <Alert variant="destructive">
          <AlertDescription>{t('forbidden')}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
      <FailedJobsTable />
    </div>
  );
}
