'use client';

import type { InvoiceDto } from '@businessos/types';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
} from '@businessos/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { ErrorState } from '@/components/data-states';
import { TextField } from '@/components/form-field';
import { api } from '@/lib/api';
import { useApiErrorMessage } from '@/lib/errors';
import { CustomerSelect } from './customer-select';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function inDays(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * Collects the minimum a draft invoice needs (customer + dates), creates it with
 * one placeholder line, then hands off to the editor.
 */
export function InvoiceCreateDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (invoice: InvoiceDto) => void;
}) {
  const t = useTranslations('invoices');
  const tBilling = useTranslations('billing');
  const tCommon = useTranslations('common');
  const queryClient = useQueryClient();
  const errorMessage = useApiErrorMessage();

  const [customerId, setCustomerId] = useState('');
  const [issueDate, setIssueDate] = useState(today());
  const [dueDate, setDueDate] = useState(inDays(30));
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      api.invoices.create({
        customerId,
        currency: 'SEK',
        issueDate,
        dueDate,
        lineItems: [
          {
            description: tBilling('defaultLineDescription'),
            quantity: 1,
            unitPriceMinor: 0,
            discountPercent: 0,
            taxRatePercent: 25,
          },
        ],
      }),
    onSuccess: async (invoice) => {
      toast.success(t('created'));
      await queryClient.invalidateQueries({ queryKey: ['invoices'] });
      onOpenChange(false);
      onCreated(invoice);
    },
    onError: (err) => setError(errorMessage(err)),
  });

  function submit() {
    setError(null);
    if (!customerId) {
      setError(tBilling('customerRequired'));
      return;
    }
    mutation.mutate();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (mutation.isPending ? undefined : onOpenChange(next))}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('createTitle')}</DialogTitle>
          <DialogDescription>{t('createDescription')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {error ? <ErrorState message={error} /> : null}
          <div className="space-y-2">
            <Label htmlFor="invoice-customer">{tBilling('customer')}</Label>
            <CustomerSelect
              id="invoice-customer"
              ariaLabel={tBilling('customer')}
              value={customerId}
              onValueChange={setCustomerId}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              id="invoice-issue-date"
              type="date"
              label={tBilling('issueDate')}
              value={issueDate}
              onChange={(event) => setIssueDate(event.target.value)}
            />
            <TextField
              id="invoice-due-date"
              type="date"
              label={tBilling('dueDate')}
              value={dueDate}
              onChange={(event) => setDueDate(event.target.value)}
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
          <Button type="button" loading={mutation.isPending} onClick={submit}>
            {t('createAndEdit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
