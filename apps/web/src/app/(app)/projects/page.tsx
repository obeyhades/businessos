'use client';

import { PROJECT_STATUSES, type ProjectStatus } from '@businessos/types';
import {
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
import { ProjectStatusBadge } from '@/components/phase2/badges';
import { ProjectFormDialog } from '@/components/phase2/project-form-dialog';
import { Pagination } from '@/components/pagination';
import { api } from '@/lib/api';
import { useApiErrorMessage } from '@/lib/errors';
import { can, useSession } from '@/lib/session';

const PAGE_SIZE = 25;
const ALL = 'ALL';

export default function ProjectsPage() {
  const t = useTranslations('projects');
  const tCommon = useTranslations('common');
  const tStatus = useTranslations('projectStatus');
  const format = useFormatter();
  const router = useRouter();
  const errorMessage = useApiErrorMessage();
  const { data: session } = useSession();
  const canManage = can(session, 'projects.manage');

  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<ProjectStatus | typeof ALL>(ALL);
  const [customerId, setCustomerId] = useState<string>(ALL);
  const [createOpen, setCreateOpen] = useState(false);

  const customersQuery = useQuery({
    queryKey: ['customers', 'options'],
    queryFn: () => api.customers.list({ page: 1, pageSize: 100 }),
    enabled: can(session, 'customers.read'),
  });

  const projectsQuery = useQuery({
    queryKey: ['projects', { page, status, customerId }],
    queryFn: () =>
      api.projects.list({
        page,
        pageSize: PAGE_SIZE,
        status: status === ALL ? undefined : status,
        customerId: customerId === ALL ? undefined : customerId,
      }),
  });

  const hasFilters = status !== ALL || customerId !== ALL;

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
            setStatus(value as ProjectStatus | typeof ALL);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-full sm:w-48" aria-label={t('filterStatus')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('allStatuses')}</SelectItem>
            {PROJECT_STATUSES.map((value) => (
              <SelectItem key={value} value={value}>
                {tStatus(value)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={customerId}
          onValueChange={(value) => {
            setCustomerId(value);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-full sm:w-56" aria-label={t('filterCustomer')}>
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
      </div>

      <Card>
        <CardContent className="pt-6">
          {projectsQuery.isPending ? (
            <ListSkeleton rows={6} />
          ) : projectsQuery.isError ? (
            <ErrorState
              message={errorMessage(projectsQuery.error)}
              onRetry={() => void projectsQuery.refetch()}
            />
          ) : projectsQuery.data.items.length === 0 ? (
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
                    <TH>{t('table.customer')}</TH>
                    <TH>{tCommon('status')}</TH>
                    <TH>{t('table.created')}</TH>
                  </TR>
                </THead>
                <TBody>
                  {projectsQuery.data.items.map((project) => (
                    <TR
                      key={project.id}
                      className="cursor-pointer"
                      onClick={() => router.push(`/projects/${project.id}`)}
                    >
                      <TD className="font-medium">{project.name}</TD>
                      <TD>{project.customer?.name ?? '—'}</TD>
                      <TD>
                        <ProjectStatusBadge status={project.status} />
                      </TD>
                      <TD>
                        {format.dateTime(new Date(project.createdAt), { dateStyle: 'medium' })}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
              <Pagination
                page={projectsQuery.data.page}
                totalPages={projectsQuery.data.totalPages}
                onPageChange={setPage}
              />
            </>
          )}
        </CardContent>
      </Card>

      <ProjectFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSaved={(project) => router.push(`/projects/${project.id}`)}
      />
    </div>
  );
}
