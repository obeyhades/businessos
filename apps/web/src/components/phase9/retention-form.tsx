'use client';

import type { RetentionPolicyDto } from '@businessos/types';
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
  Input,
  Label,
} from '@businessos/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { ErrorState } from '@/components/data-states';
import { api } from '@/lib/api';
import { useApiErrorMessage } from '@/lib/errors';

type FieldKey = 'recordingsDays' | 'auditLogsDays' | 'activitiesDays' | 'webhookDeliveriesDays';

const FIELDS: { key: FieldKey; labelKey: string; helpKey: string }[] = [
  { key: 'recordingsDays', labelKey: 'recordings', helpKey: 'recordingsHelp' },
  { key: 'auditLogsDays', labelKey: 'auditLogs', helpKey: 'auditLogsHelp' },
  { key: 'activitiesDays', labelKey: 'activities', helpKey: 'activitiesHelp' },
  { key: 'webhookDeliveriesDays', labelKey: 'webhookDeliveries', helpKey: 'webhookDeliveriesHelp' },
];

function toInput(value: number | null): string {
  return value === null ? '' : String(value);
}

export function RetentionForm({
  policy,
  readOnly,
}: {
  policy: RetentionPolicyDto;
  readOnly: boolean;
}) {
  const t = useTranslations('compliance.retention');
  const format = useFormatter();
  const queryClient = useQueryClient();
  const errorMessage = useApiErrorMessage();

  const [values, setValues] = useState<Record<FieldKey, string>>({
    recordingsDays: toInput(policy.recordingsDays),
    auditLogsDays: toInput(policy.auditLogsDays),
    activitiesDays: toInput(policy.activitiesDays),
    webhookDeliveriesDays: toInput(policy.webhookDeliveriesDays),
  });
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const updateMutation = useMutation({
    mutationFn: (body: Record<FieldKey, number | null>) => api.compliance.updateRetention(body),
    onSuccess: async (updated) => {
      queryClient.setQueryData(['retention-policy'], updated);
      toast.success(t('saved'));
    },
    onError: (error) => setFormError(errorMessage(error)),
  });

  function onSubmit(event: React.FormEvent): void {
    event.preventDefault();
    setFormError(null);
    const nextErrors: Partial<Record<FieldKey, string>> = {};
    const body = {} as Record<FieldKey, number | null>;
    for (const { key } of FIELDS) {
      const raw = values[key].trim();
      if (raw === '') {
        body[key] = null;
        continue;
      }
      const parsed = Number(raw);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 3650) {
        nextErrors[key] = t('invalid');
        continue;
      }
      body[key] = parsed;
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    updateMutation.mutate(body);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <form onSubmit={onSubmit} noValidate>
        <CardContent className="space-y-5">
          {readOnly ? (
            <Alert>
              <AlertDescription>{t('readOnly')}</AlertDescription>
            </Alert>
          ) : null}
          {formError ? <ErrorState message={formError} /> : null}
          {FIELDS.map(({ key, labelKey, helpKey }) => {
            const errorId = `${key}-error`;
            return (
              <div key={key} className="space-y-1.5">
                <Label htmlFor={key}>{t(labelKey)}</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id={key}
                    type="number"
                    min={1}
                    max={3650}
                    inputMode="numeric"
                    className="w-36"
                    placeholder={t('forever')}
                    disabled={readOnly}
                    aria-invalid={errors[key] ? true : undefined}
                    aria-describedby={errors[key] ? errorId : undefined}
                    value={values[key]}
                    onChange={(event) =>
                      setValues((prev) => ({ ...prev, [key]: event.target.value }))
                    }
                  />
                  <span className="text-sm text-muted-foreground">{t('daysUnit')}</span>
                </div>
                <p className="text-sm text-muted-foreground">{t(helpKey)}</p>
                {errors[key] ? (
                  <p id={errorId} role="alert" className="text-sm text-destructive">
                    {errors[key]}
                  </p>
                ) : null}
              </div>
            );
          })}
          <p className="text-xs text-muted-foreground">
            {policy.updatedAt !== null
              ? t('updatedAt', {
                  time: format.dateTime(new Date(policy.updatedAt), {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  }),
                })
              : t('neverUpdated')}
          </p>
        </CardContent>
        {!readOnly ? (
          <CardFooter>
            <Button type="submit" loading={updateMutation.isPending}>
              {t('save')}
            </Button>
          </CardFooter>
        ) : null}
      </form>
    </Card>
  );
}
