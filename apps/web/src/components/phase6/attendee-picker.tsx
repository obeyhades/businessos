'use client';

import type { AttendeeDto } from '@businessos/types';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { api } from '@/lib/api';
import { can, useSession } from '@/lib/session';
import { RsvpBadge } from './calendar-indicators';

/**
 * Multi-select of org members for an event's attendees. Value is a list of user
 * ids. When `responses` is provided (edit mode) each already-invited attendee's
 * RSVP is shown next to their name.
 */
export function AttendeePicker({
  value,
  onChange,
  responses,
}: {
  value: string[];
  onChange: (value: string[]) => void;
  responses?: AttendeeDto[];
}) {
  const t = useTranslations('calendar');
  const { data: session } = useSession();
  const canReadMembers = can(session, 'members.read');

  const membersQuery = useQuery({
    queryKey: ['members', 'options'],
    queryFn: () => api.members.list({ page: 1, pageSize: 100 }),
    enabled: canReadMembers,
  });

  const responseByUser = new Map((responses ?? []).map((a) => [a.userId, a.response]));

  function toggle(userId: string, checked: boolean) {
    if (checked) onChange([...new Set([...value, userId])]);
    else onChange(value.filter((id) => id !== userId));
  }

  if (!canReadMembers) {
    return <p className="text-sm text-muted-foreground">{t('attendeesRestricted')}</p>;
  }

  const members = membersQuery.data?.items ?? [];

  return (
    <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border border-border p-2">
      {membersQuery.isPending ? (
        <p className="p-2 text-sm text-muted-foreground">{t('loadingMembers')}</p>
      ) : members.length === 0 ? (
        <p className="p-2 text-sm text-muted-foreground">{t('noMembers')}</p>
      ) : (
        members.map((member) => {
          const checked = value.includes(member.user.id);
          const response = responseByUser.get(member.user.id);
          return (
            <label
              key={member.user.id}
              className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
            >
              <input
                type="checkbox"
                className="size-4 shrink-0 rounded border-input"
                checked={checked}
                onChange={(event) => toggle(member.user.id, event.target.checked)}
              />
              <span className="min-w-0 flex-1 truncate">{member.user.name}</span>
              {response ? <RsvpBadge response={response} /> : null}
            </label>
          );
        })
      )}
    </div>
  );
}
