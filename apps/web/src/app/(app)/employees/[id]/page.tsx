'use client';

import type { EmployeeDto } from '@businessos/types';
import { Button, Card, CardContent, CardHeader, CardTitle, ConfirmDialog } from '@businessos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Pencil, Trash2 } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { ErrorState, ListSkeleton } from '@/components/data-states';
import { ActivityTimeline } from '@/components/phase2/activity-timeline';
import { EmploymentStatusBadge } from '@/components/phase3/badges';
import { CertificationsCard } from '@/components/phase3/certifications-card';
import { EmployeeAbsencesCard } from '@/components/phase3/employee-absences-card';
import { EmployeeDocumentsCard } from '@/components/phase3/employee-documents-card';
import { EmployeeFormDialog } from '@/components/phase3/employee-form-dialog';
import { EmployeeNotesCard } from '@/components/phase3/employee-notes-card';
import { EmploymentStatusSelect } from '@/components/phase3/employment-status-select';
import { OnboardingCard } from '@/components/phase3/onboarding-card';
import { api } from '@/lib/api';
import { useApiErrorMessage } from '@/lib/errors';
import { can, useSession } from '@/lib/session';

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  const hasValue = value !== null && value !== undefined && value !== '';
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:justify-between sm:gap-4">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm sm:text-right">{hasValue ? value : '—'}</span>
    </div>
  );
}

