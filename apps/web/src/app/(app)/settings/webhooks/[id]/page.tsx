'use client';

import type {
  WebhookDeliveryStatusDto,
  WebhookEndpointDto,
  WebhookEndpointWithSecretDto,
} from '@businessos/types';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '@businessos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, KeyRound, Pencil, Send, Trash2 } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { EmptyState, ErrorState, ListSkeleton } from '@/components/data-states';
import { Pagination } from '@/components/pagination';
import { WebhookFormDialog } from '@/components/phase9/webhook-form-dialog';
import { WebhookSecretDialog } from '@/components/phase9/webhook-secret-dialog';
import { DeliveryStatusBadge, EventChips } from '@/components/phase9/webhook-utils';
import { api } from '@/lib/api';
import { useApiErrorMessage } from '@/lib/errors';
import { can, useSession } from '@/lib/session';

const PAGE_SIZE = 25;
const ALL = 'ALL';
const STATUSES: WebhookDeliveryStatusDto[] = ['PENDING', 'SUCCEEDED', 'FAILED'];

function DeliveriesCard({
  endpointId,
  canManage,
}: {
  endpointId: string;
  canManage: boolean;
}) {
  const t = useTranslations('integrations.deliveries');
  const format = useFormatter();
  const errorMessage = useApiErrorMessage();
  const queryClient = useQueryClient();

  const [status, setStatus] = useState<WebhookDeliveryStatusDto | typeof ALL>(ALL);
  const [page, setPage] = useState(1);

  const deliveriesQuery = useQuery({
    queryKey: ['webhook-deliveries', endpointId, { status, page }],
    queryFn: () =>
      api.webhooks.listDeliveries(endpointId, {
        status: status === ALL ? undefined : status,
        page,
        pageSize: PAGE_SIZE,
      }),
  });

  const redeliverMutation = useMutation({
    mutationFn: (deliveryId: string) => api.webhooks.redeliver(endpointId, deliveryId),
    onSuccess: async () => {
      toast.success(t('redelivered'));
      await queryClient.invalidateQueries({ queryKey: ['webhook-deliveries', endpointId] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <Select
          value={status}
          onValueChange={(value) => {
            setStatus(value as WebhookDeliveryStatusDto | typeof ALL);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-full sm:w-56" aria-label={t('filterStatus')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('allStatuses')}</SelectItem>
            {STATUSES.map((value) => (
              <SelectItem key={value} value={value}>
                {value}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {deliveriesQuery.isPending ? (
          <ListSkeleton rows={5} />
        ) : deliveriesQuery.isError ? (
          <ErrorState
            message={errorMessage(deliveriesQuery.error)}
            onRetry={() => void deliveriesQuery.refetch()}
          />
        ) : deliveriesQuery.data.items.length === 0 ? (
          <EmptyState title={t('empty')} description={t('emptyDescription')} />
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table>
                <THead>
                  <TR>
                    <TH>{t('columnEvent')}</TH>
                    <TH>{t('columnStatus')}</TH>
                    <TH className="text-right">{t('columnAttempts')}</TH>
                    <TH>{t('columnResponse')}</TH>
                    <TH>{t('columnTime')}</TH>
                    {canManage ? (
                      <TH>
                        <span className="sr-only">{t('columnActions')}</span>
                      </TH>
                    ) : null}
                  </TR>
                </THead>
                <TBody>
                  {deliveriesQuery.data.items.map((delivery) => {
                    const canRedeliver =
                      canManage &&
                      (delivery.status === 'FAILED' || delivery.status === 'PENDING');
                    const attemptTime = delivery.deliveredAt ?? delivery.updatedAt;
                    return (
                      <TR key={delivery.id}>
                        <TD className="font-mono text-xs">{delivery.eventType}</TD>
                        <TD>
                          <DeliveryStatusBadge status={delivery.status} />
                        </TD>
                        <TD className="text-right tabular-nums">{delivery.attempts}</TD>
                        <TD className="max-w-xs">
                          {delivery.responseStatus !== null ? (
                            <span className="tabular-nums">{delivery.responseStatus}</span>
                          ) : delivery.error !== null ? (
                            <span className="block truncate text-destructive" title={delivery.error}>
                              {delivery.error}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">{t('none')}</span>
                          )}
                        </TD>
                        <TD className="text-muted-foreground">
                          {format.dateTime(new Date(attemptTime), {
                            dateStyle: 'medium',
                            timeStyle: 'short',
                          })}
                          {delivery.status === 'PENDING' && delivery.nextAttemptAt !== null ? (
                            <span className="block text-xs">
                              {t('nextAttempt', {
                                time: format.dateTime(new Date(delivery.nextAttemptAt), {
                                  timeStyle: 'short',
                                }),
                              })}
                            </span>
                          ) : null}
                        </TD>
                        {canManage ? (
                          <TD className="text-right">
                            {canRedeliver ? (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                loading={
                                  redeliverMutation.isPending &&
                                  redeliverMutation.variables === delivery.id
                                }
                                onClick={() => redeliverMutation.mutate(delivery.id)}
                              >
                                {t('redeliver')}
                              </Button>
                            ) : null}
                          </TD>
                        ) : null}
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            </div>
            <Pagination
              page={deliveriesQuery.data.page}
              totalPages={deliveriesQuery.data.totalPages}
              onPageChange={setPage}
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}

function WebhookDetail({ endpoint }: { endpoint: WebhookEndpointDto }) {
  const t = useTranslations('integrations');
  const tDetail = useTranslations('integrations.detail');
  const tActions = useTranslations('integrations.actions');
  const tPing = useTranslations('integrations.ping');
  const tRotate = useTranslations('integrations.rotate');
  const tDelete = useTranslations('integrations.delete');
  const tCommon = useTranslations('common');
  const format = useFormatter();
  const router = useRouter();
  const queryClient = useQueryClient();
  const errorMessage = useApiErrorMessage();
  const { data: session } = useSession();
  const canManage = can(session, 'integrations.manage');

  const [editOpen, setEditOpen] = useState(false);
  const [rotateOpen, setRotateOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [rotatedSecret, setRotatedSecret] = useState<WebhookEndpointWithSecretDto | null>(null);

  const pingMutation = useMutation({
    mutationFn: () => api.webhooks.ping(endpoint.id),
    onSuccess: (result) => {
      if (result.delivered) {
        toast.success(tPing('delivered', { status: result.responseStatus ?? 0 }));
      } else if (result.responseStatus !== null) {
        toast.error(tPing('failedStatus', { status: result.responseStatus }));
      } else if (result.error !== null) {
        toast.error(tPing('failedError', { error: result.error }));
      } else {
        toast.error(tPing('failed'));
      }
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const rotateMutation = useMutation({
    mutationFn: () => api.webhooks.rotateSecret(endpoint.id),
    onSuccess: async (dto) => {
      await queryClient.invalidateQueries({ queryKey: ['webhook', endpoint.id] });
      await queryClient.invalidateQueries({ queryKey: ['webhooks'] });
      setRotateOpen(false);
      setRotatedSecret(dto);
    },
    onError: (error) => {
      toast.error(errorMessage(error));
      setRotateOpen(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.webhooks.remove(endpoint.id),
    onSuccess: async () => {
      toast.success(tDelete('deleted'));
      await queryClient.invalidateQueries({ queryKey: ['webhooks'] });
      router.push('/settings/webhooks');
    },
    onError: (error) => {
      toast.error(errorMessage(error));
      setDeleteOpen(false);
    },
  });

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2 text-muted-foreground">
          <Link href="/settings/webhooks">
            <ArrowLeft aria-hidden="true" />
            {tDetail('back')}
          </Link>
        </Button>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <h1 className="min-w-0 break-all text-2xl font-semibold tracking-tight">
            {endpoint.url}
          </h1>
          {canManage ? (
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setEditOpen(true)}>
                <Pencil aria-hidden="true" />
                {tActions('edit')}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                loading={pingMutation.isPending}
                onClick={() => pingMutation.mutate()}
              >
                <Send aria-hidden="true" />
                {tActions('ping')}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setRotateOpen(true)}
              >
                <KeyRound aria-hidden="true" />
                {tActions('rotate')}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2 aria-hidden="true" />
                {tActions('delete')}
              </Button>
            </div>
          ) : null}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{tDetail('configuration')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <dt className="text-sm text-muted-foreground">{tDetail('url')}</dt>
              <dd className="break-all font-mono text-sm">{endpoint.url}</dd>
            </div>
            <div className="space-y-1">
              <dt className="text-sm text-muted-foreground">{tDetail('secret')}</dt>
              <dd className="font-mono text-sm">…{endpoint.secretHint}</dd>
            </div>
            <div className="space-y-1">
              <dt className="text-sm text-muted-foreground">{tDetail('description')}</dt>
              <dd className="text-sm">{endpoint.description ?? tDetail('noDescription')}</dd>
            </div>
            <div className="space-y-1">
              <dt className="text-sm text-muted-foreground">{t('list.columnEnabled')}</dt>
              <dd className="text-sm">
                {endpoint.enabled ? t('enabledOn') : t('enabledOff')}
              </dd>
            </div>
            <div className="space-y-1">
              <dt className="text-sm text-muted-foreground">{tDetail('created')}</dt>
              <dd className="text-sm">
                {format.dateTime(new Date(endpoint.createdAt), {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })}
              </dd>
            </div>
            <div className="space-y-1">
              <dt className="text-sm text-muted-foreground">{tDetail('updated')}</dt>
              <dd className="text-sm">
                {format.dateTime(new Date(endpoint.updatedAt), {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })}
              </dd>
            </div>
          </dl>
          <div className="space-y-1.5">
            <dt className="text-sm text-muted-foreground">{tDetail('events')}</dt>
            <dd>
              <EventChips eventTypes={endpoint.eventTypes} />
            </dd>
          </div>
        </CardContent>
      </Card>

      <Alert>
        <AlertTitle>{tDetail('signingTitle')}</AlertTitle>
        <AlertDescription>{tDetail('signingBody')}</AlertDescription>
      </Alert>

      <DeliveriesCard endpointId={endpoint.id} canManage={canManage} />

      <WebhookFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        mode="edit"
        endpoint={endpoint}
      />
      <ConfirmDialog
        open={rotateOpen}
        onOpenChange={setRotateOpen}
        title={tRotate('title')}
        description={tRotate('description')}
        confirmLabel={tRotate('confirm')}
        cancelLabel={tCommon('cancel')}
        destructive
        pending={rotateMutation.isPending}
        onConfirm={() => rotateMutation.mutate()}
      />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={tDelete('title')}
        description={tDelete('description')}
        confirmLabel={tActions('delete')}
        cancelLabel={tCommon('cancel')}
        destructive
        pending={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate()}
      />
      <WebhookSecretDialog
        open={rotatedSecret !== null}
        onOpenChange={(open) => (open ? undefined : setRotatedSecret(null))}
        secret={rotatedSecret?.secret ?? null}
        context="rotated"
      />
    </div>
  );
}

export default function WebhookDetailPage() {
  const params = useParams<{ id: string }>();
  const endpointId = params.id;
  const t = useTranslations('integrations');
  const errorMessage = useApiErrorMessage();
  const { data: session } = useSession();
  const canRead = can(session, 'integrations.read');

  const endpointQuery = useQuery({
    queryKey: ['webhook', endpointId],
    queryFn: () => api.webhooks.get(endpointId),
    enabled: canRead && Boolean(endpointId),
  });

  if (!canRead) {
    return (
      <div className="mx-auto max-w-4xl">
        <Alert>
          <AlertTitle>{t('title')}</AlertTitle>
          <AlertDescription>{t('restricted')}</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (endpointQuery.isPending) {
    return (
      <div className="mx-auto max-w-4xl space-y-6">
        <ListSkeleton rows={6} />
      </div>
    );
  }
  if (endpointQuery.isError) {
    return (
      <div className="mx-auto max-w-4xl">
        <ErrorState
          message={errorMessage(endpointQuery.error)}
          onRetry={() => void endpointQuery.refetch()}
        />
      </div>
    );
  }

  return <WebhookDetail endpoint={endpointQuery.data} />;
}
