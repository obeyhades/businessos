'use client';

import type { InvoiceDto } from '@businessos/types';
import { Button, Card, CardContent, CardHeader, CardTitle, ConfirmDialog } from '@businessos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Download, Save, Trash2 } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { EmptyState, ErrorState, ListSkeleton } from '@/components/data-states';
import { TextareaField, TextField } from '@/components/form-field';
import { ActivityTimeline } from '@/components/phase2/activity-timeline';
import { InvoiceStatusBadge } from '@/components/phase4/badges';
import { CreditNoteDialog } from '@/components/phase4/credit-note-dialog';
import {
  editorLineFromDto,
  editorLinesToInput,
  LineItemEditor,
  LineItemTable,
  previewTotalMinor,
  type EditorLine,
} from '@/components/phase4/line-item-editor';
import { Money, useFormatMoney } from '@/components/phase4/money';
import { PaymentDialog } from '@/components/phase4/payment-dialog';
import { SendInvoiceDialog } from '@/components/phase4/send-invoice-dialog';
import { TotalsBlock } from '@/components/phase4/totals-block';
import { api } from '@/lib/api';
import { useApiErrorMessage } from '@/lib/errors';
import { can, useSession } from '@/lib/session';

function PaymentsCard({ invoice, canManage }: { invoice: InvoiceDto; canManage: boolean }) {
  const t = useTranslations('payments');
  const tMethods = useTranslations('paymentMethods');
  const tCommon = useTranslations('common');
  const format = useFormatter();
  const formatMoney = useFormatMoney();
  const queryClient = useQueryClient();
  const errorMessage = useApiErrorMessage();
  const [removing, setRemoving] = useState<string | null>(null);

  const paymentsQuery = useQuery({
    queryKey: ['invoice-payments', invoice.id],
    queryFn: () => api.invoices.listPayments(invoice.id),
  });

  const removeMutation = useMutation({
    mutationFn: (paymentId: string) => api.invoices.removePayment(invoice.id, paymentId),
    onSuccess: async () => {
      toast.success(t('removed'));
      setRemoving(null);
      await queryClient.invalidateQueries({ queryKey: ['invoice', invoice.id] });
      await queryClient.invalidateQueries({ queryKey: ['invoice-payments', invoice.id] });
      await queryClient.invalidateQueries({ queryKey: ['invoice-activity', invoice.id] });
      await queryClient.invalidateQueries({ queryKey: ['invoices'] });
    },
    onError: (error) => {
      toast.error(errorMessage(error));
      setRemoving(null);
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('listTitle')}</CardTitle>
      </CardHeader>
      <CardContent>
        {paymentsQuery.isPending ? (
          <ListSkeleton rows={2} />
        ) : paymentsQuery.isError ? (
          <ErrorState
            message={errorMessage(paymentsQuery.error)}
            onRetry={() => void paymentsQuery.refetch()}
          />
        ) : paymentsQuery.data.length === 0 ? (
          <EmptyState title={t('empty')} />
        ) : (
          <ul className="space-y-3">
            {paymentsQuery.data.map((payment) => (
              <li key={payment.id} className="flex items-center justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <p className="font-medium">
                    {formatMoney(payment.amountMinor, invoice.currency)} ·{' '}
                    {tMethods(payment.method)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {format.dateTime(new Date(payment.paidOn), { dateStyle: 'medium' })}
                    {payment.reference ? ` · ${payment.reference}` : ''}
                  </p>
                </div>
                {canManage ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={tCommon('remove')}
                    onClick={() => setRemoving(payment.id)}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(next) => (next ? undefined : setRemoving(null))}
        title={t('removeTitle')}
        description={t('removeDescription')}
        confirmLabel={tCommon('remove')}
        cancelLabel={tCommon('cancel')}
        destructive
        pending={removeMutation.isPending}
        onConfirm={() => removing && removeMutation.mutate(removing)}
      />
    </Card>
  );
}

function CreditNotesCard({ invoice }: { invoice: InvoiceDto }) {
  const t = useTranslations('creditNotes');
  const format = useFormatter();
  const formatMoney = useFormatMoney();
  const errorMessage = useApiErrorMessage();

  const creditNotesQuery = useQuery({
    queryKey: ['invoice-credit-notes', invoice.id],
    queryFn: () => api.invoices.listCreditNotes(invoice.id),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('listTitle')}</CardTitle>
      </CardHeader>
      <CardContent>
        {creditNotesQuery.isPending ? (
          <ListSkeleton rows={2} />
        ) : creditNotesQuery.isError ? (
          <ErrorState
            message={errorMessage(creditNotesQuery.error)}
            onRetry={() => void creditNotesQuery.refetch()}
          />
        ) : creditNotesQuery.data.length === 0 ? (
          <EmptyState title={t('empty')} />
        ) : (
          <ul className="space-y-3">
            {creditNotesQuery.data.map((note) => (
              <li key={note.id} className="flex items-center justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <p className="font-medium">{note.number ?? t('draftLabel')}</p>
                  <p className="text-xs text-muted-foreground">
                    {format.dateTime(new Date(note.issueDate), { dateStyle: 'medium' })}
                    {note.reason ? ` · ${note.reason}` : ''}
                  </p>
                </div>
                <span className="font-medium">
                  {formatMoney(note.totalMinor, invoice.currency)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function InvoiceDetail({ invoice }: { invoice: InvoiceDto }) {
  const t = useTranslations('invoices');
  const tBilling = useTranslations('billing');
  const tCommon = useTranslations('common');
  const format = useFormatter();
  const router = useRouter();
  const queryClient = useQueryClient();
  const errorMessage = useApiErrorMessage();
  const { data: session } = useSession();
  const canManage = can(session, 'invoices.manage');

  const isDraft = invoice.status === 'DRAFT';
  const editable = isDraft && canManage;
  const finalized = !isDraft;
  const isSettled = invoice.status === 'CANCELLED' || invoice.status === 'CREDITED';
  const canRegisterPayment = finalized && canManage && !isSettled && invoice.amountDueMinor > 0;
  const canCancel =
    finalized &&
    canManage &&
    invoice.amountPaidMinor === 0 &&
    invoice.status !== 'PAID' &&
    !isSettled;
  const canCredit = finalized && canManage && !isSettled;

  const productsQuery = useQuery({
    queryKey: ['products', 'options'],
    queryFn: () => api.products.list({ page: 1, pageSize: 100, active: 'true' }),
    enabled: editable,
  });

  const [lines, setLines] = useState<EditorLine[]>(invoice.lineItems.map(editorLineFromDto));
  const [issueDate, setIssueDate] = useState(invoice.issueDate);
  const [dueDate, setDueDate] = useState(invoice.dueDate);
  const [customerNotes, setCustomerNotes] = useState(invoice.customerNotes ?? '');
  const [internalNotes, setInternalNotes] = useState(invoice.internalNotes ?? '');

  const [finalizeOpen, setFinalizeOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [creditOpen, setCreditOpen] = useState(false);

  useEffect(() => {
    setLines(invoice.lineItems.map(editorLineFromDto));
    setIssueDate(invoice.issueDate);
    setDueDate(invoice.dueDate);
    setCustomerNotes(invoice.customerNotes ?? '');
    setInternalNotes(invoice.internalNotes ?? '');
  }, [invoice]);

  async function invalidate() {
    await queryClient.invalidateQueries({ queryKey: ['invoice', invoice.id] });
    await queryClient.invalidateQueries({ queryKey: ['invoice-activity', invoice.id] });
    await queryClient.invalidateQueries({ queryKey: ['invoices'] });
  }

  const saveMutation = useMutation({
    mutationFn: () =>
      api.invoices.update(invoice.id, {
        issueDate,
        dueDate,
        customerNotes,
        internalNotes,
        lineItems: editorLinesToInput(lines),
      }),
    onSuccess: async () => {
      toast.success(t('saved'));
      await invalidate();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const finalizeMutation = useMutation({
    mutationFn: () => api.invoices.finalize(invoice.id),
    onSuccess: async () => {
      toast.success(t('finalizedToast'));
      setFinalizeOpen(false);
      await invalidate();
    },
    onError: (error) => {
      toast.error(errorMessage(error));
      setFinalizeOpen(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.invoices.remove(invoice.id),
    onSuccess: async () => {
      toast.success(t('deletedToast'));
      await queryClient.invalidateQueries({ queryKey: ['invoices'] });
      router.push('/invoices');
    },
    onError: (error) => {
      toast.error(errorMessage(error));
      setDeleteOpen(false);
    },
  });

  const cancelMutation = useMutation({
    mutationFn: () => api.invoices.cancel(invoice.id),
    onSuccess: async () => {
      toast.success(t('cancelledToast'));
      setCancelOpen(false);
      await invalidate();
    },
    onError: (error) => {
      toast.error(errorMessage(error));
      setCancelOpen(false);
    },
  });

  const pdfMutation = useMutation({
    mutationFn: () => api.invoices.pdfUrl(invoice.id),
    onSuccess: (result) => {
      window.open(result.url, '_blank', 'noopener,noreferrer');
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2 text-muted-foreground">
          <Link href="/invoices">
            <ArrowLeft aria-hidden="true" />
            {t('backToList')}
          </Link>
        </Button>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-semibold tracking-tight">
                {invoice.number ?? t('draftLabel')}
              </h1>
              <InvoiceStatusBadge status={invoice.status} isOverdue={invoice.isOverdue} />
            </div>
            <p className="text-sm text-muted-foreground">{invoice.customer.name}</p>
          </div>
          {canManage ? (
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
                  <Button type="button" variant="outline" onClick={() => setFinalizeOpen(true)}>
                    {t('finalize')}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setDeleteOpen(true)}>
                    {tCommon('remove')}
                  </Button>
                </>
              ) : null}
              {invoice.hasPdf ? (
                <Button
                  type="button"
                  variant="outline"
                  loading={pdfMutation.isPending}
                  onClick={() => pdfMutation.mutate()}
                >
                  <Download aria-hidden="true" />
                  {t('downloadPdf')}
                </Button>
              ) : null}
              {finalized && !isSettled ? (
                <Button type="button" variant="outline" onClick={() => setSendOpen(true)}>
                  {t('send')}
                </Button>
              ) : null}
              {canRegisterPayment ? (
                <Button type="button" onClick={() => setPaymentOpen(true)}>
                  {t('registerPayment')}
                </Button>
              ) : null}
              {canCredit ? (
                <Button type="button" variant="outline" onClick={() => setCreditOpen(true)}>
                  {t('issueCreditNote')}
                </Button>
              ) : null}
              {canCancel ? (
                <Button type="button" variant="outline" onClick={() => setCancelOpen(true)}>
                  {t('cancel')}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>{tBilling('details')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{tBilling('customer')}</span>
                <span className="font-medium">{invoice.customer.name}</span>
              </div>
              {editable ? (
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
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">{tBilling('issueDate')}</span>
                    <span>
                      {format.dateTime(new Date(invoice.issueDate), { dateStyle: 'medium' })}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">{tBilling('dueDate')}</span>
                    <span>
                      {format.dateTime(new Date(invoice.dueDate), { dateStyle: 'medium' })}
                    </span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{tBilling('lineItems')}</CardTitle>
            </CardHeader>
            <CardContent>
              {editable ? (
                <LineItemEditor
                  lines={lines}
                  onChange={setLines}
                  products={productsQuery.data?.items ?? []}
                  currency={invoice.currency}
                />
              ) : (
                <LineItemTable lines={invoice.lineItems} currency={invoice.currency} />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{tBilling('notes')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {editable ? (
                <>
                  <TextareaField
                    id="invoice-customer-notes"
                    label={tBilling('customerNotes')}
                    value={customerNotes}
                    onChange={(event) => setCustomerNotes(event.target.value)}
                  />
                  <TextareaField
                    id="invoice-internal-notes"
                    label={tBilling('internalNotes')}
                    value={internalNotes}
                    onChange={(event) => setInternalNotes(event.target.value)}
                  />
                </>
              ) : (
                <div className="space-y-3 text-sm">
                  <div>
                    <p className="text-muted-foreground">{tBilling('customerNotes')}</p>
                    <p>{invoice.customerNotes ?? '—'}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">{tBilling('internalNotes')}</p>
                    <p>{invoice.internalNotes ?? '—'}</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {finalized ? <PaymentsCard invoice={invoice} canManage={canManage} /> : null}
          {finalized ? <CreditNotesCard invoice={invoice} /> : null}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{tBilling('totals')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {editable ? (
                <div className="flex items-center justify-between border-b border-border pb-3 text-sm">
                  <span className="text-muted-foreground">{tBilling('previewTotal')}</span>
                  <span className="font-medium">
                    <Money amountMinor={previewTotalMinor(lines)} currency={invoice.currency} />
                  </span>
                </div>
              ) : null}
              <TotalsBlock
                currency={invoice.currency}
                subtotalMinor={invoice.subtotalMinor}
                discountMinor={invoice.discountMinor}
                taxMinor={invoice.taxMinor}
                totalMinor={invoice.totalMinor}
                taxLines={invoice.taxLines}
                amountPaidMinor={finalized ? invoice.amountPaidMinor : undefined}
                creditedMinor={finalized ? invoice.creditedMinor : undefined}
                amountDueMinor={finalized ? invoice.amountDueMinor : undefined}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{tBilling('activity')}</CardTitle>
            </CardHeader>
            <CardContent>
              <ActivityTimeline
                queryKey={['invoice-activity', invoice.id]}
                queryFn={() => api.invoices.activity(invoice.id)}
              />
            </CardContent>
          </Card>
        </div>
      </div>

      <ConfirmDialog
        open={finalizeOpen}
        onOpenChange={setFinalizeOpen}
        title={t('finalizeTitle')}
        description={t('finalizeDescription')}
        confirmLabel={t('finalize')}
        cancelLabel={tCommon('cancel')}
        pending={finalizeMutation.isPending}
        onConfirm={() => finalizeMutation.mutate()}
      />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t('deleteTitle')}
        description={t('deleteDescription')}
        confirmLabel={tCommon('remove')}
        cancelLabel={tCommon('cancel')}
        destructive
        pending={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate()}
      />
      <ConfirmDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title={t('cancelTitle')}
        description={t('cancelDescription')}
        confirmLabel={t('cancelConfirm')}
        cancelLabel={tCommon('cancel')}
        destructive
        pending={cancelMutation.isPending}
        onConfirm={() => cancelMutation.mutate()}
      />
      <SendInvoiceDialog open={sendOpen} onOpenChange={setSendOpen} invoice={invoice} />
      <PaymentDialog open={paymentOpen} onOpenChange={setPaymentOpen} invoice={invoice} />
      <CreditNoteDialog open={creditOpen} onOpenChange={setCreditOpen} invoice={invoice} />
    </div>
  );
}

export default function InvoiceDetailPage() {
  const params = useParams<{ id: string }>();
  const invoiceId = params.id;
  const errorMessage = useApiErrorMessage();

  const invoiceQuery = useQuery({
    queryKey: ['invoice', invoiceId],
    queryFn: () => api.invoices.get(invoiceId),
    enabled: Boolean(invoiceId),
  });

  if (invoiceQuery.isPending) {
    return (
      <div className="mx-auto max-w-6xl space-y-6">
        <ListSkeleton rows={6} />
      </div>
    );
  }
  if (invoiceQuery.isError) {
    return (
      <div className="mx-auto max-w-6xl">
        <ErrorState
          message={errorMessage(invoiceQuery.error)}
          onRetry={() => void invoiceQuery.refetch()}
        />
      </div>
    );
  }

  return <InvoiceDetail invoice={invoiceQuery.data} />;
}
