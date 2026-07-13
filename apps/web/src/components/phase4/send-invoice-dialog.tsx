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
} from '@businessos/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ErrorState } from '@/components/data-states';
import { TextField } from '@/components/form-field';
import { api } from '@/lib/api';
import { useApiErrorMessage } from '@/lib/errors';

/** Sends the invoice email (with PDF). Recipient defaults to the customer's email. */
export function SendInvoiceDialog({
  open,
  onOpenChange,
  invoice,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoice: InvoiceDto;
}) {
  const t = useTranslations('invoices');
  const tCommon = useTranslations('common');
  const queryClient = useQueryClient();
  const errorMessage = useApiErrorMessage();

  const [to, setTo] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTo('');
      setError(null);
    }
  }, [open]);

  const mutation = useMutation({
    mutationFn: () => api.invoices.send(invoice.id, to.trim().length > 0 ? { to: to.trim() } : {}),
    onSuccess: async () => {
      toast.success(t('sentToast'));
      await queryClient.invalidateQueries({ queryKey: ['invoice', invoice.id] });
      await queryClient.invalidateQueries({ queryKey: ['invoice-activity', invoice.id] });
      await queryClient.invalidateQueries({ queryKey: ['invoices'] });
      onOpenChange(false);
    },
    onError: (err) => setError(errorMessage(err)),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (mutation.isPending ? undefined : onOpenChange(next))}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('sendTitle')}</DialogTitle>
          <DialogDescription>{t('sendDescription')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {error ? <ErrorState message={error} /> : null}
          <TextField
            id="invoice-send-to"
            type="email"
            label={t('sendRecipient')}
            placeholder={t('sendRecipientPlaceholder')}
            value={to}
            onChange={(event) => setTo(event.target.value)}
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
          <Button type="button" loading={mutation.isPending} onClick={() => mutation.mutate()}>
            {t('sendConfirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
