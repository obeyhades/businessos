'use client';

import {
  ALLOWED_ATTACHMENT_TYPES,
  MAX_ATTACHMENT_BYTES,
  type AttachmentDto,
  type EntityKind,
} from '@businessos/types';
import { Button, ConfirmDialog } from '@businessos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Paperclip, Trash2, Upload } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { EmptyState, ErrorState, ListSkeleton } from '@/components/data-states';
import { api } from '@/lib/api';
import { useApiErrorMessage } from '@/lib/errors';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

export function AttachmentsSection({
  kind,
  entityId,
  canManage,
}: {
  kind: EntityKind;
  entityId: string;
  canManage: boolean;
}) {
  const t = useTranslations('attachments');
  const tCommon = useTranslations('common');
  const format = useFormatter();
  const queryClient = useQueryClient();
  const errorMessage = useApiErrorMessage();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [deleteTarget, setDeleteTarget] = useState<AttachmentDto | null>(null);

  const queryKey = ['attachments', kind, entityId] as const;
  const attachmentsQuery = useQuery({
    queryKey,
    queryFn: () => api.attachments.list(kind, entityId),
  });

  const uploadMutation = useMutation({
    mutationFn: (file: File) => api.attachments.upload(kind, entityId, file),
    onSuccess: async () => {
      toast.success(t('uploaded'));
      await queryClient.invalidateQueries({ queryKey });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const downloadMutation = useMutation({
    mutationFn: (attachmentId: string) => api.attachments.downloadUrl(kind, entityId, attachmentId),
    onSuccess: (result) => {
      window.open(result.url, '_blank', 'noopener,noreferrer');
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const deleteMutation = useMutation({
    mutationFn: (attachmentId: string) => api.attachments.remove(kind, entityId, attachmentId),
    onSuccess: async () => {
      toast.success(t('deleted'));
      setDeleteTarget(null);
      await queryClient.invalidateQueries({ queryKey });
    },
    onError: (error) => {
      toast.error(errorMessage(error));
      setDeleteTarget(null);
    },
  });

  function onFileSelected(file: File | undefined) {
    if (!file) return;
    if (!(ALLOWED_ATTACHMENT_TYPES as readonly string[]).includes(file.type)) {
      toast.error(t('invalidType'));
      return;
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      toast.error(t('tooLarge', { max: formatBytes(MAX_ATTACHMENT_BYTES) }));
      return;
    }
    uploadMutation.mutate(file);
  }

  return (
    <div className="space-y-4">
      {canManage ? (
        <div>
          <input
            ref={fileInputRef}
            type="file"
            className="sr-only"
            aria-hidden="true"
            tabIndex={-1}
            onChange={(event) => {
              onFileSelected(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            loading={uploadMutation.isPending}
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload aria-hidden="true" />
            {t('upload')}
          </Button>
        </div>
      ) : null}

      {attachmentsQuery.isPending ? (
        <ListSkeleton rows={2} />
      ) : attachmentsQuery.isError ? (
        <ErrorState
          message={errorMessage(attachmentsQuery.error)}
          onRetry={() => void attachmentsQuery.refetch()}
        />
      ) : attachmentsQuery.data.length === 0 ? (
        <EmptyState title={t('empty')} />
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {attachmentsQuery.data.map((attachment) => (
            <li key={attachment.id} className="flex items-center gap-3 p-3">
              <Paperclip className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{attachment.fileName}</p>
                <p className="text-xs text-muted-foreground">
                  {t('meta', {
                    size: formatBytes(attachment.size),
                    author: attachment.uploadedBy?.name ?? t('unknownUploader'),
                    date: format.dateTime(new Date(attachment.createdAt), { dateStyle: 'medium' }),
                  })}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t('download')}
                loading={downloadMutation.isPending && downloadMutation.variables === attachment.id}
                onClick={() => downloadMutation.mutate(attachment.id)}
              >
                <Download aria-hidden="true" />
              </Button>
              {canManage ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={t('delete')}
                  onClick={() => setDeleteTarget(attachment)}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title={t('deleteTitle')}
        description={
          deleteTarget ? t('deleteDescription', { name: deleteTarget.fileName }) : undefined
        }
        confirmLabel={t('delete')}
        cancelLabel={tCommon('cancel')}
        destructive
        pending={deleteMutation.isPending}
        onConfirm={() => {
          if (deleteTarget) deleteMutation.mutate(deleteTarget.id);
        }}
      />
    </div>
  );
}
