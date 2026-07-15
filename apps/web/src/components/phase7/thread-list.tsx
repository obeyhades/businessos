'use client';

import type { EmailThreadDto } from '@businessos/types';
import { Badge, cn } from '@businessos/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Star } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useApiErrorMessage } from '@/lib/errors';

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function StarToggle({ thread, disabled }: { thread: EmailThreadDto; disabled: boolean }) {
  const t = useTranslations('email.thread');
  const queryClient = useQueryClient();
  const errorMessage = useApiErrorMessage();

  const starMutation = useMutation({
    mutationFn: () => api.email.star(thread.id, { starred: !thread.isStarred }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['emailThreads'] });
      await queryClient.invalidateQueries({ queryKey: ['emailThread', thread.id] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (disabled) {
    return thread.isStarred ? (
      <Star aria-hidden="true" className="size-4 shrink-0 fill-amber-400 text-amber-400" />
    ) : null;
  }

  return (
    <button
      type="button"
      aria-label={thread.isStarred ? t('unstar') : t('star')}
      aria-pressed={thread.isStarred}
      disabled={starMutation.isPending}
      className="shrink-0 rounded-sm p-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
      onClick={(event) => {
        event.stopPropagation();
        starMutation.mutate();
      }}
    >
      <Star
        aria-hidden="true"
        className={cn(
          'size-4',
          thread.isStarred
            ? 'fill-amber-400 text-amber-400'
            : 'text-muted-foreground hover:text-foreground',
        )}
      />
    </button>
  );
}

/**
 * Middle pane: the thread list for the current folder/label/account filter.
 * Unread threads render bold with a dot; the star toggles inline.
 */
export function ThreadList({
  threads,
  selectedThreadId,
  onSelect,
  canSend,
}: {
  threads: EmailThreadDto[];
  selectedThreadId: string | null;
  onSelect: (threadId: string) => void;
  canSend: boolean;
}) {
  const t = useTranslations('email.list');
  const format = useFormatter();

  const now = new Date();
  const timeLabel = (iso: string): string => {
    const date = new Date(iso);
    return isSameDay(date, now)
      ? format.dateTime(date, { timeStyle: 'short' })
      : format.dateTime(date, { day: 'numeric', month: 'short' });
  };

  return (
    <ul className="divide-y divide-border">
      {threads.map((thread) => {
        const selected = thread.id === selectedThreadId;
        return (
          <li key={thread.id}>
            <button
              type="button"
              aria-current={selected ? 'true' : undefined}
              onClick={() => onSelect(thread.id)}
              className={cn(
                'flex w-full flex-col gap-1 px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                selected ? 'bg-accent' : 'hover:bg-accent/50',
              )}
            >
              <span className="flex items-center gap-2">
                {thread.unread ? (
                  <>
                    <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-primary" />
                    <span className="sr-only">{t('unread')}</span>
                  </>
                ) : null}
                <span
                  className={cn(
                    'min-w-0 flex-1 truncate text-sm',
                    thread.unread ? 'font-semibold' : 'font-medium',
                  )}
                >
                  {thread.subject}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {timeLabel(thread.lastMessageAt)}
                </span>
                <StarToggle thread={thread} disabled={!canSend} />
              </span>
              <span className="flex items-center gap-2">
                <span
                  className={cn(
                    'min-w-0 flex-1 truncate text-xs text-muted-foreground',
                    thread.unread && 'font-medium text-foreground',
                  )}
                >
                  {thread.snippet ?? ''}
                </span>
                {thread.messageCount > 1 ? (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {thread.messageCount}
                  </span>
                ) : null}
              </span>
              {thread.labels.length > 0 ? (
                <span className="flex flex-wrap items-center gap-1">
                  {thread.labels.map((label) => (
                    <Badge key={label.id} variant="outline" className="gap-1 font-normal">
                      <span
                        aria-hidden="true"
                        className="size-2 rounded-full"
                        style={{ backgroundColor: label.color }}
                      />
                      {label.name}
                    </Badge>
                  ))}
                </span>
              ) : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
