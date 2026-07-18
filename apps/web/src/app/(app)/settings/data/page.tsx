'use client';

import type { DataExportJobDto, DataExportStatusDto } from '@businessos/types';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '@businessos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { EmptyState, ErrorState, ListSkeleton } from '@/components/data-states';
import { EraseOrganizationDialog } from '@/components/phase9/erase-organization-dialog';
import { RetentionForm } from '@/components/phase9/retention-form';
import { api } from '@/lib/api';
import { useApiErrorMessage } from '@/lib/errors';
import { activeMembership, can, useSession } from '@/lib/session';

const EXPORT_BADGE_VARIANT: Record<
  DataExportStatusDto,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  PENDING: 'secondary',
  PROCESSING: 'secondary',
  COMPLETED: 'default',
  FAILED: 'destructive',
};

function formatBytes(bytes: number | null): string | null {
  if (bytes === null) return null;
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

function isExpired(job: DataExportJobDto): boolean {
  return job.expiresAt !== null && new Date(job.expiresAt).getTime() <= Date.now();
}

function ExportStatusBadge({ status }: { status: DataExportStatusDto }) {
  const t = useTranslations('compliance.exportStatus');
  return <Badge variant={EXPORT_BADGE_VARIANT[status]}>{t(status)}</Badge>;
}

function ExportSection() {
  const t = useTranslations('compliance.export');
  const format = useFormatter();
  const queryClient = useQueryClient();
  const errorMessage = useApiErrorMessage();

  const exportsQuery = useQuery({
    queryKey: ['exports'],
    queryFn: () => api.compliance.listExports(),
    refetchInterval: (query) => {
      const active = query.state.data?.some(
        (job) => job.status === 'PENDING' || job.status === 'PROCESSING',
      );
      return active ? 3000 : false;
    },
  });

  const requestMutation = useMutation({
    mutationFn: () => api.compliance.requestExport(),
    onSuccess: async () => {
      toast.success(t('requested'));
      await queryClient.invalidateQueries({ queryKey: ['exports'] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const downloadMutation = useMutation({
    mutationFn: (jobId: string) => api.compliance.exportDownloadUrl(jobId),
    onSuccess: (result) => {
      // The signed URL responds with Content-Disposition: attachment, so an
      // anchor click downloads it in-place. Unlike window.open (blocked by
      // Safari/iOS after the async round-trip left the user-gesture window),
      // a programmatic <a download> click is not popup-blocked.
      const a = document.createElement('a');
      a.href = result.url;
      a.rel = 'noopener noreferrer';
      a.download = '';
      document.body.appendChild(a);
      a.click();
      a.remove();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const jobs = exportsQuery.data ?? [];
  const sorted = [...jobs].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  const latest = sorted[0];

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button
          type="button"
          loading={requestMutation.isPending}
          onClick={() => requestMutation.mutate()}
        >
          {t('request')}
        </Button>

        {latest ? (
          latest.status === 'FAILED' ? (
            <Alert variant="destructive">
              <AlertDescription>{t('failed')}</AlertDescription>
            </Alert>
          ) : latest.ready && !isExpired(latest) ? (
            <Alert>
              <AlertTitle>{t('ready')}</AlertTitle>
              <AlertDescription className="flex flex-col items-start gap-3">
                {latest.expiresAt !== null ? (
                  <span>
                    {t('expiresAt', {
                      time: format.dateTime(new Date(latest.expiresAt), {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      }),
                    })}
                  </span>
                ) : null}
                <Button
                  type="button"
                  size="sm"
                  loading={downloadMutation.isPending}
                  onClick={() => downloadMutation.mutate(latest.id)}
                >
                  <Download aria-hidden="true" />
                  {t('download')}
                </Button>
              </AlertDescription>
            </Alert>
          ) : latest.ready && isExpired(latest) ? (
            <Alert>
              <AlertDescription>{t('expired')}</AlertDescription>
            </Alert>
          ) : (
            <Alert>
              <AlertDescription>{t('processing')}</AlertDescription>
            </Alert>
          )
        ) : null}

        <div className="space-y-2">
          <h3 className="text-sm font-medium">{t('recent')}</h3>
          {exportsQuery.isPending ? (
            <ListSkeleton rows={3} />
          ) : exportsQuery.isError ? (
            <ErrorState
              message={errorMessage(exportsQuery.error)}
              onRetry={() => void exportsQuery.refetch()}
            />
          ) : sorted.length === 0 ? (
            <EmptyState title={t('none')} />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <THead>
                  <TR>
                    <TH>{t('columnRequested')}</TH>
                    <TH>{t('columnStatus')}</TH>
                    <TH className="text-right">{t('columnSize')}</TH>
                    <TH>
                      <span className="sr-only">{t('columnActions')}</span>
                    </TH>
                  </TR>
                </THead>
                <TBody>
                  {sorted.map((job) => (
                    <TR key={job.id}>
                      <TD>
                        {format.dateTime(new Date(job.createdAt), {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        })}
                      </TD>
                      <TD>
                        <ExportStatusBadge status={job.status} />
                      </TD>
                      <TD className="text-right tabular-nums">
                        {formatBytes(job.sizeBytes) ?? t('unknownSize')}
                      </TD>
                      <TD className="text-right">
                        {job.ready && !isExpired(job) ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            loading={
                              downloadMutation.isPending &&
                              downloadMutation.variables === job.id
                            }
                            onClick={() => downloadMutation.mutate(job.id)}
                          >
                            <Download aria-hidden="true" />
                            {t('download')}
                          </Button>
                        ) : null}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function RetentionSection({ readOnly }: { readOnly: boolean }) {
  const errorMessage = useApiErrorMessage();
  const retentionQuery = useQuery({
    queryKey: ['retention-policy'],
    queryFn: () => api.compliance.getRetention(),
  });

  if (retentionQuery.isPending) {
    return (
      <Card>
        <CardContent className="pt-6">
          <ListSkeleton rows={5} />
        </CardContent>
      </Card>
    );
  }
  if (retentionQuery.isError) {
    return (
      <Card>
        <CardContent className="pt-6">
          <ErrorState
            message={errorMessage(retentionQuery.error)}
            onRetry={() => void retentionQuery.refetch()}
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <RetentionForm key={retentionQuery.data.updatedAt ?? 'default'} policy={retentionQuery.data} readOnly={readOnly} />
  );
}

function DangerZone({
  orgName,
  orgSlug,
  canErase,
}: {
  orgName: string;
  orgSlug: string;
  canErase: boolean;
}) {
  const t = useTranslations('compliance.danger');
  const [open, setOpen] = useState(false);

  return (
    <Card className="border-destructive">
      <CardHeader>
        <CardTitle className="text-destructive">{t('title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1">
          <h3 className="text-sm font-medium">{t('eraseTitle')}</h3>
          <p className="text-sm text-muted-foreground">{t('description')}</p>
        </div>
        {canErase ? (
          <Button type="button" variant="destructive" onClick={() => setOpen(true)}>
            {t('erase')}
          </Button>
        ) : (
          <Alert>
            <AlertDescription>{t('ownerOnly')}</AlertDescription>
          </Alert>
        )}
      </CardContent>
      {canErase ? (
        <EraseOrganizationDialog
          open={open}
          onOpenChange={setOpen}
          orgName={orgName}
          orgSlug={orgSlug}
        />
      ) : null}
    </Card>
  );
}

export default function DataPrivacyPage() {
  const t = useTranslations('compliance');
  const { data: session } = useSession();
  const canUpdate = can(session, 'org.update');
  const canDelete = can(session, 'org.delete');
  const organization = activeMembership(session)?.organization ?? null;

  if (!canUpdate) {
    return (
      <div className="mx-auto max-w-3xl">
        <Alert>
          <AlertTitle>{t('title')}</AlertTitle>
          <AlertDescription>{t('restricted')}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      <ExportSection />
      <RetentionSection readOnly={!canUpdate} />
      {organization ? (
        <DangerZone
          orgName={organization.name}
          orgSlug={organization.slug}
          canErase={canDelete}
        />
      ) : null}
    </div>
  );
}
