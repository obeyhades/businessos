'use client';

import type { VoucherDto } from '@businessos/types';
import { Button, Card, CardContent, CardHeader, CardTitle, ConfirmDialog } from '@businessos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, RotateCcw, Save, Trash2 } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ErrorState, ListSkeleton } from '@/components/data-states';
import { TextField } from '@/components/form-field';
import { Money } from '@/components/phase4/money';
import { useAccountOptions } from '@/components/phase5/account-select';
import { BalancedBadge, VoucherSourceBadge, VoucherStatusBadge } from '@/components/phase5/badges';
import { VoucherAttachments } from '@/components/phase5/voucher-attachments';
import {
  voucherEditorLinesFromDto,
  voucherEditorLinesToInput,
  VoucherLineEditor,
  VoucherLineTable,
  type VoucherEditorLine,
} from '@/components/phase5/voucher-line-editor';
import { api } from '@/lib/api';
import { useApiErrorMessage } from '@/lib/errors';
import { can, useSession } from '@/lib/session';

const CURRENCY = 'SEK';

function VoucherDetail({ voucher }: { voucher: VoucherDto }) {
  const t = useTranslations('accounting');
  const tCommon = useTranslations('common');
  const format = useFormatter();
  const router = useRouter();
  const queryClient = useQueryClient();
  const errorMessage = useApiErrorMessage();
  const { data: session } = useSession();
  const canManage = can(session, 'accounting.manage');
  const canPost = can(session, 'accounting.post');

  const isDraft = voucher.status === 'DRAFT';
  const isPosted = voucher.status === 'POSTED';
  const editable = isDraft && canManage;

  const accountsQuery = useAccountOptions();

  const [date, setDate] = useState(voucher.date);
  const [description, setDescription] = useState(voucher.description);
  const [lines, setLines] = useState<VoucherEditorLine[]>(voucherEditorLinesFromDto(voucher.lines));

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [postOpen, setPostOpen] = useState(false);
  const [reverseOpen, setReverseOpen] = useState(false);

  useEffect(() => {
    setDate(voucher.date);
    setDescription(voucher.description);
    setLines(voucherEditorLinesFromDto(voucher.lines));
  }, [voucher]);

  async function invalidate() {
    await queryClient.invalidateQueries({ queryKey: ['voucher', voucher.id] });
    await queryClient.invalidateQueries({ queryKey: ['vouchers'] });
  }

  const saveMutation = useMutation({
    mutationFn: () =>
      api.accounting.updateVoucher(voucher.id, {
        date,
        description: description.trim(),
        lines: voucherEditorLinesToInput(lines),
      }),
    onSuccess: async () => {
      toast.success(t('voucherSaved'));
      await invalidate();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.accounting.removeVoucher(voucher.id),
    onSuccess: async () => {
      toast.success(t('voucherDeleted'));
      await queryClient.invalidateQueries({ queryKey: ['vouchers'] });
      router.push('/accounting/vouchers');
    },
    onError: (error) => {
      toast.error(errorMessage(error));
      setDeleteOpen(false);
    },
  });

  const postMutation = useMutation({
    mutationFn: () => api.accounting.postVoucher(voucher.id),
    onSuccess: async () => {
      toast.success(t('voucherPosted'));
      setPostOpen(false);
      await invalidate();
    },
    onError: (error) => {
      toast.error(errorMessage(error));
      setPostOpen(false);
    },
  });

  const reverseMutation = useMutation({
    mutationFn: () => api.accounting.reverseVoucher(voucher.id),
    onSuccess: async (reversal) => {
      toast.success(t('voucherReversed'));
      setReverseOpen(false);
      await invalidate();
      router.push(`/accounting/vouchers/${reversal.id}`);
    },
    onError: (error) => {
      toast.error(errorMessage(error));
      setReverseOpen(false);
    },
  });

  const reconcileMutation = useMutation({
    mutationFn: (reconciled: boolean) =>
      api.accounting.reconcileVoucher(voucher.id, { reconciled }),
    onSuccess: async () => {
      toast.success(t('reconcileUpdated'));
      await invalidate();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const isReconciled = voucher.reconciledAt !== null;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2 text-muted-foreground">
          <Link href="/accounting/vouchers">
            <ArrowLeft aria-hidden="true" />
            {t('backToJournal')}
          </Link>
        </Button>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-semibold tracking-tight">
                {voucher.number ?? t('draftLabel')}
              </h1>
              <VoucherStatusBadge status={voucher.status} />
              <VoucherSourceBadge source={voucher.source} />
              <BalancedBadge balanced={voucher.isBalanced} />
            </div>
            <p className="text-sm text-muted-foreground">{voucher.description}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {editable ? (
              <>
                <Button
                  type="button"
                  loading={saveMutation.isPending}
                  onClick={() => saveMutation.mutate()}
                >
                  <Save aria-hidden="true" />
                  {tCommon('save')}
                </Button>
                <Button type="button" variant="outline" onClick={() => setDeleteOpen(true)}>
                  <Trash2 aria-hidden="true" />
                  {tCommon('remove')}
                </Button>
              </>
            ) : null}
            {isDraft && canPost ? (
              <Button
                type="button"
                variant="outline"
                disabled={!voucher.isBalanced}
                onClick={() => setPostOpen(true)}
              >
                {t('post')}
              </Button>
            ) : null}
            {isPosted && canPost ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  loading={reconcileMutation.isPending}
                  onClick={() => reconcileMutation.mutate(!isReconciled)}
                >
                  {isReconciled ? t('unreconcile') : t('reconcile')}
                </Button>
                {voucher.reversedByVoucherId === null ? (
                  <Button type="button" variant="outline" onClick={() => setReverseOpen(true)}>
                    <RotateCcw aria-hidden="true" />
                    {t('reverse')}
                  </Button>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
      </div>

      {isDraft && !voucher.isBalanced ? <ErrorState message={t('unbalancedHint')} /> : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>{t('voucherDetails')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {editable ? (
                <>
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
                </>
              ) : (
                <div className="grid gap-4 text-sm sm:grid-cols-2">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">{t('voucherDate')}</span>
                    <span>{format.dateTime(new Date(voucher.date), { dateStyle: 'medium' })}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">{t('voucherSourceLabel')}</span>
                    <VoucherSourceBadge source={voucher.source} />
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('voucherLines')}</CardTitle>
            </CardHeader>
            <CardContent>
              {editable ? (
                <VoucherLineEditor
                  lines={lines}
                  onChange={setLines}
                  accounts={accountsQuery.data?.items ?? []}
                  currency={CURRENCY}
                />
              ) : (
                <VoucherLineTable lines={voucher.lines} currency={CURRENCY} />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('receipts')}</CardTitle>
            </CardHeader>
            <CardContent>
              <VoucherAttachments voucherId={voucher.id} canManage={canManage} />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{t('summary')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{t('totalDebit')}</span>
                <span className="font-medium">
                  <Money amountMinor={voucher.totalDebitMinor} currency={CURRENCY} />
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{t('totalCredit')}</span>
                <span className="font-medium">
                  <Money amountMinor={voucher.totalCreditMinor} currency={CURRENCY} />
                </span>
              </div>
              <div className="flex items-center justify-between border-t border-border pt-3">
                <span className="text-muted-foreground">{t('balancedLabel')}</span>
                <BalancedBadge balanced={voucher.isBalanced} />
              </div>
              {voucher.postedAt ? (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">{t('postedAt')}</span>
                  <span>
                    {format.dateTime(new Date(voucher.postedAt), { dateStyle: 'medium' })}
                  </span>
                </div>
              ) : null}
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{t('reconciledLabel')}</span>
                <span>
                  {isReconciled
                    ? format.dateTime(new Date(voucher.reconciledAt as string), {
                        dateStyle: 'medium',
                      })
                    : t('notReconciled')}
                </span>
              </div>
              {voucher.reversesVoucherId ? (
                <div className="border-t border-border pt-3">
                  <Button asChild variant="link" size="sm" className="h-auto p-0">
                    <Link href={`/accounting/vouchers/${voucher.reversesVoucherId}`}>
                      {t('reversesLink')}
                    </Link>
                  </Button>
                </div>
              ) : null}
              {voucher.reversedByVoucherId ? (
                <div className="border-t border-border pt-3">
                  <Button asChild variant="link" size="sm" className="h-auto p-0">
                    <Link href={`/accounting/vouchers/${voucher.reversedByVoucherId}`}>
                      {t('reversedByLink')}
                    </Link>
                  </Button>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t('deleteVoucherTitle')}
        description={t('deleteVoucherDescription')}
        confirmLabel={tCommon('remove')}
        cancelLabel={tCommon('cancel')}
        destructive
        pending={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate()}
      />
      <ConfirmDialog
        open={postOpen}
        onOpenChange={setPostOpen}
        title={t('postVoucherTitle')}
        description={t('postVoucherDescription')}
        confirmLabel={t('post')}
        cancelLabel={tCommon('cancel')}
        pending={postMutation.isPending}
        onConfirm={() => postMutation.mutate()}
      />
      <ConfirmDialog
        open={reverseOpen}
        onOpenChange={setReverseOpen}
        title={t('reverseVoucherTitle')}
        description={t('reverseVoucherDescription')}
        confirmLabel={t('reverse')}
        cancelLabel={tCommon('cancel')}
        pending={reverseMutation.isPending}
        onConfirm={() => reverseMutation.mutate()}
      />
    </div>
  );
}

export default function VoucherDetailPage() {
  const params = useParams<{ id: string }>();
  const voucherId = params.id;
  const errorMessage = useApiErrorMessage();

  const voucherQuery = useQuery({
    queryKey: ['voucher', voucherId],
    queryFn: () => api.accounting.getVoucher(voucherId),
    enabled: Boolean(voucherId),
  });

  if (voucherQuery.isPending) {
    return (
      <div className="mx-auto max-w-6xl space-y-6">
        <ListSkeleton rows={6} />
      </div>
    );
  }
  if (voucherQuery.isError) {
    return (
      <div className="mx-auto max-w-6xl">
        <ErrorState
          message={errorMessage(voucherQuery.error)}
          onRetry={() => void voucherQuery.refetch()}
        />
      </div>
    );
  }

  return <VoucherDetail voucher={voucherQuery.data} />;
}
