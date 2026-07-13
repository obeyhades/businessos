'use client';

import {
  createCertificationBodySchema,
  type CertificationDto,
  type CreateCertificationBody,
} from '@businessos/types';
import {
  Button,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@businessos/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { EmptyState, ErrorState, ListSkeleton } from '@/components/data-states';
import { TextField, TextareaField } from '@/components/form-field';
import { CertificationExpiryBadge } from '@/components/phase3/badges';
import { api } from '@/lib/api';
import { useApiErrorMessage } from '@/lib/errors';

const emptyToNull = (value: unknown) => (value === '' ? null : value);

function toDefaults(certification?: CertificationDto): CreateCertificationBody {
  return {
    name: certification?.name ?? '',
    issuer: certification?.issuer ?? '',
    issuedDate: certification?.issuedDate ?? null,
    expiresAt: certification?.expiresAt ?? null,
    notes: certification?.notes ?? '',
  };
}

function CertificationFormDialog({
  employeeId,
  open,
  onOpenChange,
  certification,
}: {
  employeeId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  certification?: CertificationDto;
}) {
  const t = useTranslations('certifications');
  const tForm = useTranslations('certifications.form');
  const tCommon = useTranslations('common');
  const queryClient = useQueryClient();
  const errorMessage = useApiErrorMessage();
  const isEdit = certification !== undefined;

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<CreateCertificationBody>({
    resolver: zodResolver(createCertificationBodySchema),
    defaultValues: toDefaults(certification),
  });

  useEffect(() => {
    if (open) reset(toDefaults(certification));
  }, [open, certification, reset]);

  const mutation = useMutation({
    mutationFn: (values: CreateCertificationBody) =>
      isEdit
        ? api.certifications.update(employeeId, certification.id, values)
        : api.certifications.create(employeeId, values),
    onSuccess: async () => {
      toast.success(isEdit ? t('updated') : t('created'));
      await queryClient.invalidateQueries({ queryKey: ['certifications', employeeId] });
      onOpenChange(false);
    },
    onError: (error) => setError('root', { message: errorMessage(error) }),
  });

  const onSubmit = handleSubmit((values) => mutation.mutate(values));

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (mutation.isPending ? undefined : onOpenChange(next))}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? tForm('editTitle') : tForm('createTitle')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={(event) => void onSubmit(event)} noValidate className="space-y-4">
          {errors.root ? <ErrorState message={errors.root.message ?? ''} /> : null}
          <TextField
            id="cert-name"
            label={tForm('name')}
            error={errors.name?.message}
            {...register('name')}
          />
          <TextField
            id="cert-issuer"
            label={tForm('issuer')}
            error={errors.issuer?.message}
            {...register('issuer')}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              id="cert-issuedDate"
              type="date"
              label={tForm('issuedDate')}
              error={errors.issuedDate?.message}
              {...register('issuedDate', { setValueAs: emptyToNull })}
            />
            <TextField
              id="cert-expiresAt"
              type="date"
              label={tForm('expiresAt')}
              error={errors.expiresAt?.message}
              {...register('expiresAt', { setValueAs: emptyToNull })}
            />
          </div>
          <TextareaField
            id="cert-notes"
            label={tForm('notes')}
            error={errors.notes?.message}
            {...register('notes')}
          />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={mutation.isPending}
              onClick={() => onOpenChange(false)}
            >
              {tCommon('cancel')}
            </Button>
            <Button type="submit" loading={mutation.isPending}>
              {tCommon('save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function CertificationsCard({
  employeeId,
  canManage,
}: {
  employeeId: string;
  canManage: boolean;
}) {
  const t = useTranslations('certifications');
  const tCommon = useTranslations('common');
  const format = useFormatter();
  const queryClient = useQueryClient();
  const errorMessage = useApiErrorMessage();

  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<CertificationDto | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CertificationDto | null>(null);

  const queryKey = ['certifications', employeeId] as const;
  const certsQuery = useQuery({
    queryKey,
    queryFn: () => api.certifications.list(employeeId),
  });

  const deleteMutation = useMutation({
    mutationFn: (certificationId: string) => api.certifications.remove(employeeId, certificationId),
    onSuccess: async () => {
      toast.success(t('deleted'));
      setDeleteTarget(null);
      await queryClient.invalidateQueries({ queryKey });
    },
    onError: (error) => {
      toast.error(errorMessage(error));
      setDeleteTarget(null);
    },
  });

  function formatDate(value: string | null): string {
    if (!value) return '';
    return format.dateTime(new Date(value), { dateStyle: 'medium' });
  }

  return (
    <div className="space-y-4">
      {canManage ? (
        <Button type="button" variant="outline" size="sm" onClick={() => setCreateOpen(true)}>
          <Plus aria-hidden="true" />
          {t('add')}
        </Button>
      ) : null}

      {certsQuery.isPending ? (
        <ListSkeleton rows={2} />
      ) : certsQuery.isError ? (
        <ErrorState
          message={errorMessage(certsQuery.error)}
          onRetry={() => void certsQuery.refetch()}
        />
      ) : certsQuery.data.length === 0 ? (
        <EmptyState title={t('empty')} />
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {certsQuery.data.map((cert) => (
            <li key={cert.id} className="flex items-start gap-3 p-3">
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{cert.name}</span>
                  <CertificationExpiryBadge expiresAt={cert.expiresAt} />
                </div>
                <p className="text-xs text-muted-foreground">
                  {cert.issuer ? `${t('issuer')}: ${cert.issuer} · ` : ''}
                  {cert.issuedDate
                    ? `${t('issued', { date: formatDate(cert.issuedDate) })} · `
                    : ''}
                  {cert.expiresAt
                    ? t('expires', { date: formatDate(cert.expiresAt) })
                    : t('noExpiry')}
                </p>
              </div>
              {canManage ? (
                <div className="flex shrink-0 gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={t('edit')}
                    onClick={() => setEditTarget(cert)}
                  >
                    <Pencil aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={tCommon('remove')}
                    onClick={() => setDeleteTarget(cert)}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canManage ? (
        <>
          <CertificationFormDialog
            employeeId={employeeId}
            open={createOpen}
            onOpenChange={setCreateOpen}
          />
          <CertificationFormDialog
            employeeId={employeeId}
            open={editTarget !== null}
            onOpenChange={(open) => {
              if (!open) setEditTarget(null);
            }}
            certification={editTarget ?? undefined}
          />
          <ConfirmDialog
            open={deleteTarget !== null}
            onOpenChange={(open) => {
              if (!open) setDeleteTarget(null);
            }}
            title={t('deleteTitle')}
            description={
              deleteTarget ? t('deleteDescription', { name: deleteTarget.name }) : undefined
            }
            confirmLabel={tCommon('remove')}
            cancelLabel={tCommon('cancel')}
            destructive
            pending={deleteMutation.isPending}
            onConfirm={() => {
              if (deleteTarget) deleteMutation.mutate(deleteTarget.id);
            }}
          />
        </>
      ) : null}
    </div>
  );
}
