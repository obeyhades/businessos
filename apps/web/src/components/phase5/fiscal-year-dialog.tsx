'use client';

import { createFiscalYearBodySchema } from '@businessos/types';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@businessos/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { ErrorState } from '@/components/data-states';
import { TextField } from '@/components/form-field';
import { api } from '@/lib/api';
import { useApiErrorMessage } from '@/lib/errors';

function startOfYear(): string {
  return `${new Date().getFullYear()}-01-01`;
}

function endOfYear(): string {
  return `${new Date().getFullYear()}-12-31`;
}

interface FiscalYearFormValues {
  name: string;
  startDate: string;
  endDate: string;
  generateMonthlyPeriods: boolean;
}

function defaults(): FiscalYearFormValues {
  return {
    name: String(new Date().getFullYear()),
    startDate: startOfYear(),
    endDate: endOfYear(),
    generateMonthlyPeriods: true,
  };
}

export function FiscalYearDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('accounting');
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
  } = useForm<FiscalYearFormValues>({ defaultValues: defaults() });

  useEffect(() => {
    if (open) reset(defaults());
  }, [open, reset]);

  const mutation = useMutation({
    mutationFn: (values: FiscalYearFormValues) => {
      const body = createFiscalYearBodySchema.parse({
        name: values.name,
        startDate: values.startDate,
        endDate: values.endDate,
        generateMonthlyPeriods: values.generateMonthlyPeriods,
      });
      return api.accounting.createFiscalYear(body);
    },
    onSuccess: async () => {
      toast.success(t('fiscalYearCreated'));
      await queryClient.invalidateQueries({ queryKey: ['fiscal-years'] });
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
          <DialogTitle>{t('createFiscalYearTitle')}</DialogTitle>
          <DialogDescription>{t('createFiscalYearDescription')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => void onSubmit(event)} noValidate className="space-y-4">
          {errors.root ? <ErrorState message={errors.root.message ?? ''} /> : null}
          <TextField
            id="fiscal-year-name"
            label={t('fiscalYearName')}
            error={errors.name?.message}
            {...register('name')}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              id="fiscal-year-start"
              type="date"
              label={t('fiscalYearStart')}
              error={errors.startDate?.message}
              {...register('startDate')}
            />
            <TextField
              id="fiscal-year-end"
              type="date"
              label={t('fiscalYearEnd')}
              error={errors.endDate?.message}
              {...register('endDate')}
            />
          </div>
          <div className="flex items-center gap-2">
            <Controller
              control={control}
              name="generateMonthlyPeriods"
              render={({ field }) => (
                <input
                  id="fiscal-year-monthly"
                  type="checkbox"
                  className="size-4 rounded border-input"
                  checked={field.value}
                  onChange={(event) => field.onChange(event.target.checked)}
                />
              )}
            />
            <label htmlFor="fiscal-year-monthly" className="text-sm">
              {t('generateMonthlyPeriods')}
            </label>
          </div>
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
