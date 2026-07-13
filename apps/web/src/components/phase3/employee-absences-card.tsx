'use client';

import {
  ABSENCE_TYPES,
  createAbsenceRequestBodySchema,
  type AbsenceRequestDto,
  type CreateAbsenceRequestBody,
} from '@businessos/types';
import {
  Button,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@businessos/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { EmptyState, ErrorState, ListSkeleton } from '@/components/data-states';
import { TextField, TextareaField } from '@/components/form-field';
import { AbsenceStatusBadge } from '@/components/phase3/badges';
import { api } from '@/lib/api';
import { useApiErrorMessage } from '@/lib/errors';

function CreateAbsenceDialog({
  employeeId,
  open,
  onOpenChange,
}: {
  employeeId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('employeeAbsences');
  const tForm = useTranslations('employeeAbsences.form');
  const tType = useTranslations('absenceType');
  const tCommon = useTranslations('common');
  const queryClient = useQueryClient();
  const errorMessage = useApiErrorMessage();

  const {
    register,
    handleSubmit,
    control,
    reset,
    setError,
    formState: { errors },
  } = useForm<CreateAbsenceRequestBody>({
    resolver: zodResolver(createAbsenceRequestBodySchema),
    defaultValues: { type: 'VACATION', startDate: '', endDate: '', reason: '' },
  });

  useEffect(() => {
    if (open) reset({ type: 'VACATION', startDate: '', endDate: '', reason: '' });
  }, [open, reset]);

  const mutation = useMutation({
    mutationFn: (values: CreateAbsenceRequestBody) => api.absences.create(employeeId, values),
    onSuccess: async () => {
      toast.success(t('created'));
      await queryClient.invalidateQueries({ queryKey: ['absences', 'employee', employeeId] });
      onOpenChange(false);
    },
    onError: (error) => setError('root', { message: errorMessage(error) }),
  });

  const onSubmit = handleSubmit((values) => mutation.mutate(values));

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (mutation.isPending ? undefined : onOpenChange(next))}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{tForm('createTitle')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={(event) => void onSubmit(event)} noValidate className="space-y-4">
          {errors.root ? <ErrorState message={errors.root.message ?? ''} /> : null}
          <div className="space-y-2">
            <Label htmlFor="absence-type">{tForm('type')}</Label>
            <Controller
              control={control}
              name="type"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="absence-type" aria-label={tForm('type')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ABSENCE_TYPES.map((type) => (
                      <SelectItem key={type} value={type}>
                        {tType(type)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              id="absence-startDate"
              type="date"
              label={tForm('startDate')}
              error={errors.startDate?.message}
              {...register('startDate')}
            />
            <TextField
              id="absence-endDate"
              type="date"
              label={tForm('endDate')}
              error={errors.endDate?.message}
              {...register('endDate')}
            />
          </div>
          <TextareaField
            id="absence-reason"
            label={tForm('reason')}
            error={errors.reason?.message}
            {...register('reason')}
          />
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

export function EmployeeAbsencesCard({
  employeeId,
  canManage,
}: {
  employeeId: string;
  canManage: boolean;
}) {
  const t = useTranslations('employeeAbsences');
  const tType = useTranslations('absenceType');
  const tCommon = useTranslations('common');
  const format = useFormatter();
  const queryClient = useQueryClient();
  const errorMessage = useApiErrorMessage();

  const [createOpen, setCreateOpen] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<AbsenceRequestDto | null>(null);

  const queryKey = ['absences', 'employee', employeeId] as const;
  const absencesQuery = useQuery({
    queryKey,
    queryFn: () => api.absences.listForEmployee(employeeId),
  });

  async function invalidate() {
    await queryClient.invalidateQueries({ queryKey });
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
      setCancelTarget(null);
      await invalidate();
    },
    onError: (error) => {
      toast.error(errorMessage(error));
      setCancelTarget(null);
    },
  });

  function formatDate(value: string): string {
    return format.dateTime(new Date(value), { dateStyle: 'medium' });
  }

  return (
    <div className="space-y-4">
      {canManage ? (
        <Button type="button" variant="outline" size="sm" onClick={() => setCreateOpen(true)}>
          <Plus aria-hidden="true" />
          {t('add')}
        </Button>
      ) : null}

      {absencesQuery.isPending ? (
        <ListSkeleton rows={2} />
      ) : absencesQuery.isError ? (
        <ErrorState
          message={errorMessage(absencesQuery.error)}
          onRetry={() => void absencesQuery.refetch()}
        />
      ) : absencesQuery.data.length === 0 ? (
        <EmptyState title={t('empty')} />
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {absencesQuery.data.map((absence) => (
            <li key={absence.id} className="flex flex-wrap items-center gap-3 p-3">
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{tType(absence.type)}</span>
                  <AbsenceStatusBadge status={absence.status} />
                </div>
                <p className="text-xs text-muted-foreground">
                  {t('period', {
                    start: formatDate(absence.startDate),
                    end: formatDate(absence.endDate),
                  })}
                </p>
              </div>
              {canManage && absence.status === 'PENDING' ? (
                <div className="flex shrink-0 gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    loading={
                      reviewMutation.isPending && reviewMutation.variables?.id === absence.id
                    }
                    onClick={() => reviewMutation.mutate({ id: absence.id, decision: 'APPROVED' })}
                  >
                    {t('approve')}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => reviewMutation.mutate({ id: absence.id, decision: 'REJECTED' })}
                  >
                    {t('reject')}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setCancelTarget(absence)}
                  >
                    {t('cancel')}
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canManage ? (
        <>
          <CreateAbsenceDialog
            employeeId={employeeId}
            open={createOpen}
            onOpenChange={setCreateOpen}
          />
          <ConfirmDialog
            open={cancelTarget !== null}
            onOpenChange={(open) => {
              if (!open) setCancelTarget(null);
            }}
            title={t('cancelTitle')}
            description={t('cancelDescription')}
            confirmLabel={t('cancel')}
            cancelLabel={tCommon('cancel')}
            destructive
            pending={cancelMutation.isPending}
            onConfirm={() => {
              if (cancelTarget) cancelMutation.mutate(cancelTarget.id);
            }}
          />
        </>
      ) : null}
    </div>
  );
}
