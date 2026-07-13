'use client';

import { resetPasswordBodySchema, type ResetPasswordBody } from '@businessos/types';
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@businessos/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useForm } from 'react-hook-form';
import { ErrorState, PageSpinner } from '@/components/data-states';
import { TextField } from '@/components/form-field';
import { api } from '@/lib/api';
import { useRedirectIfAuthenticated } from '@/lib/auth-redirect';
import { useApiErrorMessage } from '@/lib/errors';

function ResetPasswordForm() {
  const t = useTranslations('auth.resetPassword');
  const errorMessage = useApiErrorMessage();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useRedirectIfAuthenticated();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ResetPasswordBody>({
    resolver: zodResolver(resetPasswordBodySchema),
    defaultValues: { token, password: '' },
  });

  const resetMutation = useMutation({
    mutationFn: (body: ResetPasswordBody) => api.auth.resetPassword(body),
    onSuccess: () => setDone(true),
    onError: (error) => setFormError(errorMessage(error)),
  });

  const onSubmit = handleSubmit((values) => {
    setFormError(null);
    resetMutation.mutate(values);
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      {done ? (
        <CardContent className="space-y-4">
          <Alert>
            <AlertDescription>{t('success')}</AlertDescription>
          </Alert>
          <Link href="/login" className="inline-block text-sm text-primary hover:underline">
            {t('goToLogin')}
          </Link>
        </CardContent>
      ) : !token ? (
        <CardContent className="space-y-4">
          <Alert variant="destructive">
            <AlertDescription>{t('missingToken')}</AlertDescription>
          </Alert>
          <Link
            href="/forgot-password"
            className="inline-block text-sm text-primary hover:underline"
          >
            {t('goToLogin')}
          </Link>
        </CardContent>
      ) : (
        <form onSubmit={(event) => void onSubmit(event)} noValidate>
          <CardContent className="space-y-4">
            {formError ? <ErrorState message={formError} /> : null}
            <TextField
              id="password"
              type="password"
              autoComplete="new-password"
              label={t('newPassword')}
              error={errors.password?.message ?? errors.token?.message}
              {...register('password')}
            />
          </CardContent>
          <CardFooter>
            <Button type="submit" className="w-full" loading={resetMutation.isPending}>
              {t('submit')}
            </Button>
          </CardFooter>
        </form>
      )}
    </Card>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<PageSpinner />}>
      <ResetPasswordForm />
    </Suspense>
  );
}
