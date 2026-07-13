'use client';

import { accountTypeSchema, type AccountDto, type AccountType } from '@businessos/types';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  ConfirmDialog,
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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Power } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { EmptyState, ErrorState, ListSkeleton } from '@/components/data-states';
import { AccountFormDialog } from '@/components/phase5/account-form-dialog';
import { AccountTypeBadge } from '@/components/phase5/badges';
import { MappingCard } from '@/components/phase5/mapping-card';
import { Pagination } from '@/components/pagination';
import { api } from '@/lib/api';
import { useApiErrorMessage } from '@/lib/errors';
import { can, useSession } from '@/lib/session';
import { useDebounced } from '@/lib/use-debounced';

const PAGE_SIZE = 200;
const ALL = 'ALL';

export default function AccountsPage() {
  const t = useTranslations('accounting');
  const tType = useTranslations('accountType');
  const tCommon = useTranslations('common');
  const errorMessage = useApiErrorMessage();
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const canRead = can(session, 'accounting.read');
  const canManage = can(session, 'accounting.manage');

  const [page, setPage] = useState(1);
  const [type, setType] = useState<AccountType | typeof ALL>(ALL);
  const [active, setActive] = useState<'true' | 'false' | typeof ALL>(ALL);
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<AccountDto | null>(null);
  const [toggling, setToggling] = useState<AccountDto | null>(null);
  const debouncedSearch = useDebounced(search.trim(), 300);

  const accountsQuery = useQuery({
    queryKey: ['accounts', { page, type, active, search: debouncedSearch }],
    queryFn: () =>
      api.accounting.listAccounts({
        page,
        pageSize: PAGE_SIZE,
        type: type === ALL ? undefined : type,
        active: active === ALL ? undefined : active,
        search: debouncedSearch.length > 0 ? debouncedSearch : undefined,
      }),
    enabled: canRead,
  });

  const toggleMutation = useMutation({
    mutationFn: (account: AccountDto) =>
      api.accounting.updateAccount(account.id, { isActive: !account.isActive }),
    onSuccess: async (updated) => {
      toast.success(updated.isActive ? t('accountActivated') : t('accountDeactivated'));
      setToggling(null);
      await queryClient.invalidateQueries({ queryKey: ['accounts'] });
    },
    onError: (error) => {
      toast.error(errorMessage(error));
      setToggling(null);
    },
  });

  if (!canRead) {
    return (
      <div className="mx-auto max-w-6xl">
        <Alert>
          <AlertTitle>{t('accountsTitle')}</AlertTitle>
          <AlertDescription>{t('restricted')}</AlertDescription>
        </Alert>
      </div>
    );
  }

  const hasFilters = type !== ALL || active !== ALL || debouncedSearch.length > 0;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">{t('accountsTitle')}</h1>
        {canManage ? (
          <Button type="button" onClick={() => setCreateOpen(true)}>
            <Plus aria-hidden="true" />
            {t('newAccount')}
          </Button>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Input
          type="search"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
          placeholder={t('searchAccounts')}
          aria-label={t('searchAccounts')}
          className="w-full sm:w-64"
        />
        <Select
          value={type}
          onValueChange={(value) => {
            setType(value as AccountType | typeof ALL);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-full sm:w-48" aria-label={t('filterType')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('allTypes')}</SelectItem>
            {accountTypeSchema.options.map((option) => (
              <SelectItem key={option} value={option}>
                {tType(option)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={active}
          onValueChange={(value) => {
            setActive(value as 'true' | 'false' | typeof ALL);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-full sm:w-48" aria-label={t('filterActive')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('allAccounts')}</SelectItem>
            <SelectItem value="true">{t('onlyActive')}</SelectItem>
            <SelectItem value="false">{t('onlyInactive')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="pt-6">
          {accountsQuery.isPending ? (
            <ListSkeleton rows={6} />
          ) : accountsQuery.isError ? (
            <ErrorState
              message={errorMessage(accountsQuery.error)}
              onRetry={() => void accountsQuery.refetch()}
            />
          ) : accountsQuery.data.items.length === 0 ? (
            <EmptyState
              title={hasFilters ? t('accountsEmptyFiltered') : t('accountsEmpty')}
              description={hasFilters ? undefined : t('accountsEmptyDescription')}
              action={
                canManage && !hasFilters ? (
                  <Button type="button" onClick={() => setCreateOpen(true)}>
                    <Plus aria-hidden="true" />
                    {t('newAccount')}
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <>
              <Table>
                <THead>
                  <TR>
                    <TH>{t('accountCode')}</TH>
                    <TH>{t('accountName')}</TH>
                    <TH>{t('accountTypeLabel')}</TH>
                    <TH>{tCommon('status')}</TH>
                    {canManage ? <TH className="text-right">{tCommon('actions')}</TH> : null}
                  </TR>
                </THead>
                <TBody>
                  {accountsQuery.data.items.map((account) => (
                    <TR key={account.id}>
                      <TD className="font-medium">{account.code}</TD>
                      <TD>{account.name}</TD>
                      <TD>
                        <AccountTypeBadge type={account.type} />
                      </TD>
                      <TD>
                        <Badge variant={account.isActive ? 'default' : 'outline'}>
                          {account.isActive ? t('accountActive') : t('accountInactive')}
                        </Badge>
                      </TD>
                      {canManage ? (
                        <TD className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              aria-label={tCommon('edit')}
                              onClick={() => setEditing(account)}
                            >
                              <Pencil aria-hidden="true" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              aria-label={account.isActive ? t('deactivate') : t('activate')}
                              onClick={() => setToggling(account)}
                            >
                              <Power aria-hidden="true" />
                            </Button>
                          </div>
                        </TD>
                      ) : null}
                    </TR>
                  ))}
                </TBody>
              </Table>
              <Pagination
                page={accountsQuery.data.page}
                totalPages={accountsQuery.data.totalPages}
                onPageChange={setPage}
              />
            </>
          )}
        </CardContent>
      </Card>

      <MappingCard canManage={canManage} />

      <AccountFormDialog open={createOpen} onOpenChange={setCreateOpen} />
      <AccountFormDialog
        open={editing !== null}
        onOpenChange={(next) => (next ? undefined : setEditing(null))}
        account={editing ?? undefined}
      />
      <ConfirmDialog
        open={toggling !== null}
        onOpenChange={(next) => (next ? undefined : setToggling(null))}
        title={toggling?.isActive ? t('deactivateTitle') : t('activateTitle')}
        description={
          toggling
            ? toggling.isActive
              ? t('deactivateDescription', { name: toggling.name })
              : t('activateDescription', { name: toggling.name })
            : ''
        }
        confirmLabel={toggling?.isActive ? t('deactivate') : t('activate')}
        cancelLabel={tCommon('cancel')}
        destructive={toggling?.isActive ?? false}
        pending={toggleMutation.isPending}
        onConfirm={() => toggling && toggleMutation.mutate(toggling)}
      />
    </div>
  );
}
