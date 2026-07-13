'use client';

import type { UpdateAccountMappingBody } from '@businessos/types';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Label,
} from '@businessos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Save } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ErrorState, ListSkeleton } from '@/components/data-states';
import { api } from '@/lib/api';
import { useApiErrorMessage } from '@/lib/errors';
import { AccountSelect, useAccountOptions } from './account-select';

type MappingKey = 'salesAccountId' | 'outputVatAccountId' | 'receivableAccountId' | 'bankAccountId';

const FIELDS: { key: MappingKey; labelKey: string }[] = [
  { key: 'salesAccountId', labelKey: 'mappingSales' },
  { key: 'outputVatAccountId', labelKey: 'mappingOutputVat' },
  { key: 'receivableAccountId', labelKey: 'mappingReceivable' },
  { key: 'bankAccountId', labelKey: 'mappingBank' },
];

export function MappingCard({ canManage }: { canManage: boolean }) {
  const t = useTranslations('accounting');
  const tCommon = useTranslations('common');
  const queryClient = useQueryClient();
  const errorMessage = useApiErrorMessage();

  const mappingQuery = useQuery({
    queryKey: ['accounting-mapping'],
    queryFn: () => api.accounting.getMapping(),
  });
  const accountsQuery = useAccountOptions();

  const [values, setValues] = useState<Record<MappingKey, string>>({
    salesAccountId: '',
    outputVatAccountId: '',
    receivableAccountId: '',
    bankAccountId: '',
  });

  useEffect(() => {
    if (mappingQuery.data) {
      setValues({
        salesAccountId: mappingQuery.data.salesAccountId ?? '',
        outputVatAccountId: mappingQuery.data.outputVatAccountId ?? '',
        receivableAccountId: mappingQuery.data.receivableAccountId ?? '',
        bankAccountId: mappingQuery.data.bankAccountId ?? '',
      });
    }
  }, [mappingQuery.data]);

  const saveMutation = useMutation({
    mutationFn: () => {
      const body: UpdateAccountMappingBody = {
        salesAccountId: values.salesAccountId === '' ? null : values.salesAccountId,
        outputVatAccountId: values.outputVatAccountId === '' ? null : values.outputVatAccountId,
        receivableAccountId: values.receivableAccountId === '' ? null : values.receivableAccountId,
        bankAccountId: values.bankAccountId === '' ? null : values.bankAccountId,
      };
      return api.accounting.updateMapping(body);
    },
    onSuccess: async () => {
      toast.success(t('mappingSaved'));
      await queryClient.invalidateQueries({ queryKey: ['accounting-mapping'] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('mappingTitle')}</CardTitle>
        <CardDescription>{t('mappingDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {mappingQuery.isPending ? (
          <ListSkeleton rows={4} />
        ) : mappingQuery.isError ? (
          <ErrorState
            message={errorMessage(mappingQuery.error)}
            onRetry={() => void mappingQuery.refetch()}
          />
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              {FIELDS.map((fieldDef) => (
                <div key={fieldDef.key} className="space-y-2">
                  <Label htmlFor={`mapping-${fieldDef.key}`}>{t(fieldDef.labelKey)}</Label>
                  <AccountSelect
                    id={`mapping-${fieldDef.key}`}
                    ariaLabel={t(fieldDef.labelKey)}
                    value={values[fieldDef.key]}
                    onValueChange={(next) =>
                      setValues((prev) => ({ ...prev, [fieldDef.key]: next }))
                    }
                    accounts={accountsQuery.data?.items ?? []}
                    disabled={!canManage || accountsQuery.isPending}
                    noneLabel={t('mappingNone')}
                  />
                </div>
              ))}
            </div>
            {canManage ? (
              <Button
                type="button"
                loading={saveMutation.isPending}
                onClick={() => saveMutation.mutate()}
              >
                <Save aria-hidden="true" />
                {tCommon('save')}
              </Button>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
