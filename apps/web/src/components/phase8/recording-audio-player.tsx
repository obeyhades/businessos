'use client';

import { Spinner } from '@businessos/ui';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useRef } from 'react';
import { ErrorState } from '@/components/data-states';
import { api } from '@/lib/api';
import { useApiErrorMessage } from '@/lib/errors';

/** Give up re-signing after this many consecutive playback errors (avoids a
 *  loop when the object is genuinely gone rather than the URL merely expired). */
const MAX_RECOVERIES = 3;

/**
 * Fetches a short-lived signed audio URL and renders a native audio player.
 * The signed URL expires (~5 min), so a Range request on seek/resume after
 * expiry would 403 and stall playback. On such an error we re-sign and restore
 * the playback position instead of dying.
 */
export function RecordingAudioPlayer({ recordingId }: { recordingId: string }) {
  const tCommon = useTranslations('common');
  const errorMessage = useApiErrorMessage();
  const audioRef = useRef<HTMLAudioElement>(null);
  const recovering = useRef(false);
  const attempts = useRef(0);
  const pendingResume = useRef<{ time: number; play: boolean } | null>(null);

  const audioQuery = useQuery({
    queryKey: ['recording-audio', recordingId],
    queryFn: () => api.recordings.audioUrl(recordingId),
  });

  function handleError() {
    const el = audioRef.current;
    if (!el || recovering.current || attempts.current >= MAX_RECOVERIES) return;
    recovering.current = true;
    attempts.current += 1;
    // Remember where we were; refetch re-signs the URL, React swaps `src`, and
    // onLoadedMetadata restores the position.
    pendingResume.current = { time: el.currentTime, play: !el.paused && !el.ended };
    void audioQuery.refetch().finally(() => {
      recovering.current = false;
    });
  }

  function handleLoadedMetadata() {
    const el = audioRef.current;
    const resume = pendingResume.current;
    if (!el || !resume) return;
    pendingResume.current = null;
    try {
      el.currentTime = resume.time;
    } catch {
      // Ignore if the media isn't seekable yet.
    }
    if (resume.play) void el.play().catch(() => undefined);
  }

  if (audioQuery.isPending) {
    return (
      <div className="flex justify-center py-4">
        <Spinner className="size-5" label={tCommon('loading')} />
      </div>
    );
  }
  if (audioQuery.isError) {
    return (
      <ErrorState
        message={errorMessage(audioQuery.error)}
        onRetry={() => void audioQuery.refetch()}
      />
    );
  }

  return (
    <audio
      ref={audioRef}
      className="w-full"
      controls
      src={audioQuery.data.url}
      onError={handleError}
      onLoadedMetadata={handleLoadedMetadata}
      onPlaying={() => {
        attempts.current = 0;
      }}
    />
  );
}
