'use client';

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '@businessos/ui';
import { useQuery } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { EmptyState, ErrorState, ListSkeleton } from '@/components/data-states';
import { Pagination } from '@/components/pagination';
import { api } from '@/lib/api';
import { useApiErrorMessage } from '@/lib/errors';

const PAGE_SIZE = 25;

export default function AuditLogPage() {
  const t = useTranslations('auditLog');
  const tActions = useTranslations('auditActions');
  const format = useFormatter();
  const errorMessage = useApiErrorMessage();
  const [page, setPage] = useState(1);

  const auditQuery = useQuery({
    queryKey: ['audit-logs', page],
    queryFn: () => api.auditLogs.list({ page, pageSize: PAGE_SIZE }),
  });

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
      <Card>
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
        </CardHeader>
        <CardContent>
          {auditQuery.isPending ? (
            <ListSkeleton rows={8} />
          ) : auditQuery.isError ? (
            <ErrorState
              message={errorMessage(auditQuery.error)}
              onRetry={() => void auditQuery.refetch()}
            />
          ) : auditQuery.data.items.length === 0 ? (
            <EmptyState title={t('empty')} />
          ) : (
            <>
              <Table>
                <THead>
                  <TR>
                    <TH>{t('table.time')}</TH>
                    <TH>{t('table.actor')}</TH>
                    <TH>{t('table.action')}</TH>
                    <TH>{t('table.entity')}</TH>
                    <TH>{t('table.ip')}</TH>
                  </TR>
                </THead>
                <TBody>
                  {auditQuery.data.items.map((entry) => (
                    <TR key={entry.id}>
                      <TD className="whitespace-nowrap">
                        {format.dateTime(new Date(entry.createdAt), {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        })}
                      </TD>
                      <TD>{entry.actor?.name ?? t('system')}</TD>
                      {/* next-intl forbids "." in keys; catalogs use "_" instead. */}
                      <TD>{tActions(entry.action.replaceAll('.', '_'))}</TD>
                      <TD className="text-muted-foreground">
                        {entry.entityType ? `${entry.entityType}` : '—'}
                      </TD>
                      <TD className="text-muted-foreground">{entry.ip ?? '—'}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
              <Pagination
                page={auditQuery.data.page}
                totalPages={auditQuery.data.totalPages}
                onPageChange={setPage}
              />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
