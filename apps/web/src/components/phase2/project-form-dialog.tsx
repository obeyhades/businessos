'use client';

import {
  PROJECT_STATUSES,
  createProjectBodySchema,
  type CreateProjectBody,
  type ProjectDto,
} from '@businessos/types';
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
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
import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { ErrorState } from '@/components/data-states';
import { TextField, TextareaField } from '@/components/form-field';
import { api } from '@/lib/api';
import { useApiErrorMessage } from '@/lib/errors';

const NONE = 'NONE';

function toDefaults(project?: ProjectDto): CreateProjectBody {
  return {
    name: project?.name ?? '',
    description: project?.description ?? '',
    customerId: project?.customer?.id ?? null,
    status: project?.status ?? 'ACTIVE',
  };
}

export function ProjectFormDialog({
  open,
  onOpenChange,
  project,
  lockedCustomerId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project?: ProjectDto;
  lockedCustomerId?: string;
  onSaved?: (project: ProjectDto) => void;
}) {
  const t = useTranslations('projects.form');
  const tCommon = useTranslations('common');
  const tStatus = useTranslations('projectStatus');
  const queryClient = useQueryClient();
  const errorMessage = useApiErrorMessage();
  const isEdit = project !== undefined;

  const {
    register,
    handleSubmit,
    control,
    reset,
    setError,
    formState: { errors },
  } = useForm<CreateProjectBody>({
    resolver: zodResolver(createProjectBodySchema),
    defaultValues: toDefaults(project),
  });

  useEffect(() => {
    if (open) {
      reset({
        ...toDefaults(project),
        ...(lockedCustomerId ? { customerId: lockedCustomerId } : {}),
      });
    }
  }, [open, project, lockedCustomerId, reset]);

  const customersQuery = useQuery({
    queryKey: ['customers', 'options'],
    queryFn: () => api.customers.list({ page: 1, pageSize: 100 }),
    enabled: open && !lockedCustomerId,
  });

  const mutation = useMutation({
    mutationFn: (values: CreateProjectBody) =>
      isEdit ? api.projects.update(project.id, values) : api.projects.create(values),
    onSuccess: async (saved) => {
      toast.success(isEdit ? t('updated') : t('created'));
      await queryClient.invalidateQueries({ queryKey: ['projects'] });
      if (isEdit) await queryClient.invalidateQueries({ queryKey: ['project', project.id] });
      onOpenChange(false);
      onSaved?.(saved);
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
          <DialogTitle>{isEdit ? t('editTitle') : t('createTitle')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={(event) => void onSubmit(event)} noValidate className="space-y-4">
          {errors.root ? <ErrorState message={errors.root.message ?? ''} /> : null}
          <TextField
            id="project-name"
            label={t('name')}
            error={errors.name?.message}
            {...register('name')}
          />
          <TextareaField
            id="project-description"
            label={t('description')}
            error={errors.description?.message}
            {...register('description')}
          />
          {!lockedCustomerId ? (
            <div className="space-y-2">
              <Label htmlFor="project-customer">{t('customer')}</Label>
              <Controller
                control={control}
                name="customerId"
                render={({ field }) => (
                  <Select
                    value={field.value ?? NONE}
                    onValueChange={(value) => field.onChange(value === NONE ? null : value)}
                  >
                    <SelectTrigger id="project-customer" aria-label={t('customer')}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>{t('noCustomer')}</SelectItem>
                      {(customersQuery.data?.items ?? []).map((customer) => (
                        <SelectItem key={customer.id} value={customer.id}>
                          {customer.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
          ) : null}
          <div className="space-y-2">
            <Label htmlFor="project-status">{tCommon('status')}</Label>
            <Controller
              control={control}
              name="status"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="project-status" aria-label={tCommon('status')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PROJECT_STATUSES.map((status) => (
                      <SelectItem key={status} value={status}>
                        {tStatus(status)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
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
