'use client';

import type { RecordingDto } from '@businessos/types';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ConfirmDialog,
} from '@businessos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Briefcase,
  CircleCheck,
  ListTodo,
  Pencil,
  ReceiptText,
  RefreshCw,
  Trash2,
  UsersRound,
} from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { ErrorState, ListSkeleton } from '@/components/data-states';
import { EditRecordingDialog } from '@/components/phase8/edit-recording-dialog';
import { RecordingAudioPlayer } from '@/components/phase8/recording-audio-player';
import { RecordingToInvoiceDialog } from '@/components/phase8/recording-to-invoice-dialog';
import { RecordingToTaskDialog } from '@/components/phase8/recording-to-task-dialog';
import {
  formatDuration,
  RecordingSourceIcon,
  TranscriptStatusBadge,
} from '@/components/phase8/recording-utils';
import { TranscriptView } from '@/components/phase8/transcript-view';
import { api } from '@/lib/api';
import { useApiErrorMessage } from '@/lib/errors';
import { can, useSession } from '@/lib/session';

function LinkedChip({ href, icon, label }: { href: string; icon: ReactNode; label: string }) {
  return (
    <Badge variant="outline" className="gap-1 p-0 font-normal">
      <Link
        href={href}
        className="flex items-center gap-1 px-2.5 py-0.5 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {icon}
        {label}
      </Link>
    </Badge>
  );
}

