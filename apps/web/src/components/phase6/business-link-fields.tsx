'use client';

import {
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@businessos/ui';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { api } from '@/lib/api';
import { can, useSession } from '@/lib/session';

const NONE = 'NONE';

export interface BusinessLinks {
  customerId: string | null;
  projectId: string | null;
  taskId: string | null;
}

/** Three optional selects linking an event to a customer / project / task. */
export function BusinessLinkFields({
  value,
  onChange,
  enabled,
}: {
  value: BusinessLinks;
  onChange: (value: BusinessLinks) => void;
  enabled: boolean;
}) {
  const t = useTranslations('calendar.links');
  const { data: session } = useSession();

  const customersQuery = useQuery({
    queryKey: ['customers', 'options'],
    queryFn: () => api.customers.list({ page: 1, pageSize: 100 }),
    enabled: enabled && can(session, 'customers.read'),
  });
  const projectsQuery = useQuery({
    queryKey: ['projects', 'options'],
    queryFn: () => api.projects.list({ page: 1, pageSize: 100 }),
    enabled: enabled && can(session, 'projects.read'),
  });
  const tasksQuery = useQuery({
    queryKey: ['tasks', 'options'],
    queryFn: () => api.tasks.list({ pageSize: 100 }),
    enabled: enabled && can(session, 'tasks.read'),
  });

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <div className="space-y-2">
        <Label htmlFor="event-customer">{t('customer')}</Label>
        <Select
          value={value.customerId ?? NONE}
          onValueChange={(next) => onChange({ ...value, customerId: next === NONE ? null : next })}
        >
          <SelectTrigger id="event-customer" aria-label={t('customer')}>
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
      </div>

      <div className="space-y-2">
        <Label htmlFor="event-project">{t('project')}</Label>
        <Select
          value={value.projectId ?? NONE}
          onValueChange={(next) => onChange({ ...value, projectId: next === NONE ? null : next })}
        >
          <SelectTrigger id="event-project" aria-label={t('project')}>
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
      </div>

      <div className="space-y-2">
        <Label htmlFor="event-task">{t('task')}</Label>
        <Select
          value={value.taskId ?? NONE}
          onValueChange={(next) => onChange({ ...value, taskId: next === NONE ? null : next })}
        >
          <SelectTrigger id="event-task" aria-label={t('task')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>{t('noTask')}</SelectItem>
            {(tasksQuery.data?.items ?? []).map((task) => (
              <SelectItem key={task.id} value={task.id}>
                {task.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
