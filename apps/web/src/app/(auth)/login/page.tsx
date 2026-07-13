'use client';

import { loginBodySchema, type LoginBody } from '@businessos/types';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@businessos/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useForm } from 'react-hook-form';
import { ErrorState, PageSpinner } from '@/components/data-states';
import { TextField } from '@/components/form-field';
import { api } from '@/lib/api';
import { safeNextPath, useRedirectIfAuthenticated } from '@/lib/auth-redirect';
import { useApiErrorMessage } from '@/lib/errors';
import { activeMembership, SESSION_QUERY_KEY } from '@/lib/session';

function LoginForm() {
  const t = useTranslations('auth.login');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const queryClient = useQueryClient();
  const errorMessage = useApiErrorMessage();
  const searchParams = useSearchParams();
  const next = safeNextPath(searchParams.get('next'));
  const [formError, setFormError] = useState<string | null>(null);

  useRedirectIfAuthenticated(next);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginBody>({
    resolver: zodResolver(loginBodySchema),
    defaultValues: { email: '', password: '' },
  });

  const loginMutation = useMutation({
    mutationFn: (body: LoginBody) => api.auth.login(body),
    onSuccess: (session) => {
      queryClient.setQueryData(SESSION_QUERY_KEY, session);
      router.replace(next ?? (activeMembership(session) ? '/dashboard' : '/onboarding'));
    },
    onError: (error) => setFormError(errorMessage(error)),
  });

  const onSubmit = handleSubmit((values) => {
    setFormError(null);
    loginMutation.mutate(values);
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <form onSubmit={(event) => void onSubmit(event)} noValidate>
        <CardContent className="space-y-4">
          {formError ? <ErrorState message={formError} /> : null}
          <TextField
            id="email"
            type="email"
            autoComplete="email"
            label={tCommon('email')}
            error={errors.email?.message}
            {...register('email')}
          />
          <TextField
            id="password"
            type="password"
            autoComplete="current-password"
            label={tCommon('password')}
            error={errors.password?.message}
            {...register('password')}
          />
          <div className="text-right">
            <Link href="/forgot-password" className="text-sm text-primary hover:underline">
              {t('forgotLink')}
            </Link>
          </div>
        </CardContent>
        <CardFooter className="flex-col gap-4">
          <Button type="submit" className="w-full" loading={loginMutation.isPending}>
            {t('submit')}
          </Button>
          <p className="text-sm text-muted-foreground">
            {t('noAccount')}{' '}
            <Link
              href={next ? `/register?next=${encodeURIComponent(next)}` : '/register'}
              className="text-primary hover:underline"
            >
              {t('registerLink')}
            </Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<PageSpinner />}>
      <LoginForm />
    </Suspense>
  );
}
