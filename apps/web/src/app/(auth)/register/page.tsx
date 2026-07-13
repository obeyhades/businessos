'use client';

import { registerBodySchema, type RegisterBody } from '@businessos/types';
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
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useForm } from 'react-hook-form';
import { ErrorState, PageSpinner } from '@/components/data-states';
import { TextField } from '@/components/form-field';
import { api } from '@/lib/api';
import { safeNextPath, useRedirectIfAuthenticated } from '@/lib/auth-redirect';
import { useApiErrorMessage } from '@/lib/errors';
import { SESSION_QUERY_KEY } from '@/lib/session';

function RegisterForm() {
  const t = useTranslations('auth.register');
  const tCommon = useTranslations('common');
  const locale = useLocale();
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
  } = useForm<RegisterBody>({
    resolver: zodResolver(registerBodySchema),
    defaultValues: {
      name: '',
      email: '',
      password: '',
      locale: locale === 'sv' ? 'sv' : 'en',
    },
  });

  const registerMutation = useMutation({
    mutationFn: (body: RegisterBody) => api.auth.register(body),
    onSuccess: (session) => {
      queryClient.setQueryData(SESSION_QUERY_KEY, session);
      // A fresh account has no organization yet unless it follows an invite.
      router.replace(next ?? '/onboarding');
    },
    onError: (error) => setFormError(errorMessage(error)),
  });

  const onSubmit = handleSubmit((values) => {
    setFormError(null);
    registerMutation.mutate(values);
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
            id="name"
            autoComplete="name"
            label={tCommon('name')}
            error={errors.name?.message}
            {...register('name')}
          />
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
            autoComplete="new-password"
            label={tCommon('password')}
            error={errors.password?.message}
            {...register('password')}
          />
        </CardContent>
        <CardFooter className="flex-col gap-4">
          <Button type="submit" className="w-full" loading={registerMutation.isPending}>
            {t('submit')}
          </Button>
          <p className="text-sm text-muted-foreground">
            {t('haveAccount')}{' '}
            <Link
              href={next ? `/login?next=${encodeURIComponent(next)}` : '/login'}
              className="text-primary hover:underline"
            >
              {t('loginLink')}
            </Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  );
}

export default function RegisterPage() {
  return (
    <Suspense fallback={<PageSpinner />}>
      <RegisterForm />
    </Suspense>
  );
}
