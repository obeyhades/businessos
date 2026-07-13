'use client';

import { EMPLOYMENT_STATUSES, type EmploymentStatus } from '@businessos/types';
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
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { EmptyState, ErrorState, ListSkeleton } from '@/components/data-states';
import { EmploymentStatusBadge } from '@/components/phase3/badges';
import { EmployeeFormDialog } from '@/components/phase3/employee-form-dialog';
import { Pagination } from '@/components/pagination';
import { api } from '@/lib/api';
import { useApiErrorMessage } from '@/lib/errors';
import { can, useSession } from '@/lib/session';
import { useDebounced } from '@/lib/use-debounced';

const PAGE_SIZE = 25;
const ALL = 'ALL';

export default function EmployeesPage() {
  const t = useTranslations('personnel');
  const tType = useTranslations('employmentType');
  const tStatus = useTranslations('employmentStatus');
  const router = useRouter();
  const errorMessage = useApiErrorMessage();
  const { data: session } = useSession();
  const canRead = can(session, 'personnel.read');
  const canManage = can(session, 'personnel.manage');
  const canReadSensitive = can(session, 'personnel.read_sensitive');

  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<EmploymentStatus | typeof ALL>(ALL);
  const [search, setSearch] = useState('');
  const [department, setDepartment] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const debouncedSearch = useDebounced(search.trim(), 300);
  const debouncedDepartment = useDebounced(department.trim(), 300);

  const employeesQuery = useQuery({
    queryKey: [
      'employees',
      { page, status, search: debouncedSearch, department: debouncedDepartment },
    ],
    queryFn: () =>
      api.employees.list({
        page,
        pageSize: PAGE_SIZE,
        status: status === ALL ? undefined : status,
        search: debouncedSearch.length > 0 ? debouncedSearch : undefined,
        department: debouncedDepartment.length > 0 ? debouncedDepartment : undefined,
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

  const hasFilters = status !== ALL || debouncedSearch.length > 0 || debouncedDepartment.length > 0;

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
        <Input
          type="search"
          value={department}
          onChange={(event) => {
            setDepartment(event.target.value);
            setPage(1);
          }}
          placeholder={t('filterDepartment')}
          aria-label={t('filterDepartment')}
          className="w-full sm:w-48"
        />
        <Select
          value={status}
          onValueChange={(value) => {
            setStatus(value as EmploymentStatus | typeof ALL);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-full sm:w-48" aria-label={t('filterStatus')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('allStatuses')}</SelectItem>
            {EMPLOYMENT_STATUSES.map((value) => (
              <SelectItem key={value} value={value}>
                {tStatus(value)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="pt-6">
          {employeesQuery.isPending ? (
            <ListSkeleton rows={6} />
          ) : employeesQuery.isError ? (
            <ErrorState
              message={errorMessage(employeesQuery.error)}
              onRetry={() => void employeesQuery.refetch()}
            />
          ) : employeesQuery.data.items.length === 0 ? (
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
                    <TH>{t('table.jobTitle')}</TH>
                    <TH>{t('table.department')}</TH>
                    <TH>{tStatus('label')}</TH>
                    <TH>{t('table.type')}</TH>
                    <TH>{t('table.manager')}</TH>
                  </TR>
                </THead>
                <TBody>
                  {employeesQuery.data.items.map((employee) => (
                    <TR
                      key={employee.id}
                      className="cursor-pointer"
                      onClick={() => router.push(`/employees/${employee.id}`)}
                    >
                      <TD className="font-medium">
                        {employee.firstName} {employee.lastName}
                      </TD>
                      <TD>{employee.jobTitle ?? '—'}</TD>
                      <TD>{employee.department ?? '—'}</TD>
                      <TD>
                        <EmploymentStatusBadge status={employee.employmentStatus} />
                      </TD>
                      <TD>{tType(employee.employmentType)}</TD>
                      <TD>{employee.manager?.name ?? '—'}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
              <Pagination
                page={employeesQuery.data.page}
                totalPages={employeesQuery.data.totalPages}
                onPageChange={setPage}
              />
            </>
          )}
        </CardContent>
      </Card>

      {canManage ? (
        <EmployeeFormDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          canReadSensitive={canReadSensitive}
          onSaved={(employee) => router.push(`/employees/${employee.id}`)}
        />
      ) : null}
    </div>
  );
}
