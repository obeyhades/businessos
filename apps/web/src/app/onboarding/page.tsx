'use client';

import {
  createOrganizationBodySchema,
  LOCALES,
  type CreateOrganizationBody,
} from '@businessos/types';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@businessos/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { AuthGuard } from '@/components/auth-guard';
import { ErrorState } from '@/components/data-states';
import { TextField } from '@/components/form-field';
import { api } from '@/lib/api';
import { useApiErrorMessage } from '@/lib/errors';
import { SESSION_QUERY_KEY } from '@/lib/session';

function OnboardingForm() {
  const t = useTranslations('onboarding');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const router = useRouter();
  const queryClient = useQueryClient();
  const errorMessage = useApiErrorMessage();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<CreateOrganizationBody>({
    resolver: zodResolver(createOrganizationBodySchema),
    defaultValues: {
      name: '',
      locale: locale === 'sv' ? 'sv' : 'en',
      currency: 'SEK',
    },
  });

  const createMutation = useMutation({
    mutationFn: (body: CreateOrganizationBody) => api.organizations.create(body),
    onSuccess: async () => {
      toast.success(t('success'));
      await queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
      router.replace('/dashboard');
    },
    onError: (error) => setFormError(errorMessage(error)),
  });

  const onSubmit = handleSubmit((values) => {
    setFormError(null);
    createMutation.mutate(values);
  });

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-muted/40 p-4">
      <div className="mb-6 text-2xl font-semibold tracking-tight">{tCommon('appName')}</div>
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </CardHeader>
        <form onSubmit={(event) => void onSubmit(event)} noValidate>
          <CardContent className="space-y-4">
            {formError ? <ErrorState message={formError} /> : null}
            <TextField
              id="name"
              label={t('organizationName')}
              error={errors.name?.message}
              {...register('name')}
            />
            <div className="space-y-2">
              <Label htmlFor="locale-select">{tCommon('locale')}</Label>
              <Controller
                control={control}
                name="locale"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="locale-select" aria-label={tCommon('locale')}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {LOCALES.map((value) => (
                        <SelectItem key={value} value={value}>
                          {value === 'sv' ? tCommon('languageSv') : tCommon('languageEn')}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
            <TextField
              id="currency"
              label={tCommon('currency')}
              error={errors.currency?.message}
              {...register('currency')}
            />
          </CardContent>
          <CardFooter>
            <Button type="submit" className="w-full" loading={createMutation.isPending}>
              {t('submit')}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}

export default function OnboardingPage() {
  // requireOrg=false: this page is exactly where org-less sessions must land,
  // and users with an org can still create another one from the org switcher.
  return (
    <AuthGuard requireOrg={false}>
      <OnboardingForm />
    </AuthGuard>
  );
}