function RecordingDetail({ recording }: { recording: RecordingDto }) {
  const t = useTranslations('recordings');
  const tDetail = useTranslations('recordings.detail');
  const tActions = useTranslations('recordings.actions');
  const tDelete = useTranslations('recordings.delete');
  const tDirection = useTranslations('recordings.direction');
  const tCommon = useTranslations('common');
  const format = useFormatter();
  const router = useRouter();
  const queryClient = useQueryClient();
  const errorMessage = useApiErrorMessage();
  const { data: session } = useSession();
  const canManage = can(session, 'recordings.manage');

  const [editOpen, setEditOpen] = useState(false);
  const [toTaskOpen, setToTaskOpen] = useState(false);
  const [toInvoiceOpen, setToInvoiceOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const customerQuery = useQuery({
    queryKey: ['customer', recording.customerId],
    queryFn: () => api.customers.get(recording.customerId ?? ''),
    enabled: recording.customerId !== null && can(session, 'customers.read'),
  });
  const projectQuery = useQuery({
    queryKey: ['project', recording.projectId],
    queryFn: () => api.projects.get(recording.projectId ?? ''),
    enabled: recording.projectId !== null && can(session, 'projects.read'),
  });
  const taskQuery = useQuery({
    queryKey: ['task', recording.taskId],
    queryFn: () => api.tasks.get(recording.taskId ?? ''),
    enabled: recording.taskId !== null && can(session, 'tasks.read'),
  });

  const retranscribeMutation = useMutation({
    mutationFn: () => api.recordings.retranscribe(recording.id),
    onSuccess: async (updated) => {
      queryClient.setQueryData(['recording', recording.id], updated);
      await queryClient.invalidateQueries({ queryKey: ['recordings'] });
      toast.success(tDetail('retranscribed'));
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.recordings.remove(recording.id),
    onSuccess: async () => {
      toast.success(tDelete('deleted'));
      await queryClient.invalidateQueries({ queryKey: ['recordings'] });
      router.push('/recordings');
    },
    onError: (error) => {
      toast.error(errorMessage(error));
      setDeleteOpen(false);
    },
  });

  const duration = formatDuration(recording.durationSeconds);
  const hasLinks =
    recording.customerId !== null || recording.projectId !== null || recording.taskId !== null;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2 text-muted-foreground">
          <Link href="/recordings">
            <ArrowLeft aria-hidden="true" />
            {t('backToList')}
          </Link>
        </Button>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 space-y-1.5">
            <div className="flex items-center gap-3">
              <RecordingSourceIcon
                source={recording.source}
                className="size-5 shrink-0 text-muted-foreground"
              />
              <h1 className="min-w-0 break-words text-2xl font-semibold tracking-tight">
                {recording.title}
              </h1>
              <TranscriptStatusBadge status={recording.transcriptStatus} />
            </div>
            <p className="text-sm text-muted-foreground">
              {t(`source.${recording.source}`)}
              {' · '}
              {format.dateTime(new Date(recording.occurredAt), {
                dateStyle: 'medium',
                timeStyle: 'short',
              })}
              {duration !== null ? ` · ${duration}` : ''}
            </p>
            {recording.source === 'CALL' ? (
              <p className="text-sm text-muted-foreground">
                {recording.direction !== null ? tDirection(recording.direction) : null}
                {recording.fromNumber !== null
                  ? ` · ${tDetail('from')}: ${recording.fromNumber}`
                  : ''}
                {recording.toNumber !== null ? ` · ${tDetail('to')}: ${recording.toNumber}` : ''}
              </p>
            ) : null}
          </div>

          {canManage ? (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setEditOpen(true)}>
                <Pencil aria-hidden="true" />
                {tActions('edit')}
              </Button>
              {recording.hasAudio ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  loading={retranscribeMutation.isPending}
                  onClick={() => retranscribeMutation.mutate()}
                >
                  <RefreshCw aria-hidden="true" />
                  {tDetail('retranscribe')}
                </Button>
              ) : null}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setToTaskOpen(true)}
              >
                <ListTodo aria-hidden="true" />
                {tActions('toTask')}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={recording.customerId === null}
                onClick={() => setToInvoiceOpen(true)}
              >
                <ReceiptText aria-hidden="true" />
                {tActions('toInvoice')}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2 aria-hidden="true" />
                {tActions('delete')}
              </Button>
              </div>
              {recording.customerId === null ? (
                <p className="text-xs text-muted-foreground">
                  {tDetail('invoiceNeedsCustomer')}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

        {hasLinks ? (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {recording.customerId !== null ? (
              <LinkedChip
                href={`/customers/${recording.customerId}`}
                icon={<UsersRound aria-hidden="true" className="size-3" />}
                label={customerQuery.data?.name ?? tDetail('linkedCustomer')}
              />
            ) : null}
            {recording.projectId !== null ? (
              <LinkedChip
                href={`/projects/${recording.projectId}`}
                icon={<Briefcase aria-hidden="true" className="size-3" />}
                label={projectQuery.data?.name ?? tDetail('linkedProject')}
              />
            ) : null}
            {recording.taskId !== null ? (
              <LinkedChip
                href={`/tasks/${recording.taskId}`}
                icon={<CircleCheck aria-hidden="true" className="size-3" />}
                label={taskQuery.data?.title ?? tDetail('linkedTask')}
              />
            ) : null}
          </div>
        ) : null}
      </div>

      {recording.hasAudio ? (
        <Card>
          <CardHeader>
            <CardTitle>{tDetail('audio')}</CardTitle>
          </CardHeader>
          <CardContent>
            <RecordingAudioPlayer recordingId={recording.id} />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{tDetail('transcript')}</CardTitle>
        </CardHeader>
        <CardContent>
          <TranscriptView
            recording={recording}
            canManage={canManage}
            onRetry={() => retranscribeMutation.mutate()}
            retrying={retranscribeMutation.isPending}
          />
        </CardContent>
      </Card>

      <EditRecordingDialog open={editOpen} onOpenChange={setEditOpen} recording={recording} />
      <RecordingToTaskDialog
        open={toTaskOpen}
        onOpenChange={setToTaskOpen}
        recording={recording}
      />
      <RecordingToInvoiceDialog
        open={toInvoiceOpen}
        onOpenChange={setToInvoiceOpen}
        recording={recording}
      />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={tDelete('title')}
        description={tDelete('description')}
        confirmLabel={tActions('delete')}
        cancelLabel={tCommon('cancel')}
        destructive
        pending={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate()}
      />
    </div>
  );
}

export default function RecordingDetailPage() {
  const params = useParams<{ id: string }>();
  const recordingId = params.id;
  const errorMessage = useApiErrorMessage();

  const recordingQuery = useQuery({
    queryKey: ['recording', recordingId],
    queryFn: () => api.recordings.get(recordingId),
    enabled: Boolean(recordingId),
    // While a transcript is being produced, poll until it settles.
    refetchInterval: (query) =>
      query.state.data?.transcriptStatus === 'PENDING' ? 2000 : false,
  });

  if (recordingQuery.isPending) {
    return (
      <div className="mx-auto max-w-4xl space-y-6">
        <ListSkeleton rows={6} />
      </div>
    );
  }
  if (recordingQuery.isError) {
    return (
      <div className="mx-auto max-w-4xl">
        <ErrorState
          message={errorMessage(recordingQuery.error)}
          onRetry={() => void recordingQuery.refetch()}
        />
      </div>
    );
  }

  return <RecordingDetail recording={recordingQuery.data} />;
}
