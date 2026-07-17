'use client';

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from '@businessos/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Circle, Square, Upload } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ErrorState } from '@/components/data-states';
import { TextField } from '@/components/form-field';
import type { BusinessLinks } from '@/components/phase6/business-link-fields';
import { BusinessLinkFields } from '@/components/phase6/business-link-fields';
import { dateTimeInputToIso, isoToDateTimeInput } from '@/components/phase6/calendar-utils';
import { api } from '@/lib/api';
import { useApiErrorMessage } from '@/lib/errors';
import { formatDuration } from './recording-utils';

function canUseRecorder(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof MediaRecorder !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    navigator.mediaDevices !== undefined &&
    typeof navigator.mediaDevices.getUserMedia === 'function'
  );
}

function emptyLinks(): BusinessLinks {
  return { customerId: null, projectId: null, taskId: null };
}

/**
 * Upload a voice note as a file or record one in-browser via MediaRecorder
 * (produces audio/webm). Falls back to file-only when recording is unavailable
 * or the microphone is denied.
 */
export function UploadVoiceNoteDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('recordings.upload');
  const tCommon = useTranslations('common');
  const queryClient = useQueryClient();
  const errorMessage = useApiErrorMessage();
  const router = useRouter();

  const [title, setTitle] = useState('');
  const [occurredAt, setOccurredAt] = useState('');
  const [links, setLinks] = useState<BusinessLinks>(emptyLinks);
  const [file, setFile] = useState<File | null>(null);
  const [durationSeconds, setDurationSeconds] = useState<number | null>(null);
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [canRecord, setCanRecord] = useState(false);
  const [recordError, setRecordError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const urlRef = useRef<string | null>(null);

  const teardownHardware = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (recorderRef.current !== null && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    }
    recorderRef.current = null;
    if (streamRef.current !== null) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (urlRef.current !== null) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (open) {
      setTitle('');
      setOccurredAt(isoToDateTimeInput(new Date().toISOString()));
      setLinks(emptyLinks());
      setFile(null);
      setDurationSeconds(null);
      setRecordedUrl(null);
      setRecording(false);
      setElapsed(0);
      setCanRecord(canUseRecorder());
      setRecordError(null);
      setError(null);
      return;
    }
    teardownHardware();
  }, [open, teardownHardware]);

  useEffect(() => () => teardownHardware(), [teardownHardware]);

  async function startRecording(): Promise<void> {
    setRecordError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        const recordedFile = new File([blob], `voice-note-${Date.now()}.webm`, {
          type: 'audio/webm',
        });
        setFile(recordedFile);
        if (urlRef.current !== null) URL.revokeObjectURL(urlRef.current);
        const url = URL.createObjectURL(blob);
        urlRef.current = url;
        setRecordedUrl(url);
        if (streamRef.current !== null) {
          streamRef.current.getTracks().forEach((track) => track.stop());
          streamRef.current = null;
        }
      };
      recorder.start();
      recorderRef.current = recorder;
      setElapsed(0);
      setRecording(true);
      timerRef.current = window.setInterval(() => {
        setElapsed((value) => {
          const next = value + 1;
          setDurationSeconds(next);
          return next;
        });
      }, 1000);
    } catch {
      setRecordError(t('micDenied'));
      setCanRecord(false);
      if (streamRef.current !== null) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
    }
  }

  function stopRecording(): void {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (recorderRef.current !== null && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    }
    recorderRef.current = null;
    setRecording(false);
  }

  function onPickFile(event: React.ChangeEvent<HTMLInputElement>): void {
    const picked = event.target.files?.[0] ?? null;
    if (urlRef.current !== null) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    setRecordedUrl(null);
    setDurationSeconds(null);
    setFile(picked);
  }

  const mutation = useMutation({
    mutationFn: () => {
      if (file === null) throw new Error('no_file');
      return api.recordings.uploadVoiceNote(file, {
        title: title.trim(),
        durationSeconds: durationSeconds ?? undefined,
        occurredAt: occurredAt ? dateTimeInputToIso(occurredAt) : undefined,
        customerId: links.customerId ?? undefined,
        projectId: links.projectId ?? undefined,
        taskId: links.taskId ?? undefined,
      });
    },
    onSuccess: async (recordingDto) => {
      toast.success(t('uploaded'));
      await queryClient.invalidateQueries({ queryKey: ['recordings'] });
      onOpenChange(false);
      router.push(`/recordings/${recordingDto.id}`);
    },
    onError: (err) => setError(errorMessage(err)),
  });

  function submit(): void {
    setError(null);
    if (!title.trim()) {
      setError(t('titleRequired'));
      return;
    }
    if (file === null) {
      setError(t('noSource'));
      return;
    }
    mutation.mutate();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (mutation.isPending ? undefined : onOpenChange(next))}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {error ? <ErrorState message={error} /> : null}

          <TextField
            id="upload-title"
            label={t('titleLabel')}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />

          <div className="space-y-2">
            <Label htmlFor="upload-file">{t('file')}</Label>
            <Input
              id="upload-file"
              type="file"
              accept="audio/*"
              onChange={onPickFile}
              disabled={recording}
            />
            {file !== null ? (
              <p className="text-sm text-muted-foreground">
                {t('selectedFile', { name: file.name })}
              </p>
            ) : null}
          </div>

          {canRecord ? (
            <div className="space-y-2 rounded-lg border border-border p-4">
              <Label>{t('record')}</Label>
              <div className="flex flex-wrap items-center gap-3">
                {recording ? (
                  <Button type="button" variant="destructive" onClick={stopRecording}>
                    <Square aria-hidden="true" />
                    {t('stopRecording')}
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void startRecording()}
                  >
                    <Circle aria-hidden="true" />
                    {recordedUrl !== null ? t('rerecord') : t('startRecording')}
                  </Button>
                )}
                {recording ? (
                  <span className="text-sm text-muted-foreground" aria-live="polite">
                    {t('recording')} {formatDuration(elapsed)}
                  </span>
                ) : recordedUrl !== null ? (
                  <span className="text-sm text-muted-foreground">
                    {t('recorded', { duration: formatDuration(durationSeconds) ?? '0:00' })}
                  </span>
                ) : null}
              </div>
              {recordedUrl !== null && !recording ? (
                <audio className="w-full" controls src={recordedUrl} />
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {recordError ?? t('recordUnavailable')}
            </p>
          )}
          {canRecord && recordError !== null ? (
            <p role="alert" className="text-sm text-destructive">
              {recordError}
            </p>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="upload-occurredAt">{t('occurredAt')}</Label>
            <input
              id="upload-occurredAt"
              type="datetime-local"
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={occurredAt}
              onChange={(event) => setOccurredAt(event.target.value)}
            />
          </div>

          <BusinessLinkFields value={links} onChange={setLinks} enabled={open} />
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
          <Button
            type="button"
            loading={mutation.isPending}
            disabled={recording}
            onClick={submit}
          >
            <Upload aria-hidden="true" />
            {t('submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
