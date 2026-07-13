'use client';

import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@businessos/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Save } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { TextField } from '@/components/form-field';
import { useAccountOptions } from '@/components/phase5/account-select';
import {
  newVoucherLine,
  voucherEditorLinesToInput,
  VoucherLineEditor,
  voucherLinesComplete,
  type VoucherEditorLine,
} from '@/components/phase5/voucher-line-editor';
import { api } from '@/lib/api';
import { useApiErrorMessage } from '@/lib/errors';
import { can, useSession } from '@/lib/session';

const CURRENCY = 'SEK';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function NewVoucherPage() {
  const t = useTranslations('accounting');
  const router = useRouter();
  const queryClient = useQueryClient();
  const errorMessage = useApiErrorMessage();
  const { data: session } = useSession();
  const canManage = can(session, 'accounting.manage');
  const accountsQuery = useAccountOptions();

  const [date, setDate] = useState(today());
  const [description, setDescription] = useState('');
  const [lines, setLines] = useState<VoucherEditorLine[]>([
    newVoucherLine('debit'),
    newVoucherLine('credit'),
  ]);

  const createMutation = useMutation({
    mutationFn: () =>
      api.accounting.createVoucher({
        date,
        description: description.trim(),
        lines: voucherEditorLinesToInput(lines),
      }),
    onSuccess: async (voucher) => {
      toast.success(t('voucherCreated'));
      await queryClient.invalidateQueries({ queryKey: ['vouchers'] });
      router.push(`/accounting/vouchers/${voucher.id}`);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (!canManage) {
    return (
      <div className="mx-auto max-w-4xl">
        <Alert>
          <AlertTitle>{t('newVoucher')}</AlertTitle>
          <AlertDescription>{t('restricted')}</AlertDescription>
        </Alert>
      </div>
    );
  }

  const canSave =
    description.trim().length > 0 && voucherLinesComplete(lines) && !createMutation.isPending;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2 text-muted-foreground">
          <Link href="/accounting/vouchers">
            <ArrowLeft aria-hidden="true" />
            {t('backToJournal')}
          </Link>
        </Button>
        <h1 className="text-2xl font-semibold tracking-tight">{t('newVoucher')}</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('voucherDetails')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              id="voucher-date"
              type="date"
              label={t('voucherDate')}
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </div>
          <TextField
            id="voucher-description"
            label={t('voucherDescription')}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('voucherLines')}</CardTitle>
        </CardHeader>
        <CardContent>
          <VoucherLineEditor
            lines={lines}
            onChange={setLines}
            accounts={accountsQuery.data?.items ?? []}
            currency={CURRENCY}
          />
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <Button
          type="button"
          loading={createMutation.isPending}
          disabled={!canSave}
          onClick={() => createMutation.mutate()}
        >
          <Save aria-hidden="true" />
          {t('saveDraft')}
        </Button>
        {!voucherLinesComplete(lines) ? (
          <p className="text-sm text-muted-foreground">{t('linesIncompleteHint')}</p>
        ) : null}
      </div>
    </div>
  );
}
