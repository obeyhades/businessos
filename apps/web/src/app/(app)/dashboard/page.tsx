'use client';

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Separator,
} from '@businessos/ui';
import { useQuery } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import Link from 'next/link';
import { ErrorState, ListSkeleton } from '@/components/data-states';
import { api } from '@/lib/api';
import { useApiErrorMessage } from '@/lib/errors';
import { activeMembership, can, useSession } from '@/lib/session';

const COMING_SOON_MODULES = [
  'customers',
  'invoicing',
  'bookkeeping',
  'calendar',
  'email',
  'recordings',
] as const;

export default function DashboardPage() {
  const t = useTranslations('dashboard');
  const tCommon = useTranslations('common');
  const tRoles = useTranslations('roles');
  const tActions = useTranslations('auditActions');
  const format = useFormatter();
  const errorMessage = useApiErrorMessage();

  const { data: session } = useSession();
  const membership = activeMembership(session);
  const canReadMembers = can(session, 'members.read');
  const canInvite = can(session, 'members.invite');
  const canReadAudit = can(session, 'audit.read');

  const membersQuery = useQuery({
    queryKey: ['members', 'count'],
    queryFn: () => api.members.list({ page: 1, pageSize: 1 }),
    enabled: canReadMembers,
  });

  const invitationsQuery = useQuery({
    queryKey: ['invitations'],
    queryFn: () => api.invitations.list(),
    enabled: canInvite,
  });

  const auditQuery = useQuery({
    queryKey: ['audit-logs', 'recent'],
    queryFn: () => api.auditLogs.list({ page: 1, pageSize: 5 }),
    enabled: canReadAudit,
  });

  if (!membership) return null;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>{t('organization.title')}</CardTitle>
            <CardDescription>{membership.organization.name}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">{t('organization.yourRole')}</span>
              <Badge variant="secondary">{tRoles(membership.role)}</Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">{t('organization.language')}</span>
              <span>
                {membership.organization.locale === 'sv'
                  ? tCommon('languageSv')
                  : tCommon('languageEn')}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">{t('organization.currency')}</span>
              <span>{membership.organization.currency}</span>
            </div>
            {can(session, 'org.update') ? (
              <>
                <Separator />
                <Button asChild variant="outline" size="sm">
                  <Link href="/settings/organization">{t('organization.manage')}</Link>
                </Button>
              </>
            ) : null}
          </CardContent>
        </Card>

        {canReadMembers ? (
          <Card>
            <CardHeader>
              <CardTitle>{t('members.title')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {membersQuery.isPending ? (
                <ListSkeleton rows={2} />
              ) : membersQuery.isError ? (
                <ErrorState
                  message={errorMessage(membersQuery.error)}
                  onRetry={() => void membersQuery.refetch()}
                />
              ) : (
                <p className="text-3xl font-semibold">
                  {t('members.count', { count: membersQuery.data.totalItems })}
                </p>
              )}
              <Button asChild variant="outline" size="sm">
                <Link href="/members">{t('members.manage')}</Link>
              </Button>
            </CardContent>
          </Card>
        ) : null}

        {canInvite ? (
          <Card>
            <CardHeader>
              <CardTitle>{t('invitations.title')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {invitationsQuery.isPending ? (
                <ListSkeleton rows={3} />
              ) : invitationsQuery.isError ? (
                <ErrorState
                  message={errorMessage(invitationsQuery.error)}
                  onRetry={() => void invitationsQuery.refetch()}
                />
              ) : invitationsQuery.data.length === 0 ? (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">{t('invitations.empty')}</p>
                  <Button asChild variant="outline" size="sm">
                    <Link href="/members">{t('invitations.invite')}</Link>
                  </Button>
                </div>
              ) : (
                <>
                  <ul className="space-y-2 text-sm">
                    {invitationsQuery.data.slice(0, 5).map((invitation) => (
                      <li key={invitation.id} className="flex items-center justify-between gap-2">
                        <span className="truncate">{invitation.email}</span>
                        <Badge variant="outline">{tRoles(invitation.role)}</Badge>
                      </li>
                    ))}
                  </ul>
                  <Button asChild variant="outline" size="sm">
                    <Link href="/members">{t('invitations.viewAll')}</Link>
                  </Button>
                </>
              )}
            </CardContent>
          </Card>
        ) : null}

        {canReadAudit ? (
          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle>{t('audit.title')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {auditQuery.isPending ? (
                <ListSkeleton rows={5} />
              ) : auditQuery.isError ? (
                <ErrorState
                  message={errorMessage(auditQuery.error)}
                  onRetry={() => void auditQuery.refetch()}
                />
              ) : auditQuery.data.items.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('audit.empty')}</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {auditQuery.data.items.map((entry) => (
                    <li key={entry.id} className="flex items-center justify-between gap-2">
                      {/* next-intl forbids "." in keys; catalogs use "_" instead. */}
                      <span>{tActions(entry.action.replaceAll('.', '_'))}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {format.dateTime(new Date(entry.createdAt), {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        })}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <Button asChild variant="outline" size="sm">
                <Link href="/audit-log">{t('audit.viewAll')}</Link>
              </Button>
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>{t('comingSoon.title')}</CardTitle>
            <CardDescription>{t('comingSoon.description')}</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm text-muted-foreground">
              {COMING_SOON_MODULES.map((module) => (
                <li key={module} className="flex items-center gap-2">
                  <span className="size-1.5 rounded-full bg-border" aria-hidden="true" />
                  {t(`comingSoon.${module}`)}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
