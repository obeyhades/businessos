'use client';

import {
  CHECKLIST_TYPES,
  createTemplateBodySchema,
  type CreateTemplateBody,
  type OnboardingTemplateDto,
} from '@businessos/types';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '@businessos/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Controller, useFieldArray, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { EmptyState, ErrorState, ListSkeleton } from '@/components/data-states';
import { TextField } from '@/components/form-field';
import { api } from '@/lib/api';
import { useApiErrorMessage } from '@/lib/errors';
import { can, useSession } from '@/lib/session';

function toDefaults(template?: OnboardingTemplateDto): CreateTemplateBody {
  return {
    name: template?.name ?? '',
    description: template?.description ?? '',
    type: template?.type ?? 'ONBOARDING',
    items:
      template?.items.map((item) => ({
        title: item.title,
        description: item.description ?? '',
        dueOffsetDays: item.dueOffsetDays,
      })) ?? [],
  };
}

function TemplateFormDialog({
  open,
  onOpenChange,
  template,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template?: OnboardingTemplateDto;
}) {
  const tForm = useTranslations('onboardingTemplates.form');
  const tType = useTranslations('onboardingTemplates.type');
  const tCommon = useTranslations('common');
  const queryClient = useQueryClient();
  const errorMessage = useApiErrorMessage();
  const isEdit = template !== undefined;

  const {
    register,
    handleSubmit,
    control,
    reset,
    setError,
    formState: { errors },
  } = useForm<CreateTemplateBody>({
    resolver: zodResolver(createTemplateBodySchema),
    defaultValues: toDefaults(template),
  });

  const { fields, append, remove } = useFieldArray({ control, name: 'items' });

  useEffect(() => {
    if (open) reset(toDefaults(template));
  }, [open, template, reset]);

  const mutation = useMutation({
    mutationFn: (values: CreateTemplateBody) =>
      isEdit
        ? api.onboardingTemplates.update(template.id, values)
        : api.onboardingTemplates.create(values),
    onSuccess: async () => {
      toast.success(isEdit ? tForm('updated') : tForm('created'));
      await queryClient.invalidateQueries({ queryKey: ['onboarding-templates'] });
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
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? tForm('editTitle') : tForm('createTitle')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={(event) => void onSubmit(event)} noValidate className="space-y-4">
          {errors.root ? <ErrorState message={errors.root.message ?? ''} /> : null}
          <TextField
            id="template-name"
            label={tForm('name')}
            error={errors.name?.message}
            {...register('name')}
          />
          <TextField
            id="template-description"
            label={tForm('description')}
            error={errors.description?.message}
            {...register('description')}
          />
          <div className="space-y-2">
            <Label htmlFor="template-type">{tForm('type')}</Label>
            <Controller
              control={control}
              name="type"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="template-type" aria-label={tForm('type')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CHECKLIST_TYPES.map((type) => (
                      <SelectItem key={type} value={type}>
                        {tType(type)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>{tForm('items')}</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => append({ title: '', description: '', dueOffsetDays: 0 })}
              >
                <Plus aria-hidden="true" />
                {tForm('addItem')}
              </Button>
            </div>
            {fields.length === 0 ? (
              <p className="text-sm text-muted-foreground">{tForm('noItems')}</p>
            ) : (
              <ul className="space-y-3">
                {fields.map((item, index) => (
                  <li key={item.id} className="flex items-end gap-2">
                    <div className="flex-1">
                      <TextField
                        id={`template-item-title-${index}`}
                        label={tForm('itemTitle')}
                        error={errors.items?.[index]?.title?.message}
                        {...register(`items.${index}.title` as const)}
                      />
                    </div>
                    <div className="w-24">
                      <TextField
                        id={`template-item-offset-${index}`}
                        type="number"
                        label={tForm('dueOffsetDays')}
                        error={errors.items?.[index]?.dueOffsetDays?.message}
                        {...register(`items.${index}.dueOffsetDays` as const, {
                          valueAsNumber: true,
                        })}
                      />
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={tForm('removeItem')}
                      onClick={() => remove(index)}
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>

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

export default function OnboardingTemplatesPage() {
  const t = useTranslations('onboardingTemplates');
  const tType = useTranslations('onboardingTemplates.type');
  const tCommon = useTranslations('common');
  const queryClient = useQueryClient();
  const errorMessage = useApiErrorMessage();
  const { data: session } = useSession();
  const canRead = can(session, 'personnel.read');
  const canManage = can(session, 'personnel.manage');

  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<OnboardingTemplateDto | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<OnboardingTemplateDto | null>(null);

  const templatesQuery = useQuery({
    queryKey: ['onboarding-templates'],
    queryFn: () => api.onboardingTemplates.list(),
    enabled: canRead,
  });

  const deleteMutation = useMutation({
    mutationFn: (templateId: string) => api.onboardingTemplates.remove(templateId),
    onSuccess: async () => {
      toast.success(t('deleted'));
      setDeleteTarget(null);
      await queryClient.invalidateQueries({ queryKey: ['onboarding-templates'] });
    },
    onError: (error) => {
      toast.error(errorMessage(error));
      setDeleteTarget(null);
    },
  });

  if (!canRead) {
    return (
      <div className="mx-auto max-w-6xl">
        <Alert>
          <AlertTitle>{t('title')}</AlertTitle>
          <AlertDescription>{t('restricted')}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        {canManage ? (
          <Button type="button" onClick={() => setCreateOpen(true)}>
            <Plus aria-hidden="true" />
            {t('new')}
          </Button>
        ) : null}
      </div>

      <Card>
        <CardContent className="pt-6">
          {templatesQuery.isPending ? (
            <ListSkeleton rows={4} />
          ) : templatesQuery.isError ? (
            <ErrorState
              message={errorMessage(templatesQuery.error)}
              onRetry={() => void templatesQuery.refetch()}
            />
          ) : templatesQuery.data.length === 0 ? (
            <EmptyState
              title={t('empty')}
              description={t('emptyDescription')}
              action={
                canManage ? (
                  <Button type="button" onClick={() => setCreateOpen(true)}>
                    <Plus aria-hidden="true" />
                    {t('new')}
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>{t('table.name')}</TH>
                  <TH>{t('table.type')}</TH>
                  <TH>{t('table.items')}</TH>
                  {canManage ? <TH>{tCommon('actions')}</TH> : null}
                </TR>
              </THead>
              <TBody>
                {templatesQuery.data.map((template) => (
                  <TR key={template.id}>
                    <TD className="font-medium">{template.name}</TD>
                    <TD>{tType(template.type)}</TD>
                    <TD>{t('itemCount', { count: template.items.length })}</TD>
                    {canManage ? (
                      <TD>
                        <div className="flex gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={tCommon('edit')}
                            onClick={() => setEditTarget(template)}
                          >
                            <Pencil aria-hidden="true" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={t('delete')}
                            onClick={() => setDeleteTarget(template)}
                          >
                            <Trash2 aria-hidden="true" />
                          </Button>
                        </div>
                      </TD>
                    ) : null}
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {canManage ? (
        <>
          <TemplateFormDialog open={createOpen} onOpenChange={setCreateOpen} />
          <TemplateFormDialog
            open={editTarget !== null}
            onOpenChange={(open) => {
              if (!open) setEditTarget(null);
            }}
            template={editTarget ?? undefined}
          />
          <ConfirmDialogWrapper
            template={deleteTarget}
            onClose={() => setDeleteTarget(null)}
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

function ConfirmDialogWrapper({
  template,
  onClose,
  pending,
  onConfirm,
}: {
  template: OnboardingTemplateDto | null;
  onClose: () => void;
  pending: boolean;
  onConfirm: () => void;
}) {
  const t = useTranslations('onboardingTemplates');
  const tCommon = useTranslations('common');
  return (
    <ConfirmDialog
      open={template !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t('deleteTitle')}
      description={template ? t('deleteDescription', { name: template.name }) : undefined}
      confirmLabel={t('delete')}
      cancelLabel={tCommon('cancel')}
      destructive
      pending={pending}
      onConfirm={onConfirm}
    />
  );
}
