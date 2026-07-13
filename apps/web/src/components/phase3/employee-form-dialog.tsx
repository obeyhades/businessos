'use client';

import {
  EMPLOYMENT_STATUSES,
  EMPLOYMENT_TYPES,
  createEmployeeBodySchema,
  type CreateEmployeeBody,
  type EmployeeDto,
} from '@businessos/types';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
} from '@businessos/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { ErrorState } from '@/components/data-states';
import { TextField } from '@/components/form-field';
import { api } from '@/lib/api';
import { useApiErrorMessage } from '@/lib/errors';

const NONE = 'NONE';

/** Convert an empty string to null; used for date/uuid inputs the schema treats as nullable. */
const emptyToNull = (value: unknown) => (value === '' ? null : value);

function toDefaults(
  employee: EmployeeDto | undefined,
  canReadSensitive: boolean,
): CreateEmployeeBody {
  const base: CreateEmployeeBody = {
    firstName: employee?.firstName ?? '',
    lastName: employee?.lastName ?? '',
    workEmail: employee?.workEmail ?? '',
    workPhone: employee?.workPhone ?? '',
    jobTitle: employee?.jobTitle ?? '',
    department: employee?.department ?? '',
    employmentStatus: employee?.employmentStatus ?? 'ONBOARDING',
    employmentType: employee?.employmentType ?? 'FULL_TIME',
    startDate: employee?.startDate ?? null,
    endDate: employee?.endDate ?? null,
    managerId: employee?.manager?.id ?? null,
  };
  if (!canReadSensitive) return base;
  const sensitive = employee?.sensitive;
  return {
    ...base,
    personalIdNumber: sensitive?.personalIdNumber ?? '',
    dateOfBirth: sensitive?.dateOfBirth ?? null,
    homeAddress: sensitive?.homeAddress ?? '',
    homePostalCode: sensitive?.homePostalCode ?? '',
    homeCity: sensitive?.homeCity ?? '',
    personalEmail: sensitive?.personalEmail ?? '',
    personalPhone: sensitive?.personalPhone ?? '',
    emergencyContactName: sensitive?.emergencyContactName ?? '',
    emergencyContactPhone: sensitive?.emergencyContactPhone ?? '',
    emergencyContactRelation: sensitive?.emergencyContactRelation ?? '',
  };
}

