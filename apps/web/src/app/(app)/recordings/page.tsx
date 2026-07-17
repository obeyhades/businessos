'use client';

import type { RecordingSource, RecordingStatus } from '@businessos/types';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '@businessos/ui';
import { useQuery } from '@tanstack/react-query';
import { Mic, Phone } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { EmptyState, ErrorState, ListSkeleton } from '@/components/data-states';
import { Pagination } from '@/components/pagination';
import {
  formatDuration,
  RecordingSourceIcon,
  TranscriptStatusBadge,
} from '@/components/phase8/recording-utils';
import { LogCallDialog } from '@/components/phase8/log-call-dialog';
import { UploadVoiceNoteDialog } from '@/components/phase8/upload-voice-note-dialog';
import { api } from '@/lib/api';
import { useApiErrorMessage } from '@/lib/errors';
import { can, useSession } from '@/lib/session';
import { useDebounced } from '@/lib/use-debounced';

const PAGE_SIZE = 25;
const ALL = 'ALL';
const SOURCES: RecordingSource[] = ['VOICE_NOTE', 'CALL'];
const STATUSES: RecordingStatus[] = ['UPLOADED', 'TRANSCRIBING', 'TRANSCRIBED', 'FAILED'];

export default function RecordingsPage() {
  const t = useTranslations('recordings');
  const format = useFormatter();
  const router = useRouter();
  const errorMessage = useApiErrorMessage();
  const { data: session } = useSession();
  const canRead = can(session, 'recordings.read');
  const canManage = can(session, 'recordings.manage');
  const canReadCustomers = can(session, 'customers.read');

  const [search, setSearch] = useState('');
  const [source, setSource] = useState<RecordingSource | typeof ALL>(ALL);
  const [status, setStatus] = useState<RecordingStatus | typeof ALL>(ALL);
  const [page, setPage] = useState(1);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [callOpen, setCallOpen] = useState(false);
  const debouncedSearch = useDebounced(search.trim(), 300);

  const recordingsQuery = useQuery({
    queryKey: ['recordings', { source, status, search: debouncedSearch, page }],
    queryFn: () =>
      api.recordings.list({
        source: source === ALL ? undefined : source,
        status: status === ALL ? undefined : status,
        search: debouncedSearch.length > 0 ? debouncedSearch : undefined,
        page,
        pageSize: PAGE_SIZE,
      }),
    enabled: canRead,
  });

  const customersQuery = useQuery({
    queryKey: ['customers', 'options'],
    queryFn: () => api.customers.list({ page: 1, pageSize: 100 }),
    enabled: canRead && canReadCustomers,
  });

  if (!canRead) {
    return (
      <div className="mx-auto max-w-6xl">
        <Alert>
          <AlertTitle>{t('title')}</AlertTitle>
          <AlertDescription>{t('restricted')}</AlertDescription>
        </Alert>
      </div>
    );
  }

  function customerName(customerId: string | null): string | null {
    if (customerId === null) return null;
    return customersQuery.data?.items.find((customer) => customer.id === customerId)?.name ?? null;
  }

  const hasFilters = source !== ALL || status !== ALL || debouncedSearch.length > 0;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        {canManage ? (
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => setUploadOpen(true)}>
              <Mic aria-hidden="true" />
              {t('uploadVoiceNote')}
            </Button>
            <Button type="button" variant="outline" onClick={() => setCallOpen(true)}>
              <Phone aria-hidden="true" />
              {t('logCall')}
            </Button>
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Input
          type="search"
          className="w-full sm:w-64"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
          placeholder={t('list.searchPlaceholder')}
          aria-label={t('list.searchPlaceholder')}
        />
        <Select
          value={source}
          onValueChange={(value) => {
            setSource(value as RecordingSource | typeof ALL);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-full sm:w-48" aria-label={t('list.filterSource')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('list.allSources')}</SelectItem>
            {SOURCES.map((value) => (
              <SelectItem key={value} value={value}>
                {t(`source.${value}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={status}
          onValueChange={(value) => {
            setStatus(value as RecordingStatus | typeof ALL);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-full sm:w-48" aria-label={t('list.filterStatus')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('list.allStatuses')}</SelectItem>
            {STATUSES.map((value) => (
              <SelectItem key={value} value={value}>
                {t(`status.${value}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="pt-6">
          {recordingsQuery.isPending ? (
            <ListSkeleton rows={6} />
          ) : recordingsQuery.isError ? (
            <ErrorState
              message={errorMessage(recordingsQuery.error)}
              onRetry={() => void recordingsQuery.refetch()}
            />
          ) : recordingsQuery.data.items.length === 0 ? (
            <EmptyState
              title={hasFilters ? t('list.emptyFiltered') : t('list.empty')}
              description={hasFilters ? undefined : t('list.emptyDescription')}
              action={
                canManage && !hasFilters ? (
                  <Button type="button" onClick={() => setUploadOpen(true)}>
                    <Mic aria-hidden="true" />
                    {t('uploadVoiceNote')}
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <>
              <Table>
                <THead>
                  <TR>
                    <TH>{t('list.columnTitle')}</TH>
                    <TH>{t('list.columnSource')}</TH>
                    <TH>{t('list.columnDate')}</TH>
                    <TH className="text-right">{t('list.columnDuration')}</TH>
                    <TH>{t('list.columnTranscript')}</TH>
                    <TH>{t('list.columnCustomer')}</TH>
                  </TR>
                </THead>
                <TBody>
                  {recordingsQuery.data.items.map((recording) => (
                    <TR
                      key={recording.id}
                      className="cursor-pointer"
                      onClick={() => router.push(`/recordings/${recording.id}`)}
                    >
                      <TD className="font-medium">{recording.title}</TD>
                      <TD>
                        <span className="inline-flex items-center gap-1.5">
                          <RecordingSourceIcon
                            source={recording.source}
                            className="size-4 shrink-0 text-muted-foreground"
                          />
                          {t(`source.${recording.source}`)}
                        </span>
                      </TD>
                      <TD>
                        {format.dateTime(new Date(recording.occurredAt), { dateStyle: 'medium' })}
                      </TD>
                      <TD className="text-right tabular-nums">
                        {formatDuration(recording.durationSeconds) ?? t('list.none')}
                      </TD>
                      <TD>
                        <TranscriptStatusBadge status={recording.transcriptStatus} />
                      </TD>
                      <TD>{customerName(recording.customerId) ?? t('list.none')}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
              <Pagination
                page={recordingsQuery.data.page}
                totalPages={recordingsQuery.data.totalPages}
                onPageChange={setPage}
              />
            </>
          )}
        </CardContent>
      </Card>

      <UploadVoiceNoteDialog open={uploadOpen} onOpenChange={setUploadOpen} />
      <LogCallDialog open={callOpen} onOpenChange={setCallOpen} />
    </div>
  );
}
