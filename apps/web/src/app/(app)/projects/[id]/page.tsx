'use client';

import { PROJECT_STATUSES, type ProjectDto, type ProjectStatus } from '@businessos/types';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@businessos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Plus } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { EmptyState, ErrorState, ListSkeleton } from '@/components/data-states';
import { ActivityTimeline } from '@/components/phase2/activity-timeline';
import { AttachmentsSection } from '@/components/phase2/attachments-section';
import { ProjectStatusBadge, TaskPriorityBadge } from '@/components/phase2/badges';
import { CommentsSection } from '@/components/phase2/comments-section';
import { TaskFormDialog } from '@/components/phase2/task-form-dialog';
import { TaskStatusSelect } from '@/components/phase2/task-status-select';
import { api } from '@/lib/api';
import { useApiErrorMessage } from '@/lib/errors';
import { can, useSession } from '@/lib/session';

function ProjectStatusControl({ project }: { project: ProjectDto }) {
  const t = useTranslations('projectStatus');
  const queryClient = useQueryClient();
  const errorMessage = useApiErrorMessage();
  const { data: session } = useSession();
  const canManage = can(session, 'projects.manage');

  const mutation = useMutation({
    mutationFn: (status: ProjectStatus) => api.projects.update(project.id, { status }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['project', project.id] });
      await queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (!canManage) return <ProjectStatusBadge status={project.status} />;

  return (
    <Select
      value={project.status}
      onValueChange={(value) => mutation.mutate(value as ProjectStatus)}
      disabled={mutation.isPending}
    >
      <SelectTrigger className="h-8 w-44" aria-label={t('label')}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {PROJECT_STATUSES.map((status) => (
          <SelectItem key={status} value={status}>
            {t(status)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ProjectTasksCard({ project }: { project: ProjectDto }) {
  const t = useTranslations('tasks');
  const tProjects = useTranslations('projects');
  const format = useFormatter();
  const queryClient = useQueryClient();
  const errorMessage = useApiErrorMessage();
  const { data: session } = useSession();
  const canManage = can(session, 'tasks.manage');
  const [addOpen, setAddOpen] = useState(false);

  const tasksQuery = useQuery({
    queryKey: ['tasks', { projectId: project.id }],
    queryFn: () => api.tasks.list({ projectId: project.id, pageSize: 100 }),
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['tasks', { projectId: project.id }] });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle>{tProjects('tasks')}</CardTitle>
        {canManage ? (
          <Button type="button" variant="outline" size="sm" onClick={() => setAddOpen(true)}>
            <Plus aria-hidden="true" />
            {t('new')}
          </Button>
        ) : null}
      </CardHeader>
      <CardContent>
        {tasksQuery.isPending ? (
          <ListSkeleton rows={3} />
        ) : tasksQuery.isError ? (
          <ErrorState
            message={errorMessage(tasksQuery.error)}
            onRetry={() => void tasksQuery.refetch()}
          />
        ) : tasksQuery.data.items.length === 0 ? (
          <EmptyState title={tProjects('noTasks')} />
        ) : (
          <ul className="divide-y divide-border">
            {tasksQuery.data.items.map((task) => (
              <li
                key={task.id}
                className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0"
              >
                <Link
                  href={`/tasks/${task.id}`}
                  className="min-w-0 flex-1 font-medium hover:underline"
                >
                  {task.title}
                </Link>
                <TaskPriorityBadge priority={task.priority} />
                {task.dueDate ? (
                  <span className="text-xs text-muted-foreground">
                    {format.dateTime(new Date(task.dueDate), { dateStyle: 'medium' })}
                  </span>
                ) : null}
                <TaskStatusSelect
                  task={task}
                  canManage={canManage}
                  onUpdated={invalidate}
                  className="h-8 w-36"
                />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <TaskFormDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        lockedProjectId={project.id}
        lockedCustomerId={project.customer?.id}
        onSaved={() => void invalidate()}
      />
    </Card>
  );
}

function ProjectDetail({ project }: { project: ProjectDto }) {
  const t = useTranslations('projects');
  const { data: session } = useSession();
  const canManage = can(session, 'projects.manage');

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2 text-muted-foreground">
          <Link href="/projects">
            <ArrowLeft aria-hidden="true" />
            {t('backToList')}
          </Link>
        </Button>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-2xl font-semibold tracking-tight">{project.name}</h1>
          <ProjectStatusControl project={project} />
        </div>
        {project.customer ? (
          <p className="mt-1 text-sm text-muted-foreground">
            {t('forCustomer')}{' '}
            <Link
              href={`/customers/${project.customer.id}`}
              className="font-medium hover:underline"
            >
              {project.customer.name}
            </Link>
          </p>
        ) : null}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          {project.description ? (
            <Card>
              <CardHeader>
                <CardTitle>{t('form.description')}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap text-sm">{project.description}</p>
              </CardContent>
            </Card>
          ) : null}

          <ProjectTasksCard project={project} />

          <Card>
            <CardHeader>
              <CardTitle>{t('attachments')}</CardTitle>
            </CardHeader>
            <CardContent>
              <AttachmentsSection kind="project" entityId={project.id} canManage={canManage} />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{t('comments')}</CardTitle>
            </CardHeader>
            <CardContent>
              <CommentsSection kind="project" entityId={project.id} canManage={canManage} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('activity')}</CardTitle>
            </CardHeader>
            <CardContent>
              <ActivityTimeline
                queryKey={['project-activity', project.id]}
                queryFn={() => api.projects.activity(project.id)}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

export default function ProjectDetailPage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;
  const errorMessage = useApiErrorMessage();

  const projectQuery = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => api.projects.get(projectId),
    enabled: Boolean(projectId),
  });

  if (projectQuery.isPending) {
    return (
      <div className="mx-auto max-w-6xl">
        <ListSkeleton rows={6} />
      </div>
    );
  }
  if (projectQuery.isError) {
    return (
      <div className="mx-auto max-w-6xl">
        <ErrorState
          message={errorMessage(projectQuery.error)}
          onRetry={() => void projectQuery.refetch()}
        />
      </div>
    );
  }

  return <ProjectDetail project={projectQuery.data} />;
}
