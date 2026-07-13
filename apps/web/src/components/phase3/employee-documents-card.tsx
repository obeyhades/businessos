'use client';

import {
  ALLOWED_ATTACHMENT_TYPES,
  EMPLOYEE_DOCUMENT_CATEGORIES,
  MAX_ATTACHMENT_BYTES,
  type EmployeeDocumentCategory,
  type EmployeeDocumentDto,
} from '@businessos/types';
import {
  Badge,
  Button,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@businessos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileText, Trash2, Upload } from 'lucide-react';
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

export function EmployeeDocumentsCard({
  employeeId,
  canManage,
  canReadSensitive,
}: {
  employeeId: string;
  canManage: boolean;
  canReadSensitive: boolean;
}) {
  const t = useTranslations('employeeDocuments');
  const tCategory = useTranslations('documentCategory');
  const tCommon = useTranslations('common');
  const format = useFormatter();
  const queryClient = useQueryClient();
  const errorMessage = useApiErrorMessage();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [category, setCategory] = useState<EmployeeDocumentCategory>('CONTRACT');
  const [sensitive, setSensitive] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<EmployeeDocumentDto | null>(null);

  const queryKey = ['employee-documents', employeeId] as const;
  const documentsQuery = useQuery({
    queryKey,
    queryFn: () => api.employeeDocuments.list(employeeId),
  });

  const uploadMutation = useMutation({
    mutationFn: (selected: File) =>
      api.employeeDocuments.upload(employeeId, selected, { category, sensitive }),
    onSuccess: async () => {
      toast.success(t('uploaded'));
      resetUpload();
      await queryClient.invalidateQueries({ queryKey });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const downloadMutation = useMutation({
    mutationFn: (documentId: string) => api.employeeDocuments.downloadUrl(employeeId, documentId),
    onSuccess: (result) => window.open(result.url, '_blank', 'noopener,noreferrer'),
    onError: (error) => toast.error(errorMessage(error)),
  });

  const deleteMutation = useMutation({
    mutationFn: (documentId: string) => api.employeeDocuments.remove(employeeId, documentId),
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

  function resetUpload() {
    setUploadOpen(false);
    setFile(null);
    setCategory('CONTRACT');
    setSensitive(false);
  }

  function onFileSelected(selected: File | undefined) {
    if (!selected) return;
    if (!(ALLOWED_ATTACHMENT_TYPES as readonly string[]).includes(selected.type)) {
      toast.error(t('invalidType'));
      return;
    }
    if (selected.size > MAX_ATTACHMENT_BYTES) {
      toast.error(t('tooLarge', { max: formatBytes(MAX_ATTACHMENT_BYTES) }));
      return;
    }
    setFile(selected);
  }

  return (
    <div className="space-y-4">
      {canManage ? (
        <Button type="button" variant="outline" size="sm" onClick={() => setUploadOpen(true)}>
          <Upload aria-hidden="true" />
          {t('upload')}
        </Button>
      ) : null}

      {documentsQuery.isPending ? (
        <ListSkeleton rows={2} />
      ) : documentsQuery.isError ? (
        <ErrorState
          message={errorMessage(documentsQuery.error)}
          onRetry={() => void documentsQuery.refetch()}
        />
      ) : documentsQuery.data.length === 0 ? (
        <EmptyState title={t('empty')} />
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {documentsQuery.data.map((document) => (
            <li key={document.id} className="flex items-center gap-3 p-3">
              <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-medium">{document.fileName}</span>
                  <Badge variant="outline">{tCategory(document.category)}</Badge>
                  {document.isSensitive ? (
                    <Badge variant="secondary">{t('sensitiveBadge')}</Badge>
                  ) : null}
                </div>
                <p className="text-xs text-muted-foreground">
                  {t('meta', {
                    size: formatBytes(document.size),
                    author: document.uploadedBy?.name ?? t('unknownUploader'),
                    date: format.dateTime(new Date(document.createdAt), { dateStyle: 'medium' }),
                  })}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t('download')}
                loading={downloadMutation.isPending && downloadMutation.variables === document.id}
                onClick={() => downloadMutation.mutate(document.id)}
              >
                <Download aria-hidden="true" />
              </Button>
              {canManage ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={t('delete')}
                  onClick={() => setDeleteTarget(document)}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canManage ? (
        <>
          <Dialog
            open={uploadOpen}
            onOpenChange={(next) =>
              uploadMutation.isPending ? undefined : next ? setUploadOpen(true) : resetUpload()
            }
          >
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t('upload')}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
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
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload aria-hidden="true" />
                    {file ? file.name : t('upload')}
                  </Button>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="document-category">{t('category')}</Label>
                  <Select
                    value={category}
                    onValueChange={(value) => setCategory(value as EmployeeDocumentCategory)}
                  >
                    <SelectTrigger id="document-category" aria-label={t('category')}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {EMPLOYEE_DOCUMENT_CATEGORIES.map((value) => (
                        <SelectItem key={value} value={value}>
                          {tCategory(value)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4 rounded border-border"
                    checked={sensitive}
                    disabled={!canReadSensitive}
                    onChange={(event) => setSensitive(event.target.checked)}
                  />
                  {t('markSensitive')}
                </label>
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  disabled={uploadMutation.isPending}
                  onClick={resetUpload}
                >
                  {tCommon('cancel')}
                </Button>
                <Button
                  type="button"
                  loading={uploadMutation.isPending}
                  disabled={!file}
                  onClick={() => {
                    if (file) uploadMutation.mutate(file);
                  }}
                >
                  {t('upload')}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

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
        </>
      ) : null}
    </div>
  );
}
