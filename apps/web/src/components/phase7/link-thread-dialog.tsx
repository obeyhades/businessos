'use client';

import type { EmailThreadDetailDto } from '@businessos/types';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@businessos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useApiErrorMessage } from '@/lib/errors';
import { can, useSession } from '@/lib/session';

const NONE = 'NONE';

/** Links (or unlinks) a thread to a customer, project and/or task. */
export function LinkThreadDialog({
  open,
  onOpenChange,
  thread,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  thread: EmailThreadDetailDto;
}) {
  const t = useTranslations('email.thread');
  const tLinks = useTranslations('calendar.links');
  const tCommon = useTranslations('common');
  const queryClient = useQueryClient();
  const errorMessage = useApiErrorMessage();
  const { data: session } = useSession();

  const [customerId, setCustomerId] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setCustomerId(thread.customerId);
    setProjectId(thread.projectId);
    setTaskId(thread.taskId);
    setFormError(null);
  }, [open, thread]);

  const customersQuery = useQuery({
    queryKey: ['customers', 'options'],
    queryFn: () => api.customers.list({ page: 1, pageSize: 100 }),
    enabled: open && can(session, 'customers.read'),
  });
  const projectsQuery = useQuery({
    queryKey: ['projects', 'options'],
    queryFn: () => api.projects.list({ page: 1, pageSize: 100 }),
    enabled: open && can(session, 'projects.read'),
  });
  const tasksQuery = useQuery({
    queryKey: ['tasks', 'options'],
    queryFn: () => api.tasks.list({ pageSize: 100 }),
    enabled: open && can(session, 'tasks.read'),
  });

  const mutation = useMutation({
    mutationFn: () => api.email.link(thread.id, { customerId, projectId, taskId }),
    onSuccess: async () => {
      toast.success(t('linked'));
      await queryClient.invalidateQueries({ queryKey: ['emailThreads'] });
      await queryClient.invalidateQueries({ queryKey: ['emailThread', thread.id] });
      onOpenChange(false);
    },
    onError: (error) => setFormError(errorMessage(error)),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (mutation.isPending ? undefined : onOpenChange(next))}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('linkTitle')}</DialogTitle>
          <DialogDescription>{t('linkDescription')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {formError !== null ? (
            <p role="alert" className="text-sm text-destructive">
              {formError}
            </p>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="link-customer">{tLinks('customer')}</Label>
            <Select
              value={customerId ?? NONE}
              onValueChange={(value) => setCustomerId(value === NONE ? null : value)}
            >
              <SelectTrigger id="link-customer" aria-label={tLinks('customer')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{tLinks('noCustomer')}</SelectItem>
                {(customersQuery.data?.items ?? []).map((customer) => (
                  <SelectItem key={customer.id} value={customer.id}>
                    {customer.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="link-project">{tLinks('project')}</Label>
            <Select
              value={projectId ?? NONE}
              onValueChange={(value) => setProjectId(value === NONE ? null : value)}
            >
              <SelectTrigger id="link-project" aria-label={tLinks('project')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{tLinks('noProject')}</SelectItem>
                {(projectsQuery.data?.items ?? []).map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="link-task">{tLinks('task')}</Label>
            <Select
              value={taskId ?? NONE}
              onValueChange={(value) => setTaskId(value === NONE ? null : value)}
            >
              <SelectTrigger id="link-task" aria-label={tLinks('task')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{tLinks('noTask')}</SelectItem>
                {(tasksQuery.data?.items ?? []).map((task) => (
                  <SelectItem key={task.id} value={task.id}>
                    {task.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
            <Button type="button" loading={mutation.isPending} onClick={() => mutation.mutate()}>
              {tCommon('save')}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
