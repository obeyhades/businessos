'use client';

import type { CustomerStatus, ProjectStatus, TaskPriority, TaskStatus } from '@businessos/types';
import { Badge, type BadgeProps } from '@businessos/ui';
import { useTranslations } from 'next-intl';

type Variant = NonNullable<BadgeProps['variant']>;

const customerStatusVariant: Record<CustomerStatus, Variant> = {
  LEAD: 'secondary',
  ACTIVE: 'default',
  ARCHIVED: 'outline',
};

const projectStatusVariant: Record<ProjectStatus, Variant> = {
  ACTIVE: 'default',
  ON_HOLD: 'secondary',
  COMPLETED: 'outline',
  ARCHIVED: 'outline',
};

const taskStatusVariant: Record<TaskStatus, Variant> = {
  TODO: 'secondary',
  IN_PROGRESS: 'default',
  BLOCKED: 'destructive',
  DONE: 'outline',
  CANCELLED: 'outline',
};

const taskPriorityVariant: Record<TaskPriority, Variant> = {
  LOW: 'outline',
  MEDIUM: 'secondary',
  HIGH: 'default',
  URGENT: 'destructive',
};

export function CustomerStatusBadge({ status }: { status: CustomerStatus }) {
  const t = useTranslations('customerStatus');
  return <Badge variant={customerStatusVariant[status]}>{t(status)}</Badge>;
}

export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  const t = useTranslations('projectStatus');
  return <Badge variant={projectStatusVariant[status]}>{t(status)}</Badge>;
}

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  const t = useTranslations('taskStatus');
  return <Badge variant={taskStatusVariant[status]}>{t(status)}</Badge>;
}

export function TaskPriorityBadge({ priority }: { priority: TaskPriority }) {
  const t = useTranslations('taskPriority');
  return <Badge variant={taskPriorityVariant[priority]}>{t(priority)}</Badge>;
}
