'use client';

import type { CommentDto, EntityKind } from '@businessos/types';
import { Avatar, AvatarFallback, Button, ConfirmDialog, Textarea } from '@businessos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { EmptyState, ErrorState, ListSkeleton } from '@/components/data-states';
import { api } from '@/lib/api';
import { useApiErrorMessage } from '@/lib/errors';
import { useSession } from '@/lib/session';

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export function CommentsSection({
  kind,
  entityId,
  canManage,
}: {
  kind: EntityKind;
  entityId: string;
  canManage: boolean;
}) {
  const t = useTranslations('comments');
  const tCommon = useTranslations('common');
  const format = useFormatter();
  const queryClient = useQueryClient();
  const errorMessage = useApiErrorMessage();
  const { data: session } = useSession();

  const [draft, setDraft] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<CommentDto | null>(null);

  const queryKey = ['comments', kind, entityId] as const;
  const commentsQuery = useQuery({
    queryKey,
    queryFn: () => api.comments.list(kind, entityId),
  });

  const createMutation = useMutation({
    mutationFn: (body: string) => api.comments.create(kind, entityId, body),
    onSuccess: async () => {
      setDraft('');
      await queryClient.invalidateQueries({ queryKey });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const deleteMutation = useMutation({
    mutationFn: (commentId: string) => api.comments.remove(kind, entityId, commentId),
    onSuccess: async () => {
      toast.success(t('deleted'));
      setDeleteTarget(null);
      await queryClient.invalidateQueries({ queryKey });
    },
    onError: (error) => {
      toast.error(errorMessage(error));
      setDeleteTarget(null);
    },
  });

  const trimmed = draft.trim();

  return (
    <div className="space-y-4">
      <form
        className="space-y-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (trimmed.length > 0) createMutation.mutate(trimmed);
        }}
      >
        <Textarea
          aria-label={t('addPlaceholder')}
          placeholder={t('addPlaceholder')}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <div className="flex justify-end">
          <Button
            type="submit"
            size="sm"
            loading={createMutation.isPending}
            disabled={trimmed.length === 0}
          >
            {t('submit')}
          </Button>
        </div>
      </form>

      {commentsQuery.isPending ? (
        <ListSkeleton rows={3} />
      ) : commentsQuery.isError ? (
        <ErrorState
          message={errorMessage(commentsQuery.error)}
          onRetry={() => void commentsQuery.refetch()}
        />
      ) : commentsQuery.data.length === 0 ? (
        <EmptyState title={t('empty')} />
      ) : (
        <ul className="space-y-4">
          {commentsQuery.data.map((comment) => {
            const authorName = comment.author?.name ?? t('unknownAuthor');
            const canDelete = canManage || comment.author?.id === session?.user.id;
            return (
              <li key={comment.id} className="flex gap-3">
                <Avatar className="size-8 shrink-0">
                  <AvatarFallback>{initials(authorName)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{authorName}</span>
                    <span className="text-xs text-muted-foreground">
                      {format.relativeTime(new Date(comment.createdAt))}
                    </span>
                    {canDelete ? (
                      <button
                        type="button"
                        className="ml-auto text-xs text-muted-foreground hover:text-destructive"
                        onClick={() => setDeleteTarget(comment)}
                      >
                        {t('delete')}
                      </button>
                    ) : null}
                  </div>
                  <p className="whitespace-pre-wrap break-words text-sm">{comment.body}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title={t('deleteTitle')}
        description={t('deleteDescription')}
        confirmLabel={t('delete')}
        cancelLabel={tCommon('cancel')}
        destructive
        pending={deleteMutation.isPending}
        onConfirm={() => {
          if (deleteTarget) deleteMutation.mutate(deleteTarget.id);
        }}
      />
    </div>
  );
}
