'use client';

import type { EventDto, ReminderInput } from '@businessos/types';
import {
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@businessos/ui';
import { Plus, X } from 'lucide-react';
import { useTranslations } from 'next-intl';

const MAX_REMINDERS = 5;

type Unit = 'minutes' | 'hours' | 'days';

const UNIT_MINUTES: Record<Unit, number> = { minutes: 1, hours: 60, days: 1440 };

export interface ReminderState {
  value: number;
  unit: Unit;
}

export function defaultReminderState(): ReminderState {
  return { value: 15, unit: 'minutes' };
}

function splitMinutes(minutesBefore: number): ReminderState {
  if (minutesBefore > 0 && minutesBefore % 1440 === 0) {
    return { value: minutesBefore / 1440, unit: 'days' };
  }
  if (minutesBefore > 0 && minutesBefore % 60 === 0) {
    return { value: minutesBefore / 60, unit: 'hours' };
  }
  return { value: minutesBefore, unit: 'minutes' };
}

export function remindersFromEvent(event?: EventDto): ReminderState[] {
  return (event?.reminders ?? []).map((r) => splitMinutes(r.minutesBefore));
}

export function toReminderInput(list: ReminderState[]): ReminderInput[] {
  return list.map((r) => ({
    minutesBefore: Math.max(0, Math.round(r.value)) * UNIT_MINUTES[r.unit],
    method: 'EMAIL' as const,
  }));
}

export function ReminderFields({
  value,
  onChange,
}: {
  value: ReminderState[];
  onChange: (value: ReminderState[]) => void;
}) {
  const t = useTranslations('calendar.reminders');
  const units: Unit[] = ['minutes', 'hours', 'days'];

  function update(index: number, patch: Partial<ReminderState>) {
    onChange(value.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }
  function remove(index: number) {
    onChange(value.filter((_, i) => i !== index));
  }
  function add() {
    if (value.length < MAX_REMINDERS) onChange([...value, defaultReminderState()]);
  }

  return (
    <div className="space-y-2">
      <Label>{t('label')}</Label>
      {value.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('none')}</p>
      ) : (
        <ul className="space-y-2">
          {value.map((reminder, index) => (
            <li key={index} className="flex items-center gap-2">
              <Input
                type="number"
                min={0}
                aria-label={t('amount')}
                value={reminder.value}
                onChange={(event) =>
                  update(index, { value: Number.parseInt(event.target.value, 10) || 0 })
                }
                className="w-24"
              />
              <Select
                value={reminder.unit}
                onValueChange={(unit) => update(index, { unit: unit as Unit })}
              >
                <SelectTrigger className="w-32" aria-label={t('unit')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {units.map((unit) => (
                    <SelectItem key={unit} value={unit}>
                      {t(unit)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-sm text-muted-foreground">{t('before')}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t('remove')}
                onClick={() => remove(index)}
              >
                <X aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={add}
        disabled={value.length >= MAX_REMINDERS}
      >
        <Plus aria-hidden="true" />
        {t('add')}
      </Button>
    </div>
  );
}
