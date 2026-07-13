'use client';

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
  Skeleton,
} from '@businessos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardList } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useApiErrorMessage } from '@/lib/errors';
import { TaskStatusBadge } from '@/components/phase2/badges';

/**
 * Applies an onboarding template to an employee and lists the generated,
 * employee-linked tasks (title, status, due date).
 */
export function OnboardingCard({ employeeId }: { employeeId: string }) {
  const t = useTranslations('onboarding');
  const tCommon = useTranslations('common');
  const format = useFormatter();
  const queryClient = useQueryClient();
  const errorMessage = useApiErrorMessage();

  const [open, setOpen] = useState(false);
  const [templateId, setTemplateId] = useState<string | null>(null);

  const tasksQuery = useQuery({
    queryKey: ['employee-tasks', employeeId],
    queryFn: () => api.tasks.list({ employeeId, pageSize: 100 }),
  });

  const templatesQuery = useQuery({
    queryKey: ['onboarding-templates'],
    queryFn: () => api.onboardingTemplates.list(),
    enabled: open,
  });

  const applyMutation = useMutation({
    mutationFn: (id: string) => api.employees.applyTemplate(employeeId, { templateId: id }),
    onSuccess: async (result) => {
      toast.success(t('applied', { count: result.createdTaskCount }));
      setOpen(false);
      setTemplateId(null);
      await queryClient.invalidateQueries({ queryKey: ['employee-tasks', employeeId] });
      await queryClient.invalidateQueries({ queryKey: ['employee-activity', employeeId] });
      await queryClient.invalidateQueries({ queryKey: ['employee', employeeId] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const templates = templatesQuery.data ?? [];
  const tasks = tasksQuery.data?.items ?? [];

  return (
    <div className="space-y-3">
      {tasksQuery.isPending ? (
        <Skeleton className="h-16 w-full" />
      ) : tasks.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('tasksNote')}</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {tasks.map((task) => (
            <li key={task.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <span className="truncate">{task.title}</span>
              <span className="flex shrink-0 items-center gap-2">
                {task.dueDate ? (
                  <span className="text-muted-foreground">
                    {format.dateTime(new Date(task.dueDate), { dateStyle: 'medium' })}
                  </span>
                ) : null}
                <TaskStatusBadge status={task.status} />
              </span>
            </li>
          ))}
        </ul>
      )}
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <ClipboardList aria-hidden="true" />
        {t('apply')}
      </Button>

      <Dialog
        open={open}
        onOpenChange={(next) => (applyMutation.isPending ? undefined : setOpen(next))}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('applyTitle')}</DialogTitle>
            <DialogDescription>{t('applyDescription')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="onboarding-template">{t('template')}</Label>
            <Select
              value={templateId ?? undefined}
              onValueChange={(value) => setTemplateId(value)}
              disabled={templatesQuery.isPending || templates.length === 0}
            >
              <SelectTrigger id="onboarding-template" aria-label={t('template')}>
                <SelectValue placeholder={t('selectTemplate')} />
              </SelectTrigger>
              <SelectContent>
                {templates.map((template) => (
                  <SelectItem key={template.id} value={template.id}>
                    {template.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!templatesQuery.isPending && templates.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('noTemplates')}</p>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={applyMutation.isPending}
              onClick={() => setOpen(false)}
            >
              {tCommon('cancel')}
            </Button>
            <Button
              type="button"
              loading={applyMutation.isPending}
              disabled={!templateId}
              onClick={() => {
                if (templateId) applyMutation.mutate(templateId);
              }}
            >
              {t('apply_submit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
