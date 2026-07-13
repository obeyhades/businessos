'use client';

import {
  createProductBodySchema,
  type CreateProductBody,
  type ProductDto,
} from '@businessos/types';
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
import { TextField, TextareaField } from '@/components/form-field';
import { api } from '@/lib/api';
import { useApiErrorMessage } from '@/lib/errors';
import { majorToMinor, MoneyField, minorToMajorText } from './money';

/** Form shape uses a major-unit price string; converted to minor on submit. */
interface ProductFormValues {
  name: string;
  sku: string;
  description: string;
  unit: string;
  unitPriceMajor: string;
  taxRatePercent: string;
  isActive: boolean;
}

function toDefaults(product?: ProductDto): ProductFormValues {
  return {
    name: product?.name ?? '',
    sku: product?.sku ?? '',
    description: product?.description ?? '',
    unit: product?.unit ?? 'piece',
    unitPriceMajor: product ? minorToMajorText(product.unitPriceMinor) : '0',
    taxRatePercent: product ? product.taxRatePercent.toString() : '25',
    isActive: product?.isActive ?? true,
  };
}

export function ProductFormDialog({
  open,
  onOpenChange,
  product,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product?: ProductDto;
}) {
  const t = useTranslations('products');
  const tCommon = useTranslations('common');
  const queryClient = useQueryClient();
  const errorMessage = useApiErrorMessage();
  const isEdit = product !== undefined;

  const {
    register,
    handleSubmit,
    control,
    reset,
    setError,
    formState: { errors },
  } = useForm<ProductFormValues>({ defaultValues: toDefaults(product) });

  useEffect(() => {
    if (open) reset(toDefaults(product));
  }, [open, product, reset]);

  const mutation = useMutation({
    mutationFn: (values: ProductFormValues) => {
      const body: CreateProductBody = createProductBodySchema.parse({
        name: values.name,
        sku: values.sku,
        description: values.description,
        unit: values.unit,
        unitPriceMinor: majorToMinor(values.unitPriceMajor),
        taxRatePercent: Number.parseFloat(values.taxRatePercent.replace(',', '.')) || 0,
        isActive: values.isActive,
      });
      return isEdit ? api.products.update(product.id, body) : api.products.create(body);
    },
    onSuccess: async () => {
      toast.success(isEdit ? t('updated') : t('created'));
      await queryClient.invalidateQueries({ queryKey: ['products'] });
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
          <DialogTitle>{isEdit ? t('editTitle') : t('createTitle')}</DialogTitle>
          <DialogDescription>{t('formDescription')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => void onSubmit(event)} noValidate className="space-y-4">
          {errors.root ? <ErrorState message={errors.root.message ?? ''} /> : null}
          <TextField
            id="product-name"
            label={t('name')}
            error={errors.name?.message}
            {...register('name')}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField id="product-sku" label={t('sku')} {...register('sku')} />
            <TextField id="product-unit" label={t('unit')} {...register('unit')} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <MoneyField id="product-price" label={t('unitPrice')} {...register('unitPriceMajor')} />
            <TextField
              id="product-vat"
              label={t('vat')}
              inputMode="decimal"
              {...register('taxRatePercent')}
            />
          </div>
          <TextareaField
            id="product-description"
            label={t('description')}
            {...register('description')}
          />
          <div className="flex items-center gap-2">
            <Controller
              control={control}
              name="isActive"
              render={({ field }) => (
                <input
                  id="product-active"
                  type="checkbox"
                  className="size-4 rounded border-input"
                  checked={field.value}
                  onChange={(event) => field.onChange(event.target.checked)}
                />
              )}
            />
            <label htmlFor="product-active" className="text-sm">
              {t('active')}
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
