'use client';

import type { WebhookEndpointWithSecretDto } from '@businessos/types';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '@businessos/ui';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Plus } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState } from 'react';
import { EmptyState, ErrorState, ListSkeleton } from '@/components/data-states';
import { WebhookFormDialog } from '@/components/phase9/webhook-form-dialog';
import { WebhookSecretDialog } from '@/components/phase9/webhook-secret-dialog';
import { EnabledToggle, EventChips } from '@/components/phase9/webhook-utils';
import { api } from '@/lib/api';
import { useApiErrorMessage } from '@/lib/errors';
import { can, useSession } from '@/lib/session';

export default function WebhooksPage() {
  const t = useTranslations('integrations');
  const format = useFormatter();
  const errorMessage = useApiErrorMessage();
  const { data: session } = useSession();
  const canRead = can(session, 'integrations.read');
  const canManage = can(session, 'integrations.manage');

  const [createOpen, setCreateOpen] = useState(false);
  const [secret, setSecret] = useState<WebhookEndpointWithSecretDto | null>(null);

  const webhooksQuery = useQuery({
    queryKey: ['webhooks'],
    queryFn: () => api.webhooks.list(),
    enabled: canRead,
  });

  if (!canRead) {
    return (
      <div className="mx-auto max-w-5xl">
        <Alert>
          <AlertTitle>{t('title')}</AlertTitle>
          <AlertDescription>{t('restricted')}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        {canManage ? (
          <Button type="button" onClick={() => setCreateOpen(true)}>
            <Plus aria-hidden="true" />
            {t('add')}
          </Button>
        ) : null}
      </div>

      <Card>
        <CardContent className="pt-6">
          {webhooksQuery.isPending ? (
            <ListSkeleton rows={5} />
          ) : webhooksQuery.isError ? (
            <ErrorState
              message={errorMessage(webhooksQuery.error)}
              onRetry={() => void webhooksQuery.refetch()}
            />
          ) : webhooksQuery.data.length === 0 ? (
            <EmptyState
              title={t('list.empty')}
              description={t('list.emptyDescription')}
              action={
                canManage ? (
                  <Button type="button" onClick={() => setCreateOpen(true)}>
                    <Plus aria-hidden="true" />
                    {t('add')}
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>{t('list.columnUrl')}</TH>
                  <TH>{t('list.columnEvents')}</TH>
                  <TH>{t('list.columnEnabled')}</TH>
                  <TH>{t('list.columnSecret')}</TH>
                  <TH>{t('list.columnCreated')}</TH>
                  <TH>
                    <span className="sr-only">{t('actions.edit')}</span>
                  </TH>
                </TR>
              </THead>
              <TBody>
                {webhooksQuery.data.map((endpoint) => (
                  <TR key={endpoint.id}>
                    <TD className="max-w-xs">
                      <Link
                        href={`/settings/webhooks/${endpoint.id}`}
                        className="block truncate font-medium hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {endpoint.url}
                      </Link>
                      {endpoint.description ? (
                        <span className="block truncate text-sm text-muted-foreground">
                          {endpoint.description}
                        </span>
                      ) : null}
                    </TD>
                    <TD>
                      <EventChips eventTypes={endpoint.eventTypes} />
                    </TD>
                    <TD>
                      <EnabledToggle endpoint={endpoint} canManage={canManage} />
                    </TD>
                    <TD>
                      <code className="font-mono text-xs text-muted-foreground">
                        …{endpoint.secretHint}
                      </code>
                    </TD>
                    <TD className="text-muted-foreground">
                      {format.dateTime(new Date(endpoint.createdAt), { dateStyle: 'medium' })}
                    </TD>
                    <TD className="text-right">
                      <Button asChild variant="ghost" size="sm">
                        <Link
                          href={`/settings/webhooks/${endpoint.id}`}
                          aria-label={endpoint.url}
                        >
                          <ChevronRight aria-hidden="true" />
                        </Link>
                      </Button>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <WebhookFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        mode="create"
        onCreated={(created) => setSecret(created)}
      />
      <WebhookSecretDialog
        open={secret !== null}
        onOpenChange={(open) => (open ? undefined : setSecret(null))}
        secret={secret?.secret ?? null}
        context="created"
      />
    </div>
  );
}
