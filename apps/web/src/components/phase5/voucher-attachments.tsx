'use client';

import type { VoucherAttachmentDto } from '@businessos/types';
import { Button, ConfirmDialog } from '@businessos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Paperclip, Trash2 } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
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

export function VoucherAttachments({
  voucherId,
  canManage,
}: {
  voucherId: string;
  canManage: boolean;
}) {
  const t = useTranslations('accounting');
  const tCommon = useTranslations('common');
  const format = useFormatter();
  const queryClient = useQueryClient();
  const errorMessage = useApiErrorMessage();
  const [deleteTarget, setDeleteTarget] = useState<VoucherAttachmentDto | null>(null);

  const queryKey = ['voucher-attachments', voucherId] as const;
  const attachmentsQuery = useQuery({
    queryKey,
    queryFn: () => api.accounting.listVoucherAttachments(voucherId),
  });

  const downloadMutation = useMutation({
    mutationFn: (attachmentId: string) =>
      api.accounting.voucherAttachmentDownloadUrl(voucherId, attachmentId),
    onSuccess: (result) => {
      window.open(result.url, '_blank', 'noopener,noreferrer');
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const deleteMutation = useMutation({
    mutationFn: (attachmentId: string) =>
      api.accounting.removeVoucherAttachment(voucherId, attachmentId),
    onSuccess: async () => {
      toast.success(t('attachmentDeleted'));
      setDeleteTarget(null);
      await queryClient.invalidateQueries({ queryKey });
    },
    onError: (error) => {
      toast.error(errorMessage(error));
      setDeleteTarget(null);
    },
  });

  return (
    <div className="space-y-4">
      {attachmentsQuery.isPending ? (
        <ListSkeleton rows={2} />
      ) : attachmentsQuery.isError ? (
        <ErrorState
          message={errorMessage(attachmentsQuery.error)}
          onRetry={() => void attachmentsQuery.refetch()}
        />
      ) : attachmentsQuery.data.length === 0 ? (
        <EmptyState title={t('noAttachments')} />
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {attachmentsQuery.data.map((attachment) => (
            <li key={attachment.id} className="flex items-center gap-3 p-3">
              <Paperclip className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{attachment.fileName}</p>
                <p className="text-xs text-muted-foreground">
                  {t('attachmentMeta', {
                    size: formatBytes(attachment.size),
                    author: attachment.uploadedByName ?? t('unknownUploader'),
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
                  aria-label={tCommon('remove')}
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
        title={t('deleteAttachmentTitle')}
        description={
          deleteTarget
            ? t('deleteAttachmentDescription', { name: deleteTarget.fileName })
            : undefined
        }
        confirmLabel={tCommon('remove')}
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
