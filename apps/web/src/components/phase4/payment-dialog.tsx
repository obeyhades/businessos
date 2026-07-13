'use client';

import { PAYMENT_METHODS, type InvoiceDto } from '@businessos/types';
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
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ErrorState } from '@/components/data-states';
import { TextField, TextareaField } from '@/components/form-field';
import { api } from '@/lib/api';
import { useApiErrorMessage } from '@/lib/errors';
import { majorToMinor, minorToMajorText, MoneyField } from './money';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function PaymentDialog({
  open,
  onOpenChange,
  invoice,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoice: InvoiceDto;
}) {
  const t = useTranslations('payments');
  const tMethods = useTranslations('paymentMethods');
  const tCommon = useTranslations('common');
  const queryClient = useQueryClient();
  const errorMessage = useApiErrorMessage();

  const [amountMajor, setAmountMajor] = useState(minorToMajorText(invoice.amountDueMinor));
  const [method, setMethod] = useState<(typeof PAYMENT_METHODS)[number]>('BANK_TRANSFER');
  const [paidOn, setPaidOn] = useState(today());
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setAmountMajor(minorToMajorText(invoice.amountDueMinor));
      setMethod('BANK_TRANSFER');
      setPaidOn(today());
      setReference('');
      setNote('');
      setError(null);
    }
  }, [open, invoice.amountDueMinor]);

  const mutation = useMutation({
    mutationFn: () =>
      api.invoices.registerPayment(invoice.id, {
        amountMinor: majorToMinor(amountMajor),
        method,
        paidOn,
        reference: reference.length > 0 ? reference : undefined,
        note: note.length > 0 ? note : undefined,
      }),
    onSuccess: async () => {
      toast.success(t('registered'));
      await queryClient.invalidateQueries({ queryKey: ['invoice', invoice.id] });
      await queryClient.invalidateQueries({ queryKey: ['invoice-payments', invoice.id] });
      await queryClient.invalidateQueries({ queryKey: ['invoice-activity', invoice.id] });
      await queryClient.invalidateQueries({ queryKey: ['invoices'] });
      onOpenChange(false);
    },
    onError: (err) => setError(errorMessage(err)),
  });

  function submit() {
    setError(null);
    if (majorToMinor(amountMajor) < 1) {
      setError(t('amountRequired'));
      return;
    }
    mutation.mutate();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (mutation.isPending ? undefined : onOpenChange(next))}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {error ? <ErrorState message={error} /> : null}
          <MoneyField
            id="payment-amount"
            label={t('amount')}
            value={amountMajor}
            onChange={(event) => setAmountMajor(event.target.value)}
          />
          <div className="space-y-2">
            <Label htmlFor="payment-method">{t('method')}</Label>
            <Select
              value={method}
              onValueChange={(value) => setMethod(value as (typeof PAYMENT_METHODS)[number])}
            >
              <SelectTrigger id="payment-method" aria-label={t('method')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAYMENT_METHODS.map((value) => (
                  <SelectItem key={value} value={value}>
                    {tMethods(value)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <TextField
            id="payment-paid-on"
            type="date"
            label={t('paidOn')}
            value={paidOn}
            onChange={(event) => setPaidOn(event.target.value)}
          />
          <TextField
            id="payment-reference"
            label={t('reference')}
            value={reference}
            onChange={(event) => setReference(event.target.value)}
          />
          <TextareaField
            id="payment-note"
            label={t('note')}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
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
          <Button type="button" loading={mutation.isPending} onClick={submit}>
            {t('submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