function EmployeeDetail({ employee }: { employee: EmployeeDto }) {
  const t = useTranslations('personnel');
  const tFields = useTranslations('personnel.fields');
  const tType = useTranslations('employmentType');
  const tCommon = useTranslations('common');
  const format = useFormatter();
  const router = useRouter();
  const queryClient = useQueryClient();
  const errorMessage = useApiErrorMessage();
  const { data: session } = useSession();
  const canManage = can(session, 'personnel.manage');
  const canReadSensitive = can(session, 'personnel.read_sensitive');

  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const fullName = `${employee.firstName} ${employee.lastName}`;

  const deleteMutation = useMutation({
    mutationFn: () => api.employees.remove(employee.id),
    onSuccess: async () => {
      toast.success(t('deleted'));
      setDeleteOpen(false);
      await queryClient.invalidateQueries({ queryKey: ['employees'] });
      router.push('/employees');
    },
    onError: (error) => {
      toast.error(errorMessage(error));
      setDeleteOpen(false);
    },
  });

  async function refetchEmployee() {
    await queryClient.invalidateQueries({ queryKey: ['employee', employee.id] });
    await queryClient.invalidateQueries({ queryKey: ['employees'] });
  }

  function formatDate(value: string | null): string {
    if (!value) return '';
    return format.dateTime(new Date(value), { dateStyle: 'medium' });
  }

  const homeAddress = employee.sensitive
    ? [
        employee.sensitive.homeAddress,
        [employee.sensitive.homePostalCode, employee.sensitive.homeCity].filter(Boolean).join(' '),
      ]
        .filter((part) => part && part.length > 0)
        .join(', ')
    : '';

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2 text-muted-foreground">
          <Link href="/employees">
            <ArrowLeft aria-hidden="true" />
            {t('backToList')}
          </Link>
        </Button>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">{fullName}</h1>
            <EmploymentStatusBadge status={employee.employmentStatus} />
            {employee.jobTitle ? (
              <span className="text-sm text-muted-foreground">{employee.jobTitle}</span>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <EmploymentStatusSelect
              employee={employee}
              canManage={canManage}
              onUpdated={refetchEmployee}
            />
            {canManage ? (
              <>
                <Button type="button" variant="outline" onClick={() => setEditOpen(true)}>
                  <Pencil aria-hidden="true" />
                  {tCommon('edit')}
                </Button>
                <Button type="button" variant="outline" onClick={() => setDeleteOpen(true)}>
                  <Trash2 aria-hidden="true" />
                  {t('delete')}
                </Button>
              </>
            ) : null}
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{t('directory')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <DetailRow label={tFields('workEmail')} value={employee.workEmail} />
              <DetailRow label={tFields('workPhone')} value={employee.workPhone} />
              <DetailRow label={tFields('department')} value={employee.department} />
              <DetailRow
                label={tFields('manager')}
                value={
                  employee.manager ? (
                    <Link href={`/employees/${employee.manager.id}`} className="hover:underline">
                      {employee.manager.name}
                    </Link>
                  ) : (
                    t('unassigned')
                  )
                }
              />
              <DetailRow label={tFields('employmentType')} value={tType(employee.employmentType)} />
              <DetailRow label={tFields('startDate')} value={formatDate(employee.startDate)} />
              <DetailRow label={tFields('endDate')} value={formatDate(employee.endDate)} />
              <DetailRow
                label={tFields('linkedAccount')}
                value={employee.user ? employee.user.email : t('noUser')}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('sensitive')}</CardTitle>
            </CardHeader>
            <CardContent>
              {canReadSensitive && employee.sensitive ? (
                <div className="space-y-3">
                  <DetailRow
                    label={tFields('personalIdNumber')}
                    value={employee.sensitive.personalIdNumber}
                  />
                  <DetailRow
                    label={tFields('dateOfBirth')}
                    value={formatDate(employee.sensitive.dateOfBirth)}
                  />
                  <DetailRow label={tFields('homeAddress')} value={homeAddress} />
                  <DetailRow
                    label={tFields('personalEmail')}
                    value={employee.sensitive.personalEmail}
                  />
                  <DetailRow
                    label={tFields('personalPhone')}
                    value={employee.sensitive.personalPhone}
                  />
                  <DetailRow
                    label={tFields('emergencyContactName')}
                    value={employee.sensitive.emergencyContactName}
                  />
                  <DetailRow
                    label={tFields('emergencyContactPhone')}
                    value={employee.sensitive.emergencyContactPhone}
                  />
                  <DetailRow
                    label={tFields('emergencyContactRelation')}
                    value={employee.sensitive.emergencyContactRelation}
                  />
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">{t('sensitiveRestricted')}</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('certifications')}</CardTitle>
            </CardHeader>
            <CardContent>
              <CertificationsCard employeeId={employee.id} canManage={canManage} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('documents')}</CardTitle>
            </CardHeader>
            <CardContent>
              <EmployeeDocumentsCard
                employeeId={employee.id}
                canManage={canManage}
                canReadSensitive={canReadSensitive}
              />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{t('absences')}</CardTitle>
            </CardHeader>
            <CardContent>
              <EmployeeAbsencesCard employeeId={employee.id} canManage={canManage} />
            </CardContent>
          </Card>

          {canManage ? (
            <Card>
              <CardHeader>
                <CardTitle>{t('onboarding')}</CardTitle>
              </CardHeader>
              <CardContent>
                <OnboardingCard employeeId={employee.id} />
              </CardContent>
            </Card>
          ) : null}

          {canReadSensitive ? (
            <Card>
              <CardHeader>
                <CardTitle>{t('notes')}</CardTitle>
              </CardHeader>
              <CardContent>
                <EmployeeNotesCard employeeId={employee.id} />
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>{t('activity')}</CardTitle>
            </CardHeader>
            <CardContent>
              <ActivityTimeline
                queryKey={['employee-activity', employee.id]}
                queryFn={() => api.employees.activity(employee.id)}
              />
            </CardContent>
          </Card>
        </div>
      </div>

      {canManage ? (
        <>
          <EmployeeFormDialog
            open={editOpen}
            onOpenChange={setEditOpen}
            employee={employee}
            canReadSensitive={canReadSensitive}
          />
          <ConfirmDialog
            open={deleteOpen}
            onOpenChange={setDeleteOpen}
            title={t('deleteTitle')}
            description={t('deleteDescription', { name: fullName })}
            confirmLabel={t('delete')}
            cancelLabel={tCommon('cancel')}
            destructive
            pending={deleteMutation.isPending}
            onConfirm={() => deleteMutation.mutate()}
          />
        </>
      ) : null}
    </div>
  );
}

export default function EmployeeDetailPage() {
  const params = useParams<{ id: string }>();
  const employeeId = params.id;
  const errorMessage = useApiErrorMessage();
  const { data: session } = useSession();
  const canRead = can(session, 'personnel.read');

  const employeeQuery = useQuery({
    queryKey: ['employee', employeeId],
    queryFn: () => api.employees.get(employeeId),
    enabled: Boolean(employeeId) && canRead,
  });

  if (employeeQuery.isPending) {
    return (
      <div className="mx-auto max-w-6xl space-y-6">
        <ListSkeleton rows={6} />
      </div>
    );
  }
  if (employeeQuery.isError) {
    return (
      <div className="mx-auto max-w-6xl">
        <ErrorState
          message={errorMessage(employeeQuery.error)}
          onRetry={() => void employeeQuery.refetch()}
        />
      </div>
    );
  }

  return <EmployeeDetail employee={employeeQuery.data} />;
}
