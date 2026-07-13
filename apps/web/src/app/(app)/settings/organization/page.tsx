'use client';

import {
  LOCALES,
  updateOrganizationBodySchema,
  type UpdateOrganizationBody,
} from '@businessos/types';
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
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@businessos/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { ErrorState, ListSkeleton } from '@/components/data-states';
import { TextField } from '@/components/form-field';
import { api } from '@/lib/api';
import { useApiErrorMessage } from '@/lib/errors';
import { can, useSession } from '@/lib/session';

function OrganizationForm({
  defaults,
  readOnly,
}: {
  defaults: Required<UpdateOrganizationBody>;
  readOnly: boolean;
}) {
  const t = useTranslations('settings.organization');
  const tCommon = useTranslations('common');
  const queryClient = useQueryClient();
  const errorMessage = useApiErrorMessage();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<UpdateOrganizationBody>({
    resolver: zodResolver(updateOrganizationBodySchema),
    defaultValues: defaults,
  });

  const updateMutation = useMutation({
    mutationFn: (body: UpdateOrganizationBody) => api.organizations.update(body),
    onSuccess: async () => {
      toast.success(t('success'));
      // The org name/locale also lives in the session's membership list.
      await queryClient.invalidateQueries();
    },
    onError: (error) => setFormError(errorMessage(error)),
  });

  const onSubmit = handleSubmit((values) => {
    setFormError(null);
    updateMutation.mutate(values);
  });

  return (
    <form onSubmit={(event) => void onSubmit(event)} noValidate>
      <CardContent className="space-y-4">
        {readOnly ? (
          <Alert>
            <AlertDescription>{t('readOnly')}</AlertDescription>
          </Alert>
        ) : null}
        {formError ? <ErrorState message={formError} /> : null}
        <TextField
          id="org-name"
          label={t('name')}
          disabled={readOnly}
          error={errors.name?.message}
          {...register('name')}
        />
        <div className="space-y-2">
          <Label htmlFor="org-locale">{tCommon('locale')}</Label>
          <Controller
            control={control}
            name="locale"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange} disabled={readOnly}>
                <SelectTrigger id="org-locale" aria-label={tCommon('locale')}>
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
          id="org-currency"
          label={tCommon('currency')}
          disabled={readOnly}
          error={errors.currency?.message}
          {...register('currency')}
        />
      </CardContent>
      {!readOnly ? (
        <CardFooter>
          <Button type="submit" loading={updateMutation.isPending}>
            {tCommon('save')}
          </Button>
        </CardFooter>
      ) : null}
    </form>
  );
}

export default function OrganizationSettingsPage() {
  const t = useTranslations('settings.organization');
  const errorMessage = useApiErrorMessage();
  const { data: session } = useSession();
  const readOnly = !can(session, 'org.update');

  const orgQuery = useQuery({
    queryKey: ['organization', 'current'],
    queryFn: () => api.organizations.current(),
  });

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
      <Card>
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </CardHeader>
        {orgQuery.isPending ? (
          <CardContent>
            <ListSkeleton rows={3} />
          </CardContent>
        ) : orgQuery.isError ? (
          <CardContent>
            <ErrorState
              message={errorMessage(orgQuery.error)}
              onRetry={() => void orgQuery.refetch()}
            />
          </CardContent>
        ) : (
          <OrganizationForm
            key={orgQuery.data.id}
            defaults={{
              name: orgQuery.data.name,
              locale: orgQuery.data.locale,
              currency: orgQuery.data.currency,
            }}
            readOnly={readOnly}
          />
        )}
      </Card>
    </div>
  );
}
