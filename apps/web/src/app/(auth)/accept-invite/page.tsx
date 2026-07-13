'use client';

import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Skeleton,
} from '@businessos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { toast } from 'sonner';
import { ErrorState, PageSpinner } from '@/components/data-states';
import { api, ApiError } from '@/lib/api';
import { useApiErrorMessage } from '@/lib/errors';
import { SESSION_QUERY_KEY, useSession } from '@/lib/session';

function AcceptInviteContent() {
  const t = useTranslations('auth.acceptInvite');
  const tRoles = useTranslations('roles');
  const format = useFormatter();
  const router = useRouter();
  const queryClient = useQueryClient();
  const errorMessage = useApiErrorMessage();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const [acceptError, setAcceptError] = useState<string | null>(null);

  const { data: session, isPending: sessionPending } = useSession();

  const previewQuery = useQuery({
    queryKey: ['invitation-preview', token],
    queryFn: () => api.invitations.preview(token),
    enabled: token.length > 0,
    retry: (failureCount, error) =>
      !(error instanceof ApiError && error.status === 404) && failureCount < 2,
  });

  const acceptMutation = useMutation({
    mutationFn: () => api.invitations.accept(token),
    onSuccess: (nextSession) => {
      queryClient.setQueryData(SESSION_QUERY_KEY, nextSession);
      void queryClient.invalidateQueries();
      toast.success(t('accepted', { organization: previewQuery.data?.organizationName ?? '' }));
      router.replace('/dashboard');
    },
    onError: (error) => setAcceptError(errorMessage(error)),
  });

  if (!token) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('invalidTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertDescription>{t('missingToken')}</AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  if (previewQuery.isPending || sessionPending) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-5 w-3/4" />
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-9 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (previewQuery.isError) {
    const notFound = previewQuery.error instanceof ApiError && previewQuery.error.status === 404;
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('invalidTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          {notFound ? (
            <Alert variant="destructive">
              <AlertDescription>{t('invalidDescription')}</AlertDescription>
            </Alert>
          ) : (
            <ErrorState
              message={errorMessage(previewQuery.error)}
              onRetry={() => void previewQuery.refetch()}
            />
          )}
        </CardContent>
      </Card>
    );
  }

  const preview = previewQuery.data;
  const selfPath = `/accept-invite?token=${encodeURIComponent(token)}`;
  const currentUser = session?.user ?? null;
  const emailMismatch = currentUser !== null && currentUser.email !== preview.email;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>
          {t('expiresAt', {
            date: format.dateTime(new Date(preview.expiresAt), { dateStyle: 'medium' }),
          })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm">
          {t.rich('invitedTo', {
            strong: (chunks) => <strong>{chunks}</strong>,
            organization: preview.organizationName,
            role: tRoles(preview.role),
          })}
        </p>
        <div>
          <Badge variant="secondary">{preview.email}</Badge>
        </div>
        {acceptError ? <ErrorState message={acceptError} /> : null}
        {currentUser === null ? (
          <Alert>
            <AlertDescription>{t('needAccount', { email: preview.email })}</AlertDescription>
          </Alert>
        ) : emailMismatch ? (
          <Alert variant="destructive">
            <AlertTitle>{t('invalidTitle')}</AlertTitle>
            <AlertDescription>
              {t('emailMismatch', { invited: preview.email, current: currentUser.email })}
            </AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
      <CardFooter className="flex-col gap-3">
        {currentUser === null ? (
          <>
            <Button asChild className="w-full">
              <Link href={`/login?next=${encodeURIComponent(selfPath)}`}>{t('loginCta')}</Link>
            </Button>
            <Button asChild variant="outline" className="w-full">
              <Link href={`/register?next=${encodeURIComponent(selfPath)}`}>
                {t('registerCta')}
              </Link>
            </Button>
          </>
        ) : (
          <Button
            type="button"
            className="w-full"
            disabled={emailMismatch}
            loading={acceptMutation.isPending}
            onClick={() => {
              setAcceptError(null);
              acceptMutation.mutate();
            }}
          >
            {t('accept')}
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}

export default function AcceptInvitePage() {
  return (
    <Suspense fallback={<PageSpinner />}>
      <AcceptInviteContent />
    </Suspense>
  );
}
