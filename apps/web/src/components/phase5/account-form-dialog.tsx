'use client';

import {
  accountTypeSchema,
  createAccountBodySchema,
  updateAccountBodySchema,
  type AccountDto,
  type AccountType,
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
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { ErrorState } from '@/components/data-states';
import { TextField, TextareaField } from '@/components/form-field';
import { api } from '@/lib/api';
import { useApiErrorMessage } from '@/lib/errors';

interface AccountFormValues {
  code: string;
  name: string;
  type: AccountType;
  description: string;
  isActive: boolean;
}

function toDefaults(account?: AccountDto): AccountFormValues {
  return {
    code: account?.code ?? '',
    name: account?.name ?? '',
    type: account?.type ?? 'ASSET',
    description: account?.description ?? '',
    isActive: account?.isActive ?? true,
  };
}

export function AccountFormDialog({
  open,
  onOpenChange,
  account,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  account?: AccountDto;
}) {
  const t = useTranslations('accounting');
  const tType = useTranslations('accountType');
  const tCommon = useTranslations('common');
  const queryClient = useQueryClient();
  const errorMessage = useApiErrorMessage();
  const isEdit = account !== undefined;

  const {
    register,
    handleSubmit,
    control,
    reset,
    setError,
    formState: { errors },
  } = useForm<AccountFormValues>({ defaultValues: toDefaults(account) });

  useEffect(() => {
    if (open) reset(toDefaults(account));
  }, [open, account, reset]);

  const mutation = useMutation({
    mutationFn: (values: AccountFormValues) => {
      if (isEdit) {
        const body = updateAccountBodySchema.parse({
          name: values.name,
          type: values.type,
          description: values.description,
          isActive: values.isActive,
        });
        return api.accounting.updateAccount(account.id, body);
      }
      const body = createAccountBodySchema.parse({
        code: values.code,
        name: values.name,
        type: values.type,
        description: values.description,
        isActive: values.isActive,
      });
      return api.accounting.createAccount(body);
    },
    onSuccess: async () => {
      toast.success(isEdit ? t('accountUpdated') : t('accountCreated'));
      await queryClient.invalidateQueries({ queryKey: ['accounts'] });
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
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? t('editAccountTitle') : t('createAccountTitle')}</DialogTitle>
          <DialogDescription>{t('accountFormDescription')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => void onSubmit(event)} noValidate className="space-y-4">
          {errors.root ? <ErrorState message={errors.root.message ?? ''} /> : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              id="account-code"
              label={t('accountCode')}
              error={errors.code?.message}
              disabled={isEdit}
              {...register('code')}
            />
            <div className="space-y-2">
              <Label htmlFor="account-type">{t('accountTypeLabel')}</Label>
              <Controller
                control={control}
                name="type"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="account-type" aria-label={t('accountTypeLabel')}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {accountTypeSchema.options.map((option) => (
                        <SelectItem key={option} value={option}>
                          {tType(option)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
          </div>
          <TextField
            id="account-name"
            label={t('accountName')}
            error={errors.name?.message}
            {...register('name')}
          />
          <TextareaField
            id="account-description"
            label={t('accountDescription')}
            {...register('description')}
          />
          <div className="flex items-center gap-2">
            <Controller
              control={control}
              name="isActive"
              render={({ field }) => (
                <input
                  id="account-active"
                  type="checkbox"
                  className="size-4 rounded border-input"
                  checked={field.value}
                  onChange={(event) => field.onChange(event.target.checked)}
                />
              )}
            />
            <label htmlFor="account-active" className="text-sm">
              {t('accountActive')}
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
