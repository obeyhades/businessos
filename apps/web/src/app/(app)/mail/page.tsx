'use client';

import type { FolderView } from '@businessos/types';
import { Alert, AlertDescription, AlertTitle, Card, CardContent, Input } from '@businessos/ui';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { EmptyState, ErrorState, ListSkeleton } from '@/components/data-states';
import { Pagination } from '@/components/pagination';
import { ComposeDialog, type ComposeInitial } from '@/components/phase7/compose-dialog';
import { MailSidebar } from '@/components/phase7/mail-sidebar';
import { visibleAccounts } from '@/components/phase7/mail-utils';
import { ThreadList } from '@/components/phase7/thread-list';
import { ThreadView } from '@/components/phase7/thread-view';
import { api } from '@/lib/api';
import { useApiErrorMessage } from '@/lib/errors';
import { can, useSession } from '@/lib/session';
import { useDebounced } from '@/lib/use-debounced';

const PAGE_SIZE = 25;

export default function MailPage() {
  const t = useTranslations('email');
  const errorMessage = useApiErrorMessage();
  const { data: session } = useSession();
  const canRead = can(session, 'email.read');
  const canSend = can(session, 'email.send');

  const [accountId, setAccountId] = useState<string | undefined>(undefined);
  const [folder, setFolder] = useState<FolderView>('INBOX');
  const [labelId, setLabelId] = useState<string | undefined>(undefined);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeInitial, setComposeInitial] = useState<ComposeInitial | undefined>(undefined);
  const debouncedSearch = useDebounced(search.trim(), 300);

  const accountsQuery = useQuery({
    queryKey: ['emailAccounts'],
    queryFn: () => api.email.listAccounts(),
    enabled: canRead,
  });
  const labelsQuery = useQuery({
    queryKey: ['emailLabels'],
    queryFn: () => api.email.listLabels(),
    enabled: canRead,
  });

  const accounts = useMemo(
    () => visibleAccounts(accountsQuery.data ?? [], session?.user.id),
    [accountsQuery.data, session?.user.id],
  );
  const labels = labelsQuery.data ?? [];

  const threadsQuery = useQuery({
    queryKey: [
      'emailThreads',
      {
        accountId,
        folder: labelId === undefined ? folder : undefined,
        labelId,
        search: debouncedSearch,
        page,
      },
    ],
    queryFn: () =>
      api.email.listThreads({
        accountId,
        // A selected label filters across all folders, Gmail-style.
        folder: labelId === undefined ? folder : undefined,
        labelId,
        search: debouncedSearch.length > 0 ? debouncedSearch : undefined,
        page,
        pageSize: PAGE_SIZE,
      }),
    enabled: canRead,
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

  function selectAccount(next: string | undefined): void {
    setAccountId(next);
    setPage(1);
    setSelectedThreadId(null);
  }

  function selectFolder(next: FolderView): void {
    setFolder(next);
    setLabelId(undefined);
    setPage(1);
    setSelectedThreadId(null);
  }

  function selectLabel(next: string): void {
    setLabelId((current) => (current === next ? undefined : next));
    setPage(1);
    setSelectedThreadId(null);
  }

  function openCompose(initial?: ComposeInitial): void {
    setComposeInitial(initial);
    setComposeOpen(true);
  }

  const hasFilters = debouncedSearch.length > 0 || labelId !== undefined;

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>

      <div className="grid gap-6 lg:grid-cols-[200px_minmax(0,1fr)] xl:grid-cols-[200px_minmax(320px,380px)_minmax(0,1fr)]">
        <MailSidebar
          accounts={accounts}
          accountsLoading={accountsQuery.isPending}
          labels={labels}
          labelsLoading={labelsQuery.isPending}
          accountId={accountId}
          folder={folder}
          labelId={labelId}
          onSelectAccount={selectAccount}
          onSelectFolder={selectFolder}
          onSelectLabel={selectLabel}
          onCompose={() => openCompose(undefined)}
          canSend={canSend}
        />

        <Card className="min-w-0">
          <CardContent className="space-y-3 pt-6">
            <Input
              type="search"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder={t('list.searchPlaceholder')}
              aria-label={t('list.searchPlaceholder')}
            />
            {threadsQuery.isPending ? (
              <ListSkeleton rows={8} />
            ) : threadsQuery.isError ? (
              <ErrorState
                message={errorMessage(threadsQuery.error)}
                onRetry={() => void threadsQuery.refetch()}
              />
            ) : threadsQuery.data.items.length === 0 ? (
              <EmptyState
                title={t('list.empty')}
                description={hasFilters ? undefined : t('list.emptyDescription')}
              />
            ) : (
              <>
                <ThreadList
                  threads={threadsQuery.data.items}
                  selectedThreadId={selectedThreadId}
                  onSelect={setSelectedThreadId}
                  canSend={canSend}
                />
                <Pagination
                  page={threadsQuery.data.page}
                  totalPages={threadsQuery.data.totalPages}
                  onPageChange={setPage}
                />
              </>
            )}
          </CardContent>
        </Card>

        <Card className="min-w-0 lg:col-span-2 xl:col-span-1">
          <CardContent className="pt-6">
            {selectedThreadId === null ? (
              <EmptyState title={t('thread.select')} />
            ) : (
              <ThreadView
                threadId={selectedThreadId}
                accounts={accounts}
                canSend={canSend}
                onOpenCompose={openCompose}
              />
            )}
          </CardContent>
        </Card>
      </div>

      <ComposeDialog
        open={composeOpen}
        onOpenChange={setComposeOpen}
        accounts={accounts}
        initial={composeInitial}
      />
    </div>
  );
}
