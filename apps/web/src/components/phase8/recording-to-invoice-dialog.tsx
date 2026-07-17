'use client';

import type { RecordingDto } from '@businessos/types';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from '@businessos/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { TextareaField } from '@/components/form-field';
import { majorToMinor } from '@/components/phase4/money';
import { api } from '@/lib/api';
import { useApiErrorMessage } from '@/lib/errors';

function toNumber(value: string, fallback: number): number {
  const parsed = Number.parseFloat(value.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Converts a recording into a DRAFT invoice line. The API requires the recording
 * to have a linked customer, so we surface a helpful message when it does not.
 */
export function RecordingToInvoiceDialog({
  open,
  onOpenChange,
  recording,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recording: RecordingDto;
}) {
  const t = useTranslations('recordings.toInvoice');
  const tCommon = useTranslations('common');
  const queryClient = useQueryClient();
  const errorMessage = useApiErrorMessage();
  const router = useRouter();

  const [description, setDescription] = useState('');
  const [unitPriceMajor, setUnitPriceMajor] = useState('0');
  const [quantity, setQuantity] = useState('1');
  const [taxRatePercent, setTaxRatePercent] = useState('25');
  const [formError, setFormError] = useState<string | null>(null);

  const hasCustomer = recording.customerId !== null;

  useEffect(() => {
    if (!open) return;
    setDescription(recording.title);
    setUnitPriceMajor('0');
    setQuantity('1');
    setTaxRatePercent('25');
    setFormError(null);
  }, [open, recording]);

  const mutation = useMutation({
    mutationFn: () =>
      api.recordings.toInvoice(recording.id, {
        description: description.trim().length > 0 ? description.trim() : undefined,
        unitPriceMinor: majorToMinor(unitPriceMajor),
        quantity: toNumber(quantity, 1),
        taxRatePercent: toNumber(taxRatePercent, 25),
      }),
    onSuccess: async (invoice) => {
      await queryClient.invalidateQueries({ queryKey: ['invoices'] });
      await queryClient.invalidateQueries({ queryKey: ['recording', recording.id] });
      onOpenChange(false);
      toast.success(t('created'), {
        action: { label: t('viewInvoice'), onClick: () => router.push(`/invoices/${invoice.id}`) },
      });
    },
    onError: (error) => setFormError(errorMessage(error)),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (mutation.isPending ? undefined : onOpenChange(next))}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {!hasCustomer ? (
            <p role="alert" className="text-sm text-muted-foreground">
              {t('noCustomer')}
            </p>
          ) : null}
          {formError !== null ? (
            <p role="alert" className="text-sm text-destructive">
              {formError}
            </p>
          ) : null}

          <TextareaField
            id="recToInvoice-description"
            label={t('descriptionLabel')}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            disabled={!hasCustomer}
          />

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="recToInvoice-price">{t('unitPrice')}</Label>
              <Input
                id="recToInvoice-price"
                inputMode="decimal"
                value={unitPriceMajor}
                onChange={(event) => setUnitPriceMajor(event.target.value)}
                disabled={!hasCustomer}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="recToInvoice-quantity">{t('quantity')}</Label>
              <Input
                id="recToInvoice-quantity"
                inputMode="decimal"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
                disabled={!hasCustomer}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="recToInvoice-vat">{t('taxRatePercent')}</Label>
              <Input
                id="recToInvoice-vat"
                inputMode="decimal"
                value={taxRatePercent}
                onChange={(event) => setTaxRatePercent(event.target.value)}
                disabled={!hasCustomer}
              />
            </div>
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
            <Button
              type="button"
              loading={mutation.isPending}
              disabled={!hasCustomer}
              onClick={() => mutation.mutate()}
            >
              {t('create')}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
