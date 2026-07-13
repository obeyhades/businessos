'use client';

import type { CreditNoteLineInput, InvoiceDto } from '@businessos/types';
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
import { Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ErrorState } from '@/components/data-states';
import { TextareaField } from '@/components/form-field';
import { api } from '@/lib/api';
import { useApiErrorMessage } from '@/lib/errors';
import { majorToMinor, minorToMajorText } from './money';

interface CreditLine {
  key: string;
  description: string;
  quantity: string;
  unitPriceMajor: string;
  taxRatePercent: string;
}

let creditKeyCounter = 0;
function nextKey(): string {
  creditKeyCounter += 1;
  return `credit-${creditKeyCounter}`;
}

function linesFromInvoice(invoice: InvoiceDto): CreditLine[] {
  return invoice.lineItems.map((line) => ({
    key: nextKey(),
    description: line.description,
    quantity: line.quantity.toString(),
    unitPriceMajor: minorToMajorText(line.unitPriceMinor),
    taxRatePercent: line.taxRatePercent.toString(),
  }));
}

function toNumber(value: string): number {
  const parsed = Number.parseFloat(value.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function CreditNoteDialog({
  open,
  onOpenChange,
  invoice,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoice: InvoiceDto;
}) {
  const t = useTranslations('creditNotes');
  const tCommon = useTranslations('common');
  const queryClient = useQueryClient();
  const errorMessage = useApiErrorMessage();

  const [mode, setMode] = useState<'full' | 'custom'>('full');
  const [reason, setReason] = useState('');
  const [lines, setLines] = useState<CreditLine[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setMode('full');
      setReason('');
      setLines(linesFromInvoice(invoice));
      setError(null);
    }
  }, [open, invoice]);

  const mutation = useMutation({
    mutationFn: () => {
      const lineItems: CreditNoteLineInput[] | undefined =
        mode === 'full'
          ? undefined
          : lines.map((line) => ({
              description: line.description.trim(),
              quantity: toNumber(line.quantity),
              unitPriceMinor: majorToMinor(line.unitPriceMajor),
              taxRatePercent: toNumber(line.taxRatePercent),
            }));
      return api.invoices.createCreditNote(invoice.id, {
        reason: reason.length > 0 ? reason : undefined,
        lineItems,
      });
    },
    onSuccess: async () => {
      toast.success(t('issued'));
      await queryClient.invalidateQueries({ queryKey: ['invoice', invoice.id] });
      await queryClient.invalidateQueries({ queryKey: ['invoice-credit-notes', invoice.id] });
      await queryClient.invalidateQueries({ queryKey: ['invoice-activity', invoice.id] });
      await queryClient.invalidateQueries({ queryKey: ['invoices'] });
      onOpenChange(false);
    },
    onError: (err) => setError(errorMessage(err)),
  });

  function update(key: string, patch: Partial<CreditLine>) {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (mutation.isPending ? undefined : onOpenChange(next))}
    >
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {error ? <ErrorState message={error} /> : null}

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant={mode === 'full' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setMode('full')}
            >
              {t('modeFull')}
            </Button>
            <Button
              type="button"
              variant={mode === 'custom' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setMode('custom')}
            >
              {t('modeCustom')}
            </Button>
          </div>

          {mode === 'custom' ? (
            <div className="space-y-3">
              {lines.map((line) => (
                <div key={line.key} className="rounded-md border border-border p-3">
                  <div className="grid gap-2 sm:grid-cols-12">
                    <div className="space-y-1 sm:col-span-11">
                      <Label htmlFor={`${line.key}-desc`}>{t('lineDescription')}</Label>
                      <Input
                        id={`${line.key}-desc`}
                        value={line.description}
                        onChange={(event) => update(line.key, { description: event.target.value })}
                      />
                    </div>
                    <div className="flex items-end justify-end sm:col-span-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={t('lineRemove')}
                        onClick={() =>
                          setLines((current) => current.filter((item) => item.key !== line.key))
                        }
                      >
                        <Trash2 aria-hidden="true" />
                      </Button>
                    </div>
                    <div className="space-y-1 sm:col-span-4">
                      <Label htmlFor={`${line.key}-qty`}>{t('lineQuantity')}</Label>
                      <Input
                        id={`${line.key}-qty`}
                        inputMode="decimal"
                        value={line.quantity}
                        onChange={(event) => update(line.key, { quantity: event.target.value })}
                      />
                    </div>
                    <div className="space-y-1 sm:col-span-4">
                      <Label htmlFor={`${line.key}-price`}>{t('lineUnitPrice')}</Label>
                      <Input
                        id={`${line.key}-price`}
                        inputMode="decimal"
                        value={line.unitPriceMajor}
                        onChange={(event) =>
                          update(line.key, { unitPriceMajor: event.target.value })
                        }
                      />
                    </div>
                    <div className="space-y-1 sm:col-span-4">
                      <Label htmlFor={`${line.key}-vat`}>{t('lineVat')}</Label>
                      <Input
                        id={`${line.key}-vat`}
                        inputMode="decimal"
                        value={line.taxRatePercent}
                        onChange={(event) =>
                          update(line.key, { taxRatePercent: event.target.value })
                        }
                      />
                    </div>
                  </div>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setLines((current) => [
                    ...current,
                    {
                      key: nextKey(),
                      description: '',
                      quantity: '1',
                      unitPriceMajor: '0',
                      taxRatePercent: '25',
                    },
                  ])
                }
              >
                <Plus aria-hidden="true" />
                {t('addLine')}
              </Button>
            </div>
          ) : null}

          <TextareaField
            id="credit-reason"
            label={t('reason')}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
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
            {t('submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
