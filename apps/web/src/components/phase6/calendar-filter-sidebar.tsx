'use client';

import type { CalendarDto } from '@businessos/types';
import { Button, ConfirmDialog } from '@businessos/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { ListSkeleton } from '@/components/data-states';
import { api } from '@/lib/api';
import { useApiErrorMessage } from '@/lib/errors';
import { CalendarFormDialog } from './calendar-form-dialog';

/**
 * Sidebar listing the org's calendars with per-calendar visibility toggles and
 * color dots, a "my events only" toggle, and (for managers) calendar CRUD.
 */
export function CalendarFilterSidebar({
  calendars,
  isLoading,
  hiddenCalendarIds,
  onToggleCalendar,
  mine,
  onToggleMine,
  canManage,
}: {
  calendars: CalendarDto[];
  isLoading: boolean;
  hiddenCalendarIds: Set<string>;
  onToggleCalendar: (calendarId: string) => void;
  mine: boolean;
  onToggleMine: () => void;
  canManage: boolean;
}) {
  const t = useTranslations('calendar');
  const tCommon = useTranslations('common');
  const queryClient = useQueryClient();
  const errorMessage = useApiErrorMessage();

  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<CalendarDto | undefined>(undefined);
  const [deleteTarget, setDeleteTarget] = useState<CalendarDto | undefined>(undefined);

  const deleteMutation = useMutation({
    mutationFn: (calendarId: string) => api.calendar.removeCalendar(calendarId),
    onSuccess: async () => {
      toast.success(t('calendars.deleted'));
      setDeleteTarget(undefined);
      await queryClient.invalidateQueries({ queryKey: ['calendars'] });
      await queryClient.invalidateQueries({ queryKey: ['events'] });
    },
    onError: (err) => {
      toast.error(errorMessage(err));
      setDeleteTarget(undefined);
    },
  });

  return (
    <aside className="space-y-4">
      <div>
        <Button
          type="button"
          variant={mine ? 'default' : 'outline'}
          size="sm"
          aria-pressed={mine}
          className="w-full"
          onClick={onToggleMine}
        >
          {t('myEventsOnly')}
        </Button>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {t('calendars.heading')}
          </h2>
          {canManage ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t('calendars.new')}
              onClick={() => setCreateOpen(true)}
            >
              <Plus aria-hidden="true" />
            </Button>
          ) : null}
        </div>

        {isLoading ? (
          <ListSkeleton rows={3} />
        ) : calendars.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('calendars.empty')}</p>
        ) : (
          <ul className="space-y-1">
            {calendars.map((calendar) => {
              const visible = !hiddenCalendarIds.has(calendar.id);
              return (
                <li key={calendar.id} className="group flex items-center gap-2">
                  <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-sm hover:bg-accent">
                    <input
                      type="checkbox"
                      className="size-4 shrink-0 rounded border-input"
                      checked={visible}
                      onChange={() => onToggleCalendar(calendar.id)}
                    />
                    <span
                      aria-hidden="true"
                      className="size-3 shrink-0 rounded-full"
                      style={{ backgroundColor: calendar.color }}
                    />
                    <span className="min-w-0 flex-1 truncate">{calendar.name}</span>
                  </label>
                  {canManage ? (
                    <span className="flex items-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        aria-label={t('calendars.edit')}
                        onClick={() => setEditTarget(calendar)}
                      >
                        <Pencil aria-hidden="true" className="size-3.5" />
                      </Button>
                      {!calendar.isDefault ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          aria-label={t('calendars.delete')}
                          onClick={() => setDeleteTarget(calendar)}
                        >
                          <Trash2 aria-hidden="true" className="size-3.5" />
                        </Button>
                      ) : null}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <CalendarFormDialog open={createOpen} onOpenChange={setCreateOpen} />
      <CalendarFormDialog
        open={editTarget !== undefined}
        onOpenChange={(next) => (next ? undefined : setEditTarget(undefined))}
        calendar={editTarget}
      />
      <ConfirmDialog
        open={deleteTarget !== undefined}
        onOpenChange={(next) => (next ? undefined : setDeleteTarget(undefined))}
        title={t('calendars.deleteTitle')}
        description={t('calendars.deleteConfirm', { name: deleteTarget?.name ?? '' })}
        confirmLabel={t('calendars.delete')}
        cancelLabel={tCommon('cancel')}
        destructive
        pending={deleteMutation.isPending}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
      />
    </aside>
  );
}
