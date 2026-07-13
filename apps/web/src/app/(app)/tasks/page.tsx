'use client';

import { TASK_PRIORITIES, TASK_STATUSES, type TaskDto, type TaskPriority } from '@businessos/types';
import {
  Badge,
  Button,
  Card,
  CardContent,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@businessos/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState } from 'react';
import { EmptyState, ErrorState, ListSkeleton } from '@/components/data-states';
import { TaskPriorityBadge } from '@/components/phase2/badges';
import { TaskFormDialog } from '@/components/phase2/task-form-dialog';
import { TaskStatusSelect } from '@/components/phase2/task-status-select';
import { api } from '@/lib/api';
import { useApiErrorMessage } from '@/lib/errors';
import { can, useSession } from '@/lib/session';
import { useDebounced } from '@/lib/use-debounced';

const ALL = 'ALL';

function TaskRow({
  task,
  canManage,
  onUpdated,
}: {
  task: TaskDto;
  canManage: boolean;
  onUpdated: () => void | Promise<void>;
}) {
  const t = useTranslations('tasks');
  const format = useFormatter();

  return (
    <li className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
      <Link href={`/tasks/${task.id}`} className="min-w-0 flex-1 font-medium hover:underline">
        {task.title}
      </Link>
      <TaskPriorityBadge priority={task.priority} />
      {task.customer ? <Badge variant="outline">{task.customer.name}</Badge> : null}
      {task.project ? <Badge variant="outline">{task.project.name}</Badge> : null}
      <span className="text-xs text-muted-foreground">
        {task.assignee ? task.assignee.name : t('unassigned')}
      </span>
      {task.dueDate ? (
        <span className="text-xs text-muted-foreground">
          {t('due', { date: format.dateTime(new Date(task.dueDate), { dateStyle: 'medium' }) })}
        </span>
      ) : null}
      <TaskStatusSelect
        task={task}
        canManage={canManage}
        onUpdated={onUpdated}
        className="h-8 w-36"
      />
    </li>
  );
}

export default function TasksPage() {
  const t = useTranslations('tasks');
  const tStatus = useTranslations('taskStatus');
  const tPriority = useTranslations('taskPriority');
  const queryClient = useQueryClient();
  const errorMessage = useApiErrorMessage();
  const { data: session } = useSession();
  const canManage = can(session, 'tasks.manage');
  const canReadMembers = can(session, 'members.read');

  const [search, setSearch] = useState('');
  const [priority, setPriority] = useState<TaskPriority | typeof ALL>(ALL);
  const [assigneeId, setAssigneeId] = useState<string>(ALL);
  const [mine, setMine] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const debouncedSearch = useDebounced(search.trim(), 300);

  const membersQuery = useQuery({
    queryKey: ['members', 'options'],
    queryFn: () => api.members.list({ page: 1, pageSize: 100 }),
    enabled: canReadMembers,
  });

  const filters = {
    search: debouncedSearch.length > 0 ? debouncedSearch : undefined,
    priority: priority === ALL ? undefined : priority,
    mine: mine ? true : undefined,
    assigneeId: mine || assigneeId === ALL ? undefined : assigneeId,
  };

  const tasksQuery = useQuery({
    queryKey: ['tasks', 'hub', filters],
    queryFn: () => api.tasks.list({ ...filters, pageSize: 100 }),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['tasks'] });

  const items = tasksQuery.data?.items ?? [];
  const groups = TASK_STATUSES.map((status) => ({
    status,
    tasks: items.filter((task) => task.status === status),
  })).filter((group) => group.tasks.length > 0);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        {canManage ? (
          <Button type="button" onClick={() => setCreateOpen(true)}>
            <Plus aria-hidden="true" />
            {t('new')}
          </Button>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t('searchPlaceholder')}
          aria-label={t('searchPlaceholder')}
          className="w-full sm:w-56"
        />
        <Select
          value={priority}
          onValueChange={(value) => setPriority(value as TaskPriority | typeof ALL)}
        >
          <SelectTrigger className="w-full sm:w-44" aria-label={t('filterPriority')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('allPriorities')}</SelectItem>
            {TASK_PRIORITIES.map((value) => (
              <SelectItem key={value} value={value}>
                {tPriority(value)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {canReadMembers ? (
          <Select value={assigneeId} onValueChange={setAssigneeId} disabled={mine}>
            <SelectTrigger className="w-full sm:w-52" aria-label={t('filterAssignee')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t('allAssignees')}</SelectItem>
              {(membersQuery.data?.items ?? []).map((member) => (
                <SelectItem key={member.user.id} value={member.user.id}>
                  {member.user.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        <Button
          type="button"
          variant={mine ? 'default' : 'outline'}
          aria-pressed={mine}
          onClick={() => setMine((value) => !value)}
        >
          {t('mine')}
        </Button>
      </div>

      {tasksQuery.isPending ? (
        <Card>
          <CardContent className="pt-6">
            <ListSkeleton rows={6} />
          </CardContent>
        </Card>
      ) : tasksQuery.isError ? (
        <ErrorState
          message={errorMessage(tasksQuery.error)}
          onRetry={() => void tasksQuery.refetch()}
        />
      ) : groups.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
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
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {groups.map((group) => (
            <Card key={group.status}>
              <CardContent className="pt-6">
                <div className="mb-2 flex items-center gap-2">
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                    {tStatus(group.status)}
                  </h2>
                  <Badge variant="secondary">{group.tasks.length}</Badge>
                </div>
                <ul className="divide-y divide-border">
                  {group.tasks.map((task) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      canManage={canManage}
                      onUpdated={invalidate}
                    />
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <TaskFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSaved={() => void invalidate()}
      />
    </div>
  );
}
