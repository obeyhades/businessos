'use client';

import type { EmailLabelDto } from '@businessos/types';
import {
  Button,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Separator,
} from '@businessos/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useApiErrorMessage } from '@/lib/errors';

const DEFAULT_COLOR = '#64748b';

/** Manager dialog: list, create and delete the org's email labels. */
export function LabelManageDialog({
  open,
  onOpenChange,
  labels,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  labels: EmailLabelDto[];
}) {
  const t = useTranslations('email.labels');
  const tCommon = useTranslations('common');
  const queryClient = useQueryClient();
  const errorMessage = useApiErrorMessage();

  const [name, setName] = useState('');
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<EmailLabelDto | undefined>(undefined);

  const createMutation = useMutation({
    mutationFn: () => api.email.createLabel({ name: name.trim(), color }),
    onSuccess: async () => {
      toast.success(t('created'));
      setName('');
      setColor(DEFAULT_COLOR);
      setFormError(null);
      await queryClient.invalidateQueries({ queryKey: ['emailLabels'] });
    },
    onError: (error) => setFormError(errorMessage(error)),
  });

  const deleteMutation = useMutation({
    mutationFn: (labelId: string) => api.email.removeLabel(labelId),
    onSuccess: async () => {
      toast.success(t('deleted'));
      setDeleteTarget(undefined);
      await queryClient.invalidateQueries({ queryKey: ['emailLabels'] });
      await queryClient.invalidateQueries({ queryKey: ['emailThreads'] });
      await queryClient.invalidateQueries({ queryKey: ['emailThread'] });
    },
    onError: (error) => {
      toast.error(errorMessage(error));
      setDeleteTarget(undefined);
    },
  });

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (name.trim().length === 0) {
      setFormError(t('nameRequired'));
      return;
    }
    createMutation.mutate();
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('manage')}</DialogTitle>
            <DialogDescription>{t('manageDescription')}</DialogDescription>
          </DialogHeader>

          {labels.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('empty')}</p>
          ) : (
            <ul className="space-y-1">
              {labels.map((label) => (
                <li key={label.id} className="flex items-center gap-2 rounded-md px-2 py-1.5">
                  <span
                    aria-hidden="true"
                    className="size-3 shrink-0 rounded-full"
                    style={{ backgroundColor: label.color }}
                  />
                  <span className="min-w-0 flex-1 truncate text-sm">{label.name}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    aria-label={t('delete')}
                    onClick={() => setDeleteTarget(label)}
                  >
                    <Trash2 aria-hidden="true" className="size-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          )}

          <Separator />

          <form onSubmit={onSubmit} noValidate className="space-y-4">
            <p className="text-sm font-medium">{t('new')}</p>
            {formError !== null ? (
              <p role="alert" className="text-sm text-destructive">
                {formError}
              </p>
            ) : null}
            <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
              <div className="space-y-2">
                <Label htmlFor="label-name">{t('name')}</Label>
                <Input
                  id="label-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="label-color">{t('color')}</Label>
                <Input
                  id="label-color"
                  type="color"
                  value={color}
                  onChange={(event) => setColor(event.target.value)}
                  className="h-9 w-16 cursor-pointer p-1"
                />
              </div>
            </div>
            <div className="flex justify-end">
              <Button type="submit" loading={createMutation.isPending}>
                <Plus aria-hidden="true" />
                {t('create')}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteTarget !== undefined}
        onOpenChange={(next) => (next ? undefined : setDeleteTarget(undefined))}
        title={t('delete')}
        description={t('deleteConfirm', { name: deleteTarget?.name ?? '' })}
        confirmLabel={t('delete')}
        cancelLabel={tCommon('cancel')}
        destructive
        pending={deleteMutation.isPending}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
      />
    </>
  );
}
