'use client';

import type { RecordingDto } from '@businessos/types';
import { Button, Spinner } from '@businessos/ui';
import { useTranslations } from 'next-intl';
import { EmptyState } from '@/components/data-states';
import { formatSegmentTime } from './recording-utils';

/**
 * Renders a recording's transcript: a live "transcribing" state while pending,
 * an error + retry affordance on failure, segments (or plain text) when ready.
 */
export function TranscriptView({
  recording,
  canManage,
  onRetry,
  retrying,
}: {
  recording: RecordingDto;
  canManage: boolean;
  onRetry: () => void;
  retrying: boolean;
}) {
  const t = useTranslations('recordings.detail');

  if (recording.transcriptStatus === 'PENDING') {
    return (
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <Spinner className="size-4" />
        <span aria-live="polite">{t('transcriptPending')}</span>
      </div>
    );
  }

  if (recording.transcriptStatus === 'FAILED') {
    return (
      <div className="space-y-3">
        <p role="alert" className="text-sm text-destructive">
          {recording.transcriptError ?? t('transcriptFailedTitle')}
        </p>
        {recording.hasAudio && canManage ? (
          <Button type="button" variant="outline" size="sm" loading={retrying} onClick={onRetry}>
            {t('retry')}
          </Button>
        ) : null}
      </div>
    );
  }

  if (recording.segments.length > 0) {
    const segments = [...recording.segments].sort((a, b) => a.sortOrder - b.sortOrder);
    return (
      <ul className="space-y-3">
        {segments.map((segment) => (
          <li key={segment.id} className="flex gap-3 text-sm">
            <span className="shrink-0 pt-0.5 font-mono text-xs tabular-nums text-muted-foreground">
              {formatSegmentTime(segment.startMs)}
            </span>
            <span className="min-w-0">
              {segment.speaker !== null ? (
                <span className="mr-1 font-medium">
                  {t('speaker', { speaker: segment.speaker })}:
                </span>
              ) : null}
              <span className="whitespace-pre-wrap break-words">{segment.text}</span>
            </span>
          </li>
        ))}
      </ul>
    );
  }

  if (recording.transcriptText !== null && recording.transcriptText.length > 0) {
    return <p className="whitespace-pre-wrap break-words text-sm">{recording.transcriptText}</p>;
  }

  return <EmptyState title={t('transcriptNone')} />;
}
