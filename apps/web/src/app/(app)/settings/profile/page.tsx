'use client';

import {
  changePasswordBodySchema,
  LOCALES,
  updateProfileBodySchema,
  type ChangePasswordBody,
  type Locale,
  type UpdateProfileBody,
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
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { ErrorState } from '@/components/data-states';
import { TextField } from '@/components/form-field';
import { api } from '@/lib/api';
import { useApiErrorMessage } from '@/lib/errors';
import { setLocaleCookie } from '@/lib/locale-cookie';
import { SESSION_QUERY_KEY, useSession } from '@/lib/session';

function ProfileForm({ defaults }: { defaults: Required<UpdateProfileBody> }) {
  const t = useTranslations('settings.profile');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const queryClient = useQueryClient();
  const errorMessage = useApiErrorMessage();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<UpdateProfileBody>({
    resolver: zodResolver(updateProfileBodySchema),
    defaultValues: defaults,
  });

  const updateMutation = useMutation({
    mutationFn: (body: UpdateProfileBody) => api.me.updateProfile(body),
    onSuccess: async (user) => {
      // Keep the next-intl cookie in sync so the UI language follows the profile.
      setLocaleCookie(user.locale as Locale);
      toast.success(t('success'));
      await queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
      router.refresh();
    },
    onError: (error) => setFormError(errorMessage(error)),
  });

  const onSubmit = handleSubmit((values) => {
    setFormError(null);
    updateMutation.mutate(values);
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
            id="profile-name"
            autoComplete="name"
            label={tCommon('name')}
            error={errors.name?.message}
            {...register('name')}
          />
          <div className="space-y-2">
            <Label htmlFor="profile-locale">{tCommon('locale')}</Label>
            <Controller
              control={control}
              name="locale"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="profile-locale" aria-label={tCommon('locale')}>
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
        </CardContent>
        <CardFooter>
          <Button type="submit" loading={updateMutation.isPending}>
            {tCommon('save')}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

function PasswordForm() {
  const t = useTranslations('settings.password');
  const errorMessage = useApiErrorMessage();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ChangePasswordBody>({
    resolver: zodResolver(changePasswordBodySchema),
    defaultValues: { currentPassword: '', newPassword: '' },
  });

  const passwordMutation = useMutation({
    mutationFn: (body: ChangePasswordBody) => api.me.changePassword(body),
    onSuccess: () => {
      toast.success(t('success'));
      reset();
    },
    onError: (error) => setFormError(errorMessage(error)),
  });

  const onSubmit = handleSubmit((values) => {
    setFormError(null);
    passwordMutation.mutate(values);
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
            id="current-password"
            type="password"
            autoComplete="current-password"
            label={t('current')}
            error={errors.currentPassword?.message}
            {...register('currentPassword')}
          />
          <TextField
            id="new-password"
            type="password"
            autoComplete="new-password"
            label={t('new')}
            error={errors.newPassword?.message}
            {...register('newPassword')}
          />
        </CardContent>
        <CardFooter>
          <Button type="submit" loading={passwordMutation.isPending}>
            {t('submit')}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

export default function ProfileSettingsPage() {
  const t = useTranslations('settings.profile');
  const { data: session } = useSession();

  if (!session) return null;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
      <ProfileForm
        key={session.user.id}
        defaults={{ name: session.user.name, locale: session.user.locale }}
      />
      <PasswordForm />
    </div>
  );
}
