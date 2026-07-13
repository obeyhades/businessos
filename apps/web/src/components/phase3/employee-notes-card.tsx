'use client';

import type { EmployeeNoteDto } from '@businessos/types';
import { Avatar, AvatarFallback, Button, ConfirmDialog, Textarea } from '@businessos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { EmptyState, ErrorState, ListSkeleton } from '@/components/data-states';
import { api } from '@/lib/api';
import { useApiErrorMessage } from '@/lib/errors';

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

/**
 * Internal notes are restricted to personnel.read_sensitive on both read and
 * write; the parent only mounts this card when that permission is present.
 */
export function EmployeeNotesCard({ employeeId }: { employeeId: string }) {
  const t = useTranslations('employeeNotes');
  const tCommon = useTranslations('common');
  const format = useFormatter();
  const queryClient = useQueryClient();
  const errorMessage = useApiErrorMessage();

  const [draft, setDraft] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<EmployeeNoteDto | null>(null);

  const queryKey = ['employee-notes', employeeId] as const;
  const notesQuery = useQuery({
    queryKey,
    queryFn: () => api.employeeNotes.list(employeeId),
  });

  const createMutation = useMutation({
    mutationFn: (body: string) => api.employeeNotes.create(employeeId, { body }),
    onSuccess: async () => {
      setDraft('');
      await queryClient.invalidateQueries({ queryKey });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const deleteMutation = useMutation({
    mutationFn: (noteId: string) => api.employeeNotes.remove(employeeId, noteId),
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

      {notesQuery.isPending ? (
        <ListSkeleton rows={2} />
      ) : notesQuery.isError ? (
        <ErrorState
          message={errorMessage(notesQuery.error)}
          onRetry={() => void notesQuery.refetch()}
        />
      ) : notesQuery.data.length === 0 ? (
        <EmptyState title={t('empty')} />
      ) : (
        <ul className="space-y-4">
          {notesQuery.data.map((note) => {
            const authorName = note.author?.name ?? t('unknownAuthor');
            return (
              <li key={note.id} className="flex gap-3">
                <Avatar className="size-8 shrink-0">
                  <AvatarFallback>{initials(authorName)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{authorName}</span>
                    <span className="text-xs text-muted-foreground">
                      {format.relativeTime(new Date(note.createdAt))}
                    </span>
                    <button
                      type="button"
                      className="ml-auto text-xs text-muted-foreground hover:text-destructive"
                      onClick={() => setDeleteTarget(note)}
                    >
                      {t('delete')}
                    </button>
                  </div>
                  <p className="whitespace-pre-wrap break-words text-sm">{note.body}</p>
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
