'use client';

import type { TaskDto } from '@businessos/types';
import { Button, Card, CardContent, CardHeader, CardTitle, ConfirmDialog } from '@businessos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Pencil, Trash2 } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { ErrorState, ListSkeleton } from '@/components/data-states';
import { ActivityTimeline } from '@/components/phase2/activity-timeline';
import { AttachmentsSection } from '@/components/phase2/attachments-section';
import { TaskPriorityBadge } from '@/components/phase2/badges';
import { CommentsSection } from '@/components/phase2/comments-section';
import { TaskFormDialog } from '@/components/phase2/task-form-dialog';
import { TaskStatusSelect } from '@/components/phase2/task-status-select';
import { api } from '@/lib/api';
import { useApiErrorMessage } from '@/lib/errors';
import { can, useSession } from '@/lib/session';

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:justify-between sm:gap-4">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm sm:text-right">{children}</span>
    </div>
  );
}

function TaskDetail({ task }: { task: TaskDto }) {
  const t = useTranslations('tasks');
  const tCommon = useTranslations('common');
  const format = useFormatter();
  const router = useRouter();
  const queryClient = useQueryClient();
  const errorMessage = useApiErrorMessage();
  const { data: session } = useSession();
  const canManage = can(session, 'tasks.manage');

  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ['task', task.id] });
    await queryClient.invalidateQueries({ queryKey: ['task-activity', task.id] });
    await queryClient.invalidateQueries({ queryKey: ['tasks'] });
  };

  const deleteMutation = useMutation({
    mutationFn: () => api.tasks.remove(task.id),
    onSuccess: async () => {
      toast.success(t('deleted'));
      await queryClient.invalidateQueries({ queryKey: ['tasks'] });
      router.push('/tasks');
    },
    onError: (error) => {
      toast.error(errorMessage(error));
      setDeleteOpen(false);
    },
  });

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2 text-muted-foreground">
          <Link href="/tasks">
            <ArrowLeft aria-hidden="true" />
            {t('backToList')}
          </Link>
        </Button>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">{task.title}</h1>
            <TaskPriorityBadge priority={task.priority} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <TaskStatusSelect task={task} canManage={canManage} onUpdated={invalidate} />
            {canManage ? (
              <>
                <Button type="button" variant="outline" onClick={() => setEditOpen(true)}>
                  <Pencil aria-hidden="true" />
                  {tCommon('edit')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  aria-label={t('delete')}
                  onClick={() => setDeleteOpen(true)}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </>
            ) : null}
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{t('details')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {task.description ? (
                <p className="whitespace-pre-wrap text-sm">{task.description}</p>
              ) : (
                <p className="text-sm text-muted-foreground">{t('noDescription')}</p>
              )}
              <DetailRow label={t('form.dueDate')}>
                {task.dueDate
                  ? format.dateTime(new Date(task.dueDate), { dateStyle: 'medium' })
                  : '—'}
              </DetailRow>
              <DetailRow label={t('form.assignee')}>
                {task.assignee ? task.assignee.name : t('unassigned')}
              </DetailRow>
              <DetailRow label={t('form.customer')}>
                {task.customer ? (
                  <Link href={`/customers/${task.customer.id}`} className="hover:underline">
                    {task.customer.name}
                  </Link>
                ) : (
                  '—'
                )}
              </DetailRow>
              <DetailRow label={t('form.project')}>
                {task.project ? (
                  <Link href={`/projects/${task.project.id}`} className="hover:underline">
                    {task.project.name}
                  </Link>
                ) : (
                  '—'
                )}
              </DetailRow>
              {task.completedAt ? (
                <DetailRow label={t('completedAt')}>
                  {format.dateTime(new Date(task.completedAt), {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}
                </DetailRow>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('attachments')}</CardTitle>
            </CardHeader>
            <CardContent>
              <AttachmentsSection kind="task" entityId={task.id} canManage={canManage} />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{t('comments')}</CardTitle>
            </CardHeader>
            <CardContent>
              <CommentsSection kind="task" entityId={task.id} canManage={canManage} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('activity')}</CardTitle>
            </CardHeader>
            <CardContent>
              <ActivityTimeline
                queryKey={['task-activity', task.id]}
                queryFn={() => api.tasks.activity(task.id)}
              />
            </CardContent>
          </Card>
        </div>
      </div>

      <TaskFormDialog open={editOpen} onOpenChange={setEditOpen} task={task} />

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t('deleteTitle')}
        description={t('deleteDescription', { title: task.title })}
        confirmLabel={t('delete')}
        cancelLabel={tCommon('cancel')}
        destructive
        pending={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate()}
      />
    </div>
  );
}

export default function TaskDetailPage() {
  const params = useParams<{ id: string }>();
  const taskId = params.id;
  const errorMessage = useApiErrorMessage();

  const taskQuery = useQuery({
    queryKey: ['task', taskId],
    queryFn: () => api.tasks.get(taskId),
    enabled: Boolean(taskId),
  });

  if (taskQuery.isPending) {
    return (
      <div className="mx-auto max-w-6xl">
        <ListSkeleton rows={6} />
      </div>
    );
  }
  if (taskQuery.isError) {
    return (
      <div className="mx-auto max-w-6xl">
        <ErrorState
          message={errorMessage(taskQuery.error)}
          onRetry={() => void taskQuery.refetch()}
        />
      </div>
    );
  }

  return <TaskDetail task={taskQuery.data} />;
}
