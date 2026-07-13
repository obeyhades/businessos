'use client';

import type { CustomerDto } from '@businessos/types';
import { Button, Card, CardContent, CardHeader, CardTitle, ConfirmDialog } from '@businessos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Pencil } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { ErrorState, ListSkeleton } from '@/components/data-states';
import { ActivityTimeline } from '@/components/phase2/activity-timeline';
import { AttachmentsSection } from '@/components/phase2/attachments-section';
import { CustomerStatusBadge } from '@/components/phase2/badges';
import { CommentsSection } from '@/components/phase2/comments-section';
import { ContactsCard } from '@/components/phase2/contacts-card';
import { CustomerFormDialog } from '@/components/phase2/customer-form-dialog';
import { api } from '@/lib/api';
import { useApiErrorMessage } from '@/lib/errors';
import { can, useSession } from '@/lib/session';

function OverviewRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:justify-between sm:gap-4">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm sm:text-right">{value && value.length > 0 ? value : '—'}</span>
    </div>
  );
}

function CustomerDetail({ customer }: { customer: CustomerDto }) {
  const t = useTranslations('customers');
  const tCommon = useTranslations('common');
  const queryClient = useQueryClient();
  const errorMessage = useApiErrorMessage();
  const { data: session } = useSession();
  const canManage = can(session, 'customers.manage');

  const [editOpen, setEditOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);

  const archiveMutation = useMutation({
    mutationFn: () => api.customers.update(customer.id, { status: 'ARCHIVED' }),
    onSuccess: async () => {
      toast.success(t('archivedToast'));
      setArchiveOpen(false);
      await queryClient.invalidateQueries({ queryKey: ['customer', customer.id] });
      await queryClient.invalidateQueries({ queryKey: ['customers'] });
    },
    onError: (error) => {
      toast.error(errorMessage(error));
      setArchiveOpen(false);
    },
  });

  const address = [
    customer.addressLine1,
    customer.addressLine2,
    [customer.postalCode, customer.city].filter(Boolean).join(' '),
    customer.country,
  ]
    .filter((part) => part && part.length > 0)
    .join(', ');

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2 text-muted-foreground">
          <Link href="/customers">
            <ArrowLeft aria-hidden="true" />
            {t('backToList')}
          </Link>
        </Button>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">{customer.name}</h1>
            <CustomerStatusBadge status={customer.status} />
          </div>
          {canManage ? (
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => setEditOpen(true)}>
                <Pencil aria-hidden="true" />
                {tCommon('edit')}
              </Button>
              {customer.status !== 'ARCHIVED' ? (
                <Button type="button" variant="outline" onClick={() => setArchiveOpen(true)}>
                  {t('archive')}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{t('overview')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <OverviewRow label={t('form.orgNumber')} value={customer.orgNumber} />
              <OverviewRow label={tCommon('email')} value={customer.email} />
              <OverviewRow label={t('form.phone')} value={customer.phone} />
              <OverviewRow label={t('address')} value={address.length > 0 ? address : null} />
              <OverviewRow label={t('form.notes')} value={customer.notes} />
            </CardContent>
          </Card>

          <ContactsCard customerId={customer.id} canManage={canManage} />

          <Card>
            <CardHeader>
              <CardTitle>{t('attachments')}</CardTitle>
            </CardHeader>
            <CardContent>
              <AttachmentsSection kind="customer" entityId={customer.id} canManage={canManage} />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{t('comments')}</CardTitle>
            </CardHeader>
            <CardContent>
              <CommentsSection kind="customer" entityId={customer.id} canManage={canManage} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('activity')}</CardTitle>
            </CardHeader>
            <CardContent>
              <ActivityTimeline
                queryKey={['customer-activity', customer.id]}
                queryFn={() => api.customers.activity(customer.id)}
              />
            </CardContent>
          </Card>
        </div>
      </div>

      <CustomerFormDialog open={editOpen} onOpenChange={setEditOpen} customer={customer} />

      <ConfirmDialog
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        title={t('archiveTitle')}
        description={t('archiveDescription', { name: customer.name })}
        confirmLabel={t('archive')}
        cancelLabel={tCommon('cancel')}
        destructive
        pending={archiveMutation.isPending}
        onConfirm={() => archiveMutation.mutate()}
      />
    </div>
  );
}

export default function CustomerDetailPage() {
  const params = useParams<{ id: string }>();
  const customerId = params.id;
  const errorMessage = useApiErrorMessage();

  const customerQuery = useQuery({
    queryKey: ['customer', customerId],
    queryFn: () => api.customers.get(customerId),
    enabled: Boolean(customerId),
  });

  if (customerQuery.isPending) {
    return (
      <div className="mx-auto max-w-6xl space-y-6">
        <ListSkeleton rows={6} />
      </div>
    );
  }
  if (customerQuery.isError) {
    return (
      <div className="mx-auto max-w-6xl">
        <ErrorState
          message={errorMessage(customerQuery.error)}
          onRetry={() => void customerQuery.refetch()}
        />
      </div>
    );
  }

  return <CustomerDetail customer={customerQuery.data} />;
}
