'use client';

import type { EventDto, RecurrenceFreq, RecurrenceInput } from '@businessos/types';
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
import { useLocale, useTranslations } from 'next-intl';
import { dateInputToIso, isoToDateInput, weekdayOptions } from './calendar-utils';

const FREQS: RecurrenceFreq[] = ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'];

export type RecurrenceEnds = 'never' | 'count' | 'until';

export interface RecurrenceState {
  freq: 'NONE' | RecurrenceFreq;
  interval: number;
  byWeekday: number[];
  ends: RecurrenceEnds;
  count: number;
  until: string;
}

export function defaultRecurrenceState(): RecurrenceState {
  return { freq: 'NONE', interval: 1, byWeekday: [], ends: 'never', count: 10, until: '' };
}

export function recurrenceStateFromEvent(event?: EventDto): RecurrenceState {
  const r = event?.recurrence;
  if (!r) return defaultRecurrenceState();
  return {
    freq: r.freq,
    interval: r.interval || 1,
    byWeekday: r.byWeekday,
    ends: r.count != null ? 'count' : r.until != null ? 'until' : 'never',
    count: r.count ?? 10,
    until: r.until ? isoToDateInput(r.until) : '',
  };
}

/** Convert builder state into the API recurrence shape (null = no recurrence). */
export function toRecurrenceInput(state: RecurrenceState): RecurrenceInput | null {
  if (state.freq === 'NONE') return null;
  const base = {
    freq: state.freq,
    interval: state.interval >= 1 ? state.interval : 1,
    byWeekday: state.freq === 'WEEKLY' ? state.byWeekday : [],
  };
  if (state.ends === 'count' && state.count >= 1) return { ...base, count: state.count };
  if (state.ends === 'until' && state.until)
    return { ...base, until: dateInputToIso(state.until, true) };
  return base;
}

export function RecurrenceFields({
  value,
  onChange,
}: {
  value: RecurrenceState;
  onChange: (value: RecurrenceState) => void;
}) {
  const t = useTranslations('calendar.recurrence');
  const locale = useLocale();
  const weekdays = weekdayOptions(locale);
  const patch = (next: Partial<RecurrenceState>) => onChange({ ...value, ...next });

  function toggleWeekday(day: number) {
    const has = value.byWeekday.includes(day);
    patch({
      byWeekday: has ? value.byWeekday.filter((d) => d !== day) : [...value.byWeekday, day].sort(),
    });
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor="event-recurrence-freq">{t('label')}</Label>
        <Select
          value={value.freq}
          onValueChange={(freq) => patch({ freq: freq as RecurrenceState['freq'] })}
        >
          <SelectTrigger id="event-recurrence-freq" aria-label={t('label')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="NONE">{t('none')}</SelectItem>
            {FREQS.map((freq) => (
              <SelectItem key={freq} value={freq}>
                {t(freq)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {value.freq !== 'NONE' ? (
        <>
          <div className="space-y-2">
            <Label htmlFor="event-recurrence-interval">{t('interval')}</Label>
            <Input
              id="event-recurrence-interval"
              type="number"
              min={1}
              max={365}
              value={value.interval}
              onChange={(event) =>
                patch({ interval: Number.parseInt(event.target.value, 10) || 1 })
              }
              className="w-24"
            />
          </div>

          {value.freq === 'WEEKLY' ? (
            <div className="space-y-2">
              <Label>{t('onDays')}</Label>
              <div className="flex flex-wrap gap-1.5">
                {weekdays.map((day) => (
                  <Button
                    key={day.value}
                    type="button"
                    size="sm"
                    variant={value.byWeekday.includes(day.value) ? 'default' : 'outline'}
                    aria-pressed={value.byWeekday.includes(day.value)}
                    onClick={() => toggleWeekday(day.value)}
                  >
                    {day.label}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="event-recurrence-ends">{t('ends')}</Label>
            <Select
              value={value.ends}
              onValueChange={(ends) => patch({ ends: ends as RecurrenceEnds })}
            >
              <SelectTrigger id="event-recurrence-ends" aria-label={t('ends')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="never">{t('endsNever')}</SelectItem>
                <SelectItem value="count">{t('endsCount')}</SelectItem>
                <SelectItem value="until">{t('endsUntil')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {value.ends === 'count' ? (
            <div className="space-y-2">
              <Label htmlFor="event-recurrence-count">{t('countLabel')}</Label>
              <Input
                id="event-recurrence-count"
                type="number"
                min={1}
                max={1000}
                value={value.count}
                onChange={(event) => patch({ count: Number.parseInt(event.target.value, 10) || 1 })}
                className="w-28"
              />
            </div>
          ) : null}

          {value.ends === 'until' ? (
            <div className="space-y-2">
              <Label htmlFor="event-recurrence-until">{t('untilLabel')}</Label>
              <Input
                id="event-recurrence-until"
                type="date"
                value={value.until}
                onChange={(event) => patch({ until: event.target.value })}
              />
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
