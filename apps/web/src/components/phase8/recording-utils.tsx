'use client';

import type { RecordingSource, TranscriptStatus } from '@businessos/types';
import { Badge, type BadgeProps } from '@businessos/ui';
import { Mic, Phone } from 'lucide-react';
import { useTranslations } from 'next-intl';

type Variant = NonNullable<BadgeProps['variant']>;

const transcriptStatusVariant: Record<TranscriptStatus, Variant> = {
  NONE: 'outline',
  PENDING: 'secondary',
  COMPLETED: 'default',
  FAILED: 'destructive',
};

function pad2(value: number): string {
  return value.toString().padStart(2, '0');
}

/** Formats a duration in seconds as `m:ss` (or `h:mm:ss`). Returns null when unknown. */
export function formatDuration(seconds: number | null | undefined): string | null {
  if (seconds === null || seconds === undefined) return null;
  const total = Math.max(0, Math.round(seconds));
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return hrs > 0 ? `${hrs}:${pad2(mins)}:${pad2(secs)}` : `${mins}:${pad2(secs)}`;
}

/** Formats a transcript-segment offset (milliseconds) as `m:ss`. */
export function formatSegmentTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${pad2(secs)}`;
}

/** Source icon (microphone for voice notes, phone for calls). */
export function RecordingSourceIcon({
  source,
  className,
}: {
  source: RecordingSource;
  className?: string;
}) {
  const Icon = source === 'CALL' ? Phone : Mic;
  return <Icon className={className} aria-hidden="true" />;
}

/** Localized badge reflecting the transcript pipeline state. */
export function TranscriptStatusBadge({ status }: { status: TranscriptStatus }) {
  const t = useTranslations('recordings.transcriptStatus');
  return <Badge variant={transcriptStatusVariant[status]}>{t(status)}</Badge>;
}
