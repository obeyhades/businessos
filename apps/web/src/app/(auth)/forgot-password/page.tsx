'use client';

import { forgotPasswordBodySchema, type ForgotPasswordBody } from '@businessos/types';
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
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { ErrorState } from '@/components/data-states';
import { TextField } from '@/components/form-field';
import { api } from '@/lib/api';
import { useRedirectIfAuthenticated } from '@/lib/auth-redirect';
import { useApiErrorMessage } from '@/lib/errors';

export default function ForgotPasswordPage() {
  const t = useTranslations('auth.forgotPassword');
  const tCommon = useTranslations('common');
  const errorMessage = useApiErrorMessage();
  const [formError, setFormError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  useRedirectIfAuthenticated();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ForgotPasswordBody>({
    resolver: zodResolver(forgotPasswordBodySchema),
    defaultValues: { email: '' },
  });

  const forgotMutation = useMutation({
    mutationFn: (body: ForgotPasswordBody) => api.auth.forgotPassword(body),
    // The endpoint never reveals whether the account exists; always show success.
    onSuccess: () => setSubmitted(true),
    onError: (error) => setFormError(errorMessage(error)),
  });

  const onSubmit = handleSubmit((values) => {
    setFormError(null);
    forgotMutation.mutate(values);
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      {submitted ? (
        <CardContent className="space-y-4">
          <Alert>
            <AlertDescription>{t('success')}</AlertDescription>
          </Alert>
          <Link href="/login" className="inline-block text-sm text-primary hover:underline">
            {t('backToLogin')}
          </Link>
        </CardContent>
      ) : (
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
          </CardContent>
          <CardFooter className="flex-col gap-4">
            <Button type="submit" className="w-full" loading={forgotMutation.isPending}>
              {t('submit')}
            </Button>
            <Link href="/login" className="text-sm text-primary hover:underline">
              {t('backToLogin')}
            </Link>
          </CardFooter>
        </form>
      )}
    </Card>
  );
}
