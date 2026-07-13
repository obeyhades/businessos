'use client';

import type { ActivityDto, Paginated } from '@businessos/types';
import { useQuery, type QueryKey } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { EmptyState, ErrorState, ListSkeleton } from '@/components/data-states';
import { useApiErrorMessage } from '@/lib/errors';

/** next-intl forbids "." in message keys; activity types use "_" in catalogs. */
function messageKey(type: ActivityDto['type']): string {
  return type.replaceAll('.', '_');
}

export function ActivityTimeline({
  queryKey,
  queryFn,
}: {
  queryKey: QueryKey;
  queryFn: () => Promise<Paginated<ActivityDto>>;
}) {
  const t = useTranslations('activity');
  const tTypes = useTranslations('activityTypes');
  const format = useFormatter();
  const errorMessage = useApiErrorMessage();

  const activityQuery = useQuery({ queryKey, queryFn });

  if (activityQuery.isPending) return <ListSkeleton rows={4} />;
  if (activityQuery.isError) {
    return (
      <ErrorState
        message={errorMessage(activityQuery.error)}
        onRetry={() => void activityQuery.refetch()}
      />
    );
  }
  if (activityQuery.data.items.length === 0) {
    return <EmptyState title={t('empty')} />;
  }

  return (
    <ol className="space-y-4">
      {activityQuery.data.items.map((activity) => (
        <li key={activity.id} className="flex gap-3">
          <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-sm">
              {tTypes(messageKey(activity.type), { actor: activity.actor?.name ?? t('someone') })}
            </p>
            <p className="text-xs text-muted-foreground">
              {format.relativeTime(new Date(activity.createdAt))}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
