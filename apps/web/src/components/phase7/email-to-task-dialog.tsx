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

function dateInputToIso(value: string): string | null {
  return value ? new Date(`${value}T00:00:00.000Z`).toISOString() : null;
}

/** Converts a thread into a task (title/assignee/due date) and opens it. */
export function EmailToTaskDialog({
  open,
  onOpenChange,
  thread,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  thread: EmailThreadDetailDto;
}) {
  const t = useTranslations('email.toTaskDialog');
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
    setTitle(thread.subject);
    setAssigneeId(null);
    setDueDate('');
    setFormError(null);
  }, [open, thread]);

  const membersQuery = useQuery({
    queryKey: ['members', 'options'],
    queryFn: () => api.members.list({ page: 1, pageSize: 100 }),
    enabled: open && can(session, 'members.read'),
  });

  const mutation = useMutation({
    mutationFn: () =>
      api.email.toTask(thread.id, {
        title: title.trim().length > 0 ? title.trim() : undefined,
        assigneeId,
        dueDate: dateInputToIso(dueDate),
      }),
    onSuccess: async (task) => {
      await queryClient.invalidateQueries({ queryKey: ['tasks'] });
      await queryClient.invalidateQueries({ queryKey: ['emailThreads'] });
      await queryClient.invalidateQueries({ queryKey: ['emailThread', thread.id] });
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
            <Label htmlFor="toTask-title">{t('taskTitle')}</Label>
            <Input
              id="toTask-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="toTask-assignee">{t('assignee')}</Label>
              <Select
                value={assigneeId ?? NONE}
                onValueChange={(value) => setAssigneeId(value === NONE ? null : value)}
              >
                <SelectTrigger id="toTask-assignee" aria-label={t('assignee')}>
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
              <Label htmlFor="toTask-dueDate">{t('dueDate')}</Label>
              <Input
                id="toTask-dueDate"
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
