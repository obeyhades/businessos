'use client';

import type { RecordingDto } from '@businessos/types';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@businessos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useApiErrorMessage } from '@/lib/errors';
import { can, useSession } from '@/lib/session';

const NONE = 'NONE';

function dateInputToIso(value: string): string | undefined {
  return value ? new Date(`${value}T00:00:00.000Z`).toISOString() : undefined;
}

/** Converts a recording into a task (optional title/assignee/due date) and opens it. */
export function RecordingToTaskDialog({
  open,
  onOpenChange,
  recording,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recording: RecordingDto;
}) {
  const t = useTranslations('recordings.toTask');
  const tCommon = useTranslations('common');
  const queryClient = useQueryClient();
  const errorMessage = useApiErrorMessage();
  const router = useRouter();
  const { data: session } = useSession();

  const [title, setTitle] = useState('');
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [dueDate, setDueDate] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTitle(recording.title);
    setAssigneeId(null);
    setDueDate('');
    setFormError(null);
  }, [open, recording]);

  const membersQuery = useQuery({
    queryKey: ['members', 'options'],
    queryFn: () => api.members.list({ page: 1, pageSize: 100 }),
    enabled: open && can(session, 'members.read'),
  });

  const mutation = useMutation({
    mutationFn: () =>
      api.recordings.toTask(recording.id, {
        title: title.trim().length > 0 ? title.trim() : undefined,
        assigneeId: assigneeId ?? undefined,
        dueDate: dateInputToIso(dueDate),
      }),
    onSuccess: async (task) => {
      await queryClient.invalidateQueries({ queryKey: ['tasks'] });
      await queryClient.invalidateQueries({ queryKey: ['recordings'] });
      await queryClient.invalidateQueries({ queryKey: ['recording', recording.id] });
      onOpenChange(false);
      toast.success(t('created'), {
        action: { label: t('viewTask'), onClick: () => router.push(`/tasks/${task.id}`) },
      });
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
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {formError !== null ? (
            <p role="alert" className="text-sm text-destructive">
              {formError}
            </p>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="recToTask-title">{t('taskTitle')}</Label>
            <Input
              id="recToTask-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="recToTask-assignee">{t('assignee')}</Label>
              <Select
                value={assigneeId ?? NONE}
                onValueChange={(value) => setAssigneeId(value === NONE ? null : value)}
              >
                <SelectTrigger id="recToTask-assignee" aria-label={t('assignee')}>
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
            </div>
            <div className="space-y-2">
              <Label htmlFor="recToTask-dueDate">{t('dueDate')}</Label>
              <Input
                id="recToTask-dueDate"
                type="date"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
              />
            </div>
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
              {t('create')}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
