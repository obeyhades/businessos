'use client';

import type { ProductDto } from '@businessos/types';
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
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { EmptyState, ErrorState, ListSkeleton } from '@/components/data-states';
import { Money } from '@/components/phase4/money';
import { ProductFormDialog } from '@/components/phase4/product-form-dialog';
import { Pagination } from '@/components/pagination';
import { api } from '@/lib/api';
import { useApiErrorMessage } from '@/lib/errors';
import { can, useSession } from '@/lib/session';
import { useDebounced } from '@/lib/use-debounced';

const PAGE_SIZE = 25;
const ALL = 'ALL';

export default function ProductsPage() {
  const t = useTranslations('products');
  const tCommon = useTranslations('common');
  const errorMessage = useApiErrorMessage();
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const canRead = can(session, 'invoices.read');
  const canManage = can(session, 'invoices.manage');

  const [page, setPage] = useState(1);
  const [active, setActive] = useState<'true' | 'false' | typeof ALL>(ALL);
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<ProductDto | null>(null);
  const [deleting, setDeleting] = useState<ProductDto | null>(null);
  const debouncedSearch = useDebounced(search.trim(), 300);

  const productsQuery = useQuery({
    queryKey: ['products', { page, active, search: debouncedSearch }],
    queryFn: () =>
      api.products.list({
        page,
        pageSize: PAGE_SIZE,
        active: active === ALL ? undefined : active,
        search: debouncedSearch.length > 0 ? debouncedSearch : undefined,
      }),
    enabled: canRead,
  });

  const deleteMutation = useMutation({
    mutationFn: (product: ProductDto) => api.products.remove(product.id),
    onSuccess: async () => {
      toast.success(t('deleted'));
      setDeleting(null);
      await queryClient.invalidateQueries({ queryKey: ['products'] });
    },
    onError: (error) => {
      toast.error(errorMessage(error));
      setDeleting(null);
    },
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

  const hasFilters = active !== ALL || debouncedSearch.length > 0;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        {canManage ? (
          <Button type="button" onClick={() => setCreateOpen(true)}>
            <Plus aria-hidden="true" />
            {t('new')}
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
          placeholder={t('searchPlaceholder')}
          aria-label={t('searchPlaceholder')}
          className="w-full sm:w-64"
        />
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
            <SelectItem value={ALL}>{t('allProducts')}</SelectItem>
            <SelectItem value="true">{t('onlyActive')}</SelectItem>
            <SelectItem value="false">{t('onlyInactive')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="pt-6">
          {productsQuery.isPending ? (
            <ListSkeleton rows={6} />
          ) : productsQuery.isError ? (
            <ErrorState
              message={errorMessage(productsQuery.error)}
              onRetry={() => void productsQuery.refetch()}
            />
          ) : productsQuery.data.items.length === 0 ? (
            <EmptyState
              title={hasFilters ? t('emptyFiltered') : t('empty')}
              description={hasFilters ? undefined : t('emptyDescription')}
              action={
                canManage && !hasFilters ? (
                  <Button type="button" onClick={() => setCreateOpen(true)}>
                    <Plus aria-hidden="true" />
                    {t('new')}
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <>
              <Table>
                <THead>
                  <TR>
                    <TH>{t('name')}</TH>
                    <TH>{t('sku')}</TH>
                    <TH>{t('unit')}</TH>
                    <TH className="text-right">{t('unitPrice')}</TH>
                    <TH className="text-right">{t('vat')}</TH>
                    <TH>{tCommon('status')}</TH>
                    {canManage ? <TH className="text-right">{tCommon('actions')}</TH> : null}
                  </TR>
                </THead>
                <TBody>
                  {productsQuery.data.items.map((product) => (
                    <TR key={product.id}>
                      <TD className="font-medium">{product.name}</TD>
                      <TD>{product.sku ?? '—'}</TD>
                      <TD>{product.unit}</TD>
                      <TD className="text-right">
                        <Money amountMinor={product.unitPriceMinor} currency={product.currency} />
                      </TD>
                      <TD className="text-right">{product.taxRatePercent}%</TD>
                      <TD>
                        <Badge variant={product.isActive ? 'default' : 'outline'}>
                          {product.isActive ? t('active') : t('inactive')}
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
                              onClick={() => setEditing(product)}
                            >
                              <Pencil aria-hidden="true" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              aria-label={tCommon('remove')}
                              onClick={() => setDeleting(product)}
                            >
                              <Trash2 aria-hidden="true" />
                            </Button>
                          </div>
                        </TD>
                      ) : null}
                    </TR>
                  ))}
                </TBody>
              </Table>
              <Pagination
                page={productsQuery.data.page}
                totalPages={productsQuery.data.totalPages}
                onPageChange={setPage}
              />
            </>
          )}
        </CardContent>
      </Card>

      <ProductFormDialog open={createOpen} onOpenChange={setCreateOpen} />
      <ProductFormDialog
        open={editing !== null}
        onOpenChange={(next) => (next ? undefined : setEditing(null))}
        product={editing ?? undefined}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(next) => (next ? undefined : setDeleting(null))}
        title={t('deleteTitle')}
        description={deleting ? t('deleteDescription', { name: deleting.name }) : ''}
        confirmLabel={tCommon('remove')}
        cancelLabel={tCommon('cancel')}
        destructive
        pending={deleteMutation.isPending}
        onConfirm={() => deleting && deleteMutation.mutate(deleting)}
      />
    </div>
  );
}
