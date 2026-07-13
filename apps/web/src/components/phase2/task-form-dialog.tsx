'use client';

import {
  TASK_PRIORITIES,
  createTaskBodySchema,
  type CreateTaskBody,
  type TaskDto,
} from '@businessos/types';
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  Input,
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
import { can, useSession } from '@/lib/session';

const NONE = 'NONE';

function isoToDateInput(value: string | null | undefined): string {
  return value ? value.slice(0, 10) : '';
}

function dateInputToIso(value: string): string | null {
  return value ? new Date(`${value}T00:00:00.000Z`).toISOString() : null;
}

function toDefaults(
  task: TaskDto | undefined,
  lockedCustomerId?: string,
  lockedProjectId?: string,
): CreateTaskBody {
  return {
    title: task?.title ?? '',
    description: task?.description ?? '',
    status: task?.status ?? 'TODO',
    priority: task?.priority ?? 'MEDIUM',
    dueDate: task?.dueDate ?? null,
    customerId: lockedCustomerId ?? task?.customer?.id ?? null,
    projectId: lockedProjectId ?? task?.project?.id ?? null,
    assigneeId: task?.assignee?.id ?? null,
  };
}

export function TaskFormDialog({
  open,
  onOpenChange,
  task,
  lockedCustomerId,
  lockedProjectId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task?: TaskDto;
  lockedCustomerId?: string;
  lockedProjectId?: string;
  onSaved?: (task: TaskDto) => void;
}) {
  const t = useTranslations('tasks.form');
  const tCommon = useTranslations('common');
  const tPriority = useTranslations('taskPriority');
  const queryClient = useQueryClient();
  const errorMessage = useApiErrorMessage();
  const { data: session } = useSession();
  const isEdit = task !== undefined;

  const {
    register,
    handleSubmit,
    control,
    reset,
    setError,
    formState: { errors },
  } = useForm<CreateTaskBody>({
    resolver: zodResolver(createTaskBodySchema),
    defaultValues: toDefaults(task, lockedCustomerId, lockedProjectId),
  });

  useEffect(() => {
    if (open) reset(toDefaults(task, lockedCustomerId, lockedProjectId));
  }, [open, task, lockedCustomerId, lockedProjectId, reset]);

  const customersQuery = useQuery({
    queryKey: ['customers', 'options'],
    queryFn: () => api.customers.list({ page: 1, pageSize: 100 }),
    enabled: open && !lockedCustomerId && can(session, 'customers.read'),
  });
  const projectsQuery = useQuery({
    queryKey: ['projects', 'options'],
    queryFn: () => api.projects.list({ page: 1, pageSize: 100 }),
    enabled: open && !lockedProjectId && can(session, 'projects.read'),
  });
  const membersQuery = useQuery({
    queryKey: ['members', 'options'],
    queryFn: () => api.members.list({ page: 1, pageSize: 100 }),
    enabled: open && can(session, 'members.read'),
  });

  const mutation = useMutation({
    mutationFn: (values: CreateTaskBody) =>
      isEdit ? api.tasks.update(task.id, values) : api.tasks.create(values),
    onSuccess: async (saved) => {
      toast.success(isEdit ? t('updated') : t('created'));
      await queryClient.invalidateQueries({ queryKey: ['tasks'] });
      if (isEdit) await queryClient.invalidateQueries({ queryKey: ['task', task.id] });
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
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? t('editTitle') : t('createTitle')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={(event) => void onSubmit(event)} noValidate className="space-y-4">
          {errors.root ? <ErrorState message={errors.root.message ?? ''} /> : null}
          <TextField
            id="task-title"
            label={t('titleField')}
            error={errors.title?.message}
            {...register('title')}
          />
          <TextareaField
            id="task-description"
            label={t('description')}
            error={errors.description?.message}
            {...register('description')}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="task-priority">{t('priority')}</Label>
              <Controller
                control={control}
                name="priority"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="task-priority" aria-label={t('priority')}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TASK_PRIORITIES.map((priority) => (
                        <SelectItem key={priority} value={priority}>
                          {tPriority(priority)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="task-dueDate">{t('dueDate')}</Label>
              <Controller
                control={control}
                name="dueDate"
                render={({ field }) => (
                  <Input
                    id="task-dueDate"
                    type="date"
                    value={isoToDateInput(field.value)}
                    onChange={(event) => field.onChange(dateInputToIso(event.target.value))}
                  />
                )}
              />
            </div>
          </div>

          {!lockedCustomerId ? (
            <div className="space-y-2">
              <Label htmlFor="task-customer">{t('customer')}</Label>
              <Controller
                control={control}
                name="customerId"
                render={({ field }) => (
                  <Select
                    value={field.value ?? NONE}
                    onValueChange={(value) => field.onChange(value === NONE ? null : value)}
                  >
                    <SelectTrigger id="task-customer" aria-label={t('customer')}>
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

          {!lockedProjectId ? (
            <div className="space-y-2">
              <Label htmlFor="task-project">{t('project')}</Label>
              <Controller
                control={control}
                name="projectId"
                render={({ field }) => (
                  <Select
                    value={field.value ?? NONE}
                    onValueChange={(value) => field.onChange(value === NONE ? null : value)}
                  >
                    <SelectTrigger id="task-project" aria-label={t('project')}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>{t('noProject')}</SelectItem>
                      {(projectsQuery.data?.items ?? []).map((project) => (
                        <SelectItem key={project.id} value={project.id}>
                          {project.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="task-assignee">{t('assignee')}</Label>
            <Controller
              control={control}
              name="assigneeId"
              render={({ field }) => (
                <Select
                  value={field.value ?? NONE}
                  onValueChange={(value) => field.onChange(value === NONE ? null : value)}
                >
                  <SelectTrigger id="task-assignee" aria-label={t('assignee')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>{t('unassigned')}</SelectItem>
                    {(membersQuery.data?.items ?? []).map((member) => (
                      <SelectItem key={member.user.id} value={member.user.id}>
                        {member.user.name}
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
