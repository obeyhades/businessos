'use client';

import {
  CUSTOMER_STATUSES,
  createCustomerBodySchema,
  type CreateCustomerBody,
  type CustomerDto,
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
} from '@businessos/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { ErrorState } from '@/components/data-states';
import { TextField, TextareaField } from '@/components/form-field';
import { api } from '@/lib/api';
import { useApiErrorMessage } from '@/lib/errors';

function toDefaults(customer?: CustomerDto): CreateCustomerBody {
  return {
    name: customer?.name ?? '',
    orgNumber: customer?.orgNumber ?? '',
    email: customer?.email ?? '',
    phone: customer?.phone ?? '',
    addressLine1: customer?.addressLine1 ?? '',
    addressLine2: customer?.addressLine2 ?? '',
    postalCode: customer?.postalCode ?? '',
    city: customer?.city ?? '',
    country: customer?.country ?? '',
    notes: customer?.notes ?? '',
    status: customer?.status ?? 'ACTIVE',
  };
}

export function CustomerFormDialog({
  open,
  onOpenChange,
  customer,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customer?: CustomerDto;
  onSaved?: (customer: CustomerDto) => void;
}) {
  const t = useTranslations('customers.form');
  const tCommon = useTranslations('common');
  const tStatus = useTranslations('customerStatus');
  const queryClient = useQueryClient();
  const errorMessage = useApiErrorMessage();
  const isEdit = customer !== undefined;

  const {
    register,
    handleSubmit,
    control,
    reset,
    setError,
    formState: { errors },
  } = useForm<CreateCustomerBody>({
    resolver: zodResolver(createCustomerBodySchema),
    defaultValues: toDefaults(customer),
  });

  useEffect(() => {
    if (open) reset(toDefaults(customer));
  }, [open, customer, reset]);

  const mutation = useMutation({
    mutationFn: (values: CreateCustomerBody) =>
      isEdit ? api.customers.update(customer.id, values) : api.customers.create(values),
    onSuccess: async (saved) => {
      toast.success(isEdit ? t('updated') : t('created'));
      await queryClient.invalidateQueries({ queryKey: ['customers'] });
      if (isEdit) await queryClient.invalidateQueries({ queryKey: ['customer', customer.id] });
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
          <DialogTitle>{isEdit ? t('editTitle') : t('createTitle')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => void onSubmit(event)} noValidate className="space-y-4">
          {errors.root ? <ErrorState message={errors.root.message ?? ''} /> : null}
          <TextField
            id="customer-name"
            label={t('name')}
            error={errors.name?.message}
            {...register('name')}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              id="customer-orgNumber"
              label={t('orgNumber')}
              error={errors.orgNumber?.message}
              {...register('orgNumber')}
            />
            <div className="space-y-2">
              <Label htmlFor="customer-status">{tCommon('status')}</Label>
              <Controller
                control={control}
                name="status"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="customer-status" aria-label={tCommon('status')}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CUSTOMER_STATUSES.map((status) => (
                        <SelectItem key={status} value={status}>
                          {tStatus(status)}
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
              id="customer-email"
              type="email"
              label={tCommon('email')}
              error={errors.email?.message}
              {...register('email')}
            />
            <TextField
              id="customer-phone"
              label={t('phone')}
              error={errors.phone?.message}
              {...register('phone')}
            />
          </div>
          <TextField
            id="customer-addressLine1"
            label={t('addressLine1')}
            error={errors.addressLine1?.message}
            {...register('addressLine1')}
          />
          <TextField
            id="customer-addressLine2"
            label={t('addressLine2')}
            error={errors.addressLine2?.message}
            {...register('addressLine2')}
          />
          <div className="grid gap-4 sm:grid-cols-3">
            <TextField
              id="customer-postalCode"
              label={t('postalCode')}
              error={errors.postalCode?.message}
              {...register('postalCode')}
            />
            <TextField
              id="customer-city"
              label={t('city')}
              error={errors.city?.message}
              {...register('city')}
            />
            <TextField
              id="customer-country"
              label={t('country')}
              error={errors.country?.message}
              {...register('country')}
            />
          </div>
          <TextareaField
            id="customer-notes"
            label={t('notes')}
            error={errors.notes?.message}
            {...register('notes')}
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