export function EmployeeFormDialog({
  open,
  onOpenChange,
  employee,
  canReadSensitive,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employee?: EmployeeDto;
  canReadSensitive: boolean;
  onSaved?: (employee: EmployeeDto) => void;
}) {
  const t = useTranslations('personnel');
  const tFields = useTranslations('personnel.fields');
  const tCommon = useTranslations('common');
  const tStatus = useTranslations('employmentStatus');
  const tType = useTranslations('employmentType');
  const queryClient = useQueryClient();
  const errorMessage = useApiErrorMessage();
  const isEdit = employee !== undefined;

  const {
    register,
    handleSubmit,
    control,
    reset,
    setError,
    formState: { errors },
  } = useForm<CreateEmployeeBody>({
    resolver: zodResolver(createEmployeeBodySchema),
    defaultValues: toDefaults(employee, canReadSensitive),
  });

  useEffect(() => {
    if (open) reset(toDefaults(employee, canReadSensitive));
  }, [open, employee, canReadSensitive, reset]);

  // Managers are picked from the existing directory (excluding the employee itself).
  const managersQuery = useQuery({
    queryKey: ['employees', 'manager-options'],
    queryFn: () => api.employees.list({ pageSize: 100 }),
    enabled: open,
  });
  const managerOptions = (managersQuery.data?.items ?? []).filter((e) => e.id !== employee?.id);

  const mutation = useMutation({
    mutationFn: (values: CreateEmployeeBody) =>
      isEdit ? api.employees.update(employee.id, values) : api.employees.create(values),
    onSuccess: async (saved) => {
      toast.success(isEdit ? t('form.updated') : t('form.created'));
      await queryClient.invalidateQueries({ queryKey: ['employees'] });
      if (isEdit) await queryClient.invalidateQueries({ queryKey: ['employee', employee.id] });
      onOpenChange(false);
      onSaved?.(saved);
    },
    onError: (error) => setError('root', { message: errorMessage(error) }),
  });

  const onSubmit = handleSubmit((values) => mutation.mutate(values));

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (mutation.isPending ? undefined : onOpenChange(next))}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? t('form.editTitle') : t('form.createTitle')}</DialogTitle>
          <DialogDescription>{t('form.description')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => void onSubmit(event)} noValidate className="space-y-4">
          {errors.root ? <ErrorState message={errors.root.message ?? ''} /> : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              id="employee-firstName"
              label={t('form.firstName')}
              error={errors.firstName?.message}
              {...register('firstName')}
            />
            <TextField
              id="employee-lastName"
              label={t('form.lastName')}
              error={errors.lastName?.message}
              {...register('lastName')}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              id="employee-workEmail"
              type="email"
              label={tFields('workEmail')}
              error={errors.workEmail?.message}
              {...register('workEmail')}
            />
            <TextField
              id="employee-workPhone"
              label={tFields('workPhone')}
              error={errors.workPhone?.message}
              {...register('workPhone')}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              id="employee-jobTitle"
              label={tFields('jobTitle')}
              error={errors.jobTitle?.message}
              {...register('jobTitle')}
            />
            <TextField
              id="employee-department"
              label={tFields('department')}
              error={errors.department?.message}
              {...register('department')}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="employee-status">{tStatus('label')}</Label>
              <Controller
                control={control}
                name="employmentStatus"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="employee-status" aria-label={tStatus('label')}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {EMPLOYMENT_STATUSES.map((status) => (
                        <SelectItem key={status} value={status}>
                          {tStatus(status)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="employee-type">{tType('label')}</Label>
              <Controller
                control={control}
                name="employmentType"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="employee-type" aria-label={tType('label')}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {EMPLOYMENT_TYPES.map((type) => (
                        <SelectItem key={type} value={type}>
                          {tType(type)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              id="employee-startDate"
              type="date"
              label={tFields('startDate')}
              error={errors.startDate?.message}
              {...register('startDate', { setValueAs: emptyToNull })}
            />
            <TextField
              id="employee-endDate"
              type="date"
              label={tFields('endDate')}
              error={errors.endDate?.message}
              {...register('endDate', { setValueAs: emptyToNull })}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="employee-manager">{tFields('manager')}</Label>
            <Controller
              control={control}
              name="managerId"
              render={({ field }) => (
                <Select
                  value={field.value ?? NONE}
                  onValueChange={(value) => field.onChange(value === NONE ? null : value)}
                >
                  <SelectTrigger id="employee-manager" aria-label={tFields('manager')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>{t('unassigned')}</SelectItem>
                    {managerOptions.map((option) => (
                      <SelectItem key={option.id} value={option.id}>
                        {option.firstName} {option.lastName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>

          {canReadSensitive ? (
            <>
              <Separator />
              <p className="text-sm font-medium">{t('form.sensitiveSection')}</p>
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField
                  id="employee-personalIdNumber"
                  label={tFields('personalIdNumber')}
                  error={errors.personalIdNumber?.message}
                  {...register('personalIdNumber')}
                />
                <TextField
                  id="employee-dateOfBirth"
                  type="date"
                  label={tFields('dateOfBirth')}
                  error={errors.dateOfBirth?.message}
                  {...register('dateOfBirth', { setValueAs: emptyToNull })}
                />
              </div>
              <TextField
                id="employee-homeAddress"
                label={tFields('homeAddress')}
                error={errors.homeAddress?.message}
                {...register('homeAddress')}
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField
                  id="employee-homePostalCode"
                  label={tFields('homePostalCode')}
                  error={errors.homePostalCode?.message}
                  {...register('homePostalCode')}
                />
                <TextField
                  id="employee-homeCity"
                  label={tFields('homeCity')}
                  error={errors.homeCity?.message}
                  {...register('homeCity')}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField
                  id="employee-personalEmail"
                  type="email"
                  label={tFields('personalEmail')}
                  error={errors.personalEmail?.message}
                  {...register('personalEmail')}
                />
                <TextField
                  id="employee-personalPhone"
                  label={tFields('personalPhone')}
                  error={errors.personalPhone?.message}
                  {...register('personalPhone')}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <TextField
                  id="employee-emergencyContactName"
                  label={tFields('emergencyContactName')}
                  error={errors.emergencyContactName?.message}
                  {...register('emergencyContactName')}
                />
                <TextField
                  id="employee-emergencyContactPhone"
                  label={tFields('emergencyContactPhone')}
                  error={errors.emergencyContactPhone?.message}
                  {...register('emergencyContactPhone')}
                />
                <TextField
                  id="employee-emergencyContactRelation"
                  label={tFields('emergencyContactRelation')}
                  error={errors.emergencyContactRelation?.message}
                  {...register('emergencyContactRelation')}
                />
              </div>
            </>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={mutation.isPending}
              onClick={() => onOpenChange(false)}
            >
              {tCommon('cancel')}
            </Button>
            <Button type="submit" loading={mutation.isPending}>
              {tCommon('save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
