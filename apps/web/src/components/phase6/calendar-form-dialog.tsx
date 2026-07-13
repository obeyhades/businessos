'use client';

import type { CalendarDto, CalendarType } from '@businessos/types';
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@businessos/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ErrorState } from '@/components/data-states';
import { TextField } from '@/components/form-field';
import { api } from '@/lib/api';
import { useApiErrorMessage } from '@/lib/errors';

const TYPES: CalendarType[] = ['TEAM', 'PERSONAL'];
const DEFAULT_COLOR = '#3b82f6';

/** Create or edit a calendar (name, color, type, default flag). */
export function CalendarFormDialog({
  open,
  onOpenChange,
  calendar,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  calendar?: CalendarDto;
}) {
  const t = useTranslations('calendar.calendars');
  const tType = useTranslations('calendar.calendarType');
  const tCommon = useTranslations('common');
  const queryClient = useQueryClient();
  const errorMessage = useApiErrorMessage();
  const isEdit = calendar !== undefined;

  const [name, setName] = useState(calendar?.name ?? '');
  const [color, setColor] = useState(calendar?.color ?? DEFAULT_COLOR);
  const [type, setType] = useState<CalendarType>(calendar?.type ?? 'TEAM');
  const [isDefault, setIsDefault] = useState(calendar?.isDefault ?? false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName(calendar?.name ?? '');
      setColor(calendar?.color ?? DEFAULT_COLOR);
      setType(calendar?.type ?? 'TEAM');
      setIsDefault(calendar?.isDefault ?? false);
      setError(null);
    }
  }, [open, calendar]);

  const mutation = useMutation({
    mutationFn: () =>
      isEdit && calendar
        ? api.calendar.updateCalendar(calendar.id, { name: name.trim(), color, isDefault })
        : api.calendar.createCalendar({ name: name.trim(), color, type }),
    onSuccess: async () => {
      toast.success(isEdit ? t('updated') : t('created'));
      await queryClient.invalidateQueries({ queryKey: ['calendars'] });
      onOpenChange(false);
    },
    onError: (err) => setError(errorMessage(err)),
  });

  function submit() {
    setError(null);
    if (!name.trim()) {
      setError(t('nameRequired'));
      return;
    }
    mutation.mutate();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (mutation.isPending ? undefined : onOpenChange(next))}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? t('editTitle') : t('createTitle')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {error ? <ErrorState message={error} /> : null}

          <TextField
            id="calendar-name"
            label={t('name')}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />

          <div className="space-y-2">
            <Label htmlFor="calendar-color">{t('color')}</Label>
            <div className="flex items-center gap-3">
              <input
                id="calendar-color"
                type="color"
                className="h-9 w-16 cursor-pointer rounded-md border border-input bg-background"
                value={color}
                onChange={(e) => setColor(e.target.value)}
              />
              <span className="text-sm text-muted-foreground">{color}</span>
            </div>
          </div>

          {!isEdit ? (
            <div className="space-y-2">
              <Label htmlFor="calendar-type">{t('type')}</Label>
              <Select value={type} onValueChange={(next) => setType(next as CalendarType)}>
                <SelectTrigger id="calendar-type" aria-label={t('type')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TYPES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {tType(value)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant={isDefault ? 'default' : 'outline'}
                aria-pressed={isDefault}
                onClick={() => setIsDefault((v) => !v)}
              >
                {t('makeDefault')}
              </Button>
            </div>
          )}
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
          <Button type="button" loading={mutation.isPending} onClick={submit}>
            {tCommon('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
