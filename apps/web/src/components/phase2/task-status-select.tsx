'use client';

import { TASK_STATUSES, type TaskDto, type TaskStatus } from '@businessos/types';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@businessos/ui';
import { useMutation } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { TaskStatusBadge } from '@/components/phase2/badges';
import { api } from '@/lib/api';
import { useApiErrorMessage } from '@/lib/errors';

/**
 * Inline status control for a task. Renders a read-only badge when the user
 * cannot manage tasks, otherwise a select that patches the task on change.
 */
export function TaskStatusSelect({
  task,
  canManage,
  onUpdated,
  className,
}: {
  task: TaskDto;
  canManage: boolean;
  onUpdated?: () => void | Promise<void>;
  className?: string;
}) {
  const t = useTranslations('taskStatus');
  const errorMessage = useApiErrorMessage();

  const mutation = useMutation({
    mutationFn: (status: TaskStatus) => api.tasks.update(task.id, { status }),
    onSuccess: async () => {
      await onUpdated?.();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (!canManage) return <TaskStatusBadge status={task.status} />;

  return (
    <Select
      value={task.status}
      onValueChange={(value) => mutation.mutate(value as TaskStatus)}
      disabled={mutation.isPending}
    >
      <SelectTrigger className={className ?? 'h-8 w-40'} aria-label={t('label')}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {TASK_STATUSES.map((status) => (
          <SelectItem key={status} value={status}>
            {t(status)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
