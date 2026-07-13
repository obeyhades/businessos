'use client';

import type { QuoteDto } from '@businessos/types';
import { Button, Card, CardContent, CardHeader, CardTitle, ConfirmDialog } from '@businessos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Save } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ErrorState, ListSkeleton } from '@/components/data-states';
import { QuoteStatusBadge } from '@/components/phase4/badges';
import {
  editorLineFromDto,
  editorLinesToInput,
  LineItemEditor,
  LineItemTable,
  previewTotalMinor,
  type EditorLine,
} from '@/components/phase4/line-item-editor';
import { Money } from '@/components/phase4/money';
import { TotalsBlock } from '@/components/phase4/totals-block';
import { TextareaField, TextField } from '@/components/form-field';
import { api } from '@/lib/api';
import { useApiErrorMessage } from '@/lib/errors';
import { can, useSession } from '@/lib/session';

function QuoteDetail({ quote }: { quote: QuoteDto }) {
  const t = useTranslations('quotes');
  const tBilling = useTranslations('billing');
  const tCommon = useTranslations('common');
  const format = useFormatter();
  const router = useRouter();
  const queryClient = useQueryClient();
  const errorMessage = useApiErrorMessage();
  const { data: session } = useSession();
  const canManage = can(session, 'invoices.manage');

  const isDraft = quote.status === 'DRAFT';
  const editable = isDraft && canManage;

  const productsQuery = useQuery({
    queryKey: ['products', 'options'],
    queryFn: () => api.products.list({ page: 1, pageSize: 100, active: 'true' }),
    enabled: editable,
  });

  const [lines, setLines] = useState<EditorLine[]>(quote.lineItems.map(editorLineFromDto));
  const [issueDate, setIssueDate] = useState(quote.issueDate);
  const [validUntil, setValidUntil] = useState(quote.validUntil ?? '');
  const [customerNotes, setCustomerNotes] = useState(quote.customerNotes ?? '');
  const [internalNotes, setInternalNotes] = useState(quote.internalNotes ?? '');

  const [sendOpen, setSendOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  useEffect(() => {
    setLines(quote.lineItems.map(editorLineFromDto));
    setIssueDate(quote.issueDate);
    setValidUntil(quote.validUntil ?? '');
    setCustomerNotes(quote.customerNotes ?? '');
    setInternalNotes(quote.internalNotes ?? '');
  }, [quote]);

  async function invalidate() {
    await queryClient.invalidateQueries({ queryKey: ['quote', quote.id] });
    await queryClient.invalidateQueries({ queryKey: ['quotes'] });
  }

  const saveMutation = useMutation({
    mutationFn: () =>
      api.quotes.update(quote.id, {
        issueDate,
        validUntil: validUntil.length > 0 ? validUntil : null,
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

  const sendMutation = useMutation({
    mutationFn: () => api.quotes.send(quote.id),
    onSuccess: async () => {
      toast.success(t('sentToast'));
      setSendOpen(false);
      await invalidate();
    },
    onError: (error) => {
      toast.error(errorMessage(error));
      setSendOpen(false);
    },
  });

  const acceptMutation = useMutation({
    mutationFn: () => api.quotes.accept(quote.id),
    onSuccess: async () => {
      toast.success(t('acceptedToast'));
      await invalidate();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const declineMutation = useMutation({
    mutationFn: () => api.quotes.decline(quote.id),
    onSuccess: async () => {
      toast.success(t('declinedToast'));
      await invalidate();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const convertMutation = useMutation({
    mutationFn: () => api.quotes.convert(quote.id),
    onSuccess: async (invoice) => {
      toast.success(t('convertedToast'));
      await invalidate();
      await queryClient.invalidateQueries({ queryKey: ['invoices'] });
      router.push(`/invoices/${invoice.id}`);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.quotes.remove(quote.id),
    onSuccess: async () => {
      toast.success(t('deletedToast'));
      await queryClient.invalidateQueries({ queryKey: ['quotes'] });
      router.push('/quotes');
    },
    onError: (error) => {
      toast.error(errorMessage(error));
      setDeleteOpen(false);
    },
  });

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2 text-muted-foreground">
          <Link href="/quotes">
            <ArrowLeft aria-hidden="true" />
            {t('backToList')}
          </Link>
        </Button>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">
              {quote.number ?? t('draftLabel')}
            </h1>
            <QuoteStatusBadge status={quote.status} />
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
                  <Button type="button" variant="outline" onClick={() => setSendOpen(true)}>
                    {t('send')}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setDeleteOpen(true)}>
                    {tCommon('remove')}
                  </Button>
                </>
              ) : null}
              {quote.status === 'SENT' ? (
                <>
                  <Button
                    type="button"
                    loading={acceptMutation.isPending}
                    onClick={() => acceptMutation.mutate()}
                  >
                    {t('accept')}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    loading={declineMutation.isPending}
                    onClick={() => declineMutation.mutate()}
                  >
                    {t('decline')}
                  </Button>
                </>
              ) : null}
              {quote.status === 'ACCEPTED' && !quote.convertedInvoiceId ? (
                <Button
                  type="button"
                  loading={convertMutation.isPending}
                  onClick={() => convertMutation.mutate()}
                >
                  {t('convert')}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {quote.convertedInvoiceId ? (
        <Card>
          <CardContent className="flex items-center justify-between gap-4 pt-6">
            <span className="text-sm text-muted-foreground">{t('convertedNotice')}</span>
            <Button asChild variant="outline" size="sm">
              <Link href={`/invoices/${quote.convertedInvoiceId}`}>{t('viewInvoice')}</Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>{tBilling('details')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{tBilling('customer')}</span>
                <span className="font-medium">{quote.customer.name}</span>
              </div>
              {editable ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <TextField
                    id="quote-issue-date"
                    type="date"
                    label={tBilling('issueDate')}
                    value={issueDate}
                    onChange={(event) => setIssueDate(event.target.value)}
                  />
                  <TextField
                    id="quote-valid-until"
                    type="date"
                    label={tBilling('validUntil')}
                    value={validUntil}
                    onChange={(event) => setValidUntil(event.target.value)}
                  />
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">{tBilling('issueDate')}</span>
                    <span>
                      {format.dateTime(new Date(quote.issueDate), { dateStyle: 'medium' })}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">{tBilling('validUntil')}</span>
                    <span>
                      {quote.validUntil
                        ? format.dateTime(new Date(quote.validUntil), { dateStyle: 'medium' })
                        : '—'}
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
                  currency={quote.currency}
                />
              ) : (
                <LineItemTable lines={quote.lineItems} currency={quote.currency} />
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
                    id="quote-customer-notes"
                    label={tBilling('customerNotes')}
                    value={customerNotes}
                    onChange={(event) => setCustomerNotes(event.target.value)}
                  />
                  <TextareaField
                    id="quote-internal-notes"
                    label={tBilling('internalNotes')}
                    value={internalNotes}
                    onChange={(event) => setInternalNotes(event.target.value)}
                  />
                </>
              ) : (
                <div className="space-y-3 text-sm">
                  <div>
                    <p className="text-muted-foreground">{tBilling('customerNotes')}</p>
                    <p>{quote.customerNotes ?? '—'}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">{tBilling('internalNotes')}</p>
                    <p>{quote.internalNotes ?? '—'}</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
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
                    <Money amountMinor={previewTotalMinor(lines)} currency={quote.currency} />
                  </span>
                </div>
              ) : null}
              <TotalsBlock
                currency={quote.currency}
                subtotalMinor={quote.subtotalMinor}
                discountMinor={quote.discountMinor}
                taxMinor={quote.taxMinor}
                totalMinor={quote.totalMinor}
                taxLines={quote.taxLines}
              />
            </CardContent>
          </Card>
        </div>
      </div>

      <ConfirmDialog
        open={sendOpen}
        onOpenChange={setSendOpen}
        title={t('sendTitle')}
        description={t('sendDescription')}
        confirmLabel={t('send')}
        cancelLabel={tCommon('cancel')}
        pending={sendMutation.isPending}
        onConfirm={() => sendMutation.mutate()}
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
    </div>
  );
}

export default function QuoteDetailPage() {
  const params = useParams<{ id: string }>();
  const quoteId = params.id;
  const errorMessage = useApiErrorMessage();

  const quoteQuery = useQuery({
    queryKey: ['quote', quoteId],
    queryFn: () => api.quotes.get(quoteId),
    enabled: Boolean(quoteId),
  });

  if (quoteQuery.isPending) {
    return (
      <div className="mx-auto max-w-6xl space-y-6">
        <ListSkeleton rows={6} />
      </div>
    );
  }
  if (quoteQuery.isError) {
    return (
      <div className="mx-auto max-w-6xl">
        <ErrorState
          message={errorMessage(quoteQuery.error)}
          onRetry={() => void quoteQuery.refetch()}
        />
      </div>
    );
  }

  return <QuoteDetail quote={quoteQuery.data} />;
}
