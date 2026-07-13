'use client';

import type { SearchResult, SearchResultKind } from '@businessos/types';
import { Button, Dialog, DialogContent, DialogTitle, Input, Spinner } from '@businessos/ui';
import { useQuery } from '@tanstack/react-query';
import { Briefcase, CircleCheck, Contact, Search, Users } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useDebounced } from '@/lib/use-debounced';

const KIND_ORDER: readonly SearchResultKind[] = ['customer', 'project', 'task', 'employee'];

const kindPath: Record<SearchResultKind, string> = {
  customer: '/customers',
  project: '/projects',
  task: '/tasks',
  employee: '/employees',
};

const kindIcon: Record<SearchResultKind, typeof Users> = {
  customer: Users,
  project: Briefcase,
  task: CircleCheck,
  employee: Contact,
};

export function GlobalSearch() {
  const t = useTranslations('search');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const debounced = useDebounced(term, 250);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen(true);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (!open) {
      setTerm('');
      setActiveIndex(0);
    }
  }, [open]);

  const trimmed = debounced.trim();
  const searchQuery = useQuery({
    queryKey: ['search', trimmed],
    queryFn: () => api.search.query(trimmed),
    enabled: open && trimmed.length > 0,
    staleTime: 10_000,
  });

  const results = useMemo(() => {
    const items = searchQuery.data?.results ?? [];
    return [...items].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
  }, [searchQuery.data]);

  useEffect(() => {
    setActiveIndex(0);
  }, [trimmed, results.length]);

  const select = useCallback(
    (result: SearchResult) => {
      setOpen(false);
      router.push(`${kindPath[result.kind]}/${result.id}`);
    },
    [router],
  );

  function onInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (results.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % results.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + results.length) % results.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const result = results[activeIndex];
      if (result) select(result);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="gap-2 text-muted-foreground"
        onClick={() => setOpen(true)}
      >
        <Search className="size-4" aria-hidden="true" />
        <span className="hidden sm:inline">{t('trigger')}</span>
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="top-24 max-w-xl translate-y-0 gap-0 p-0"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            inputRef.current?.focus();
          }}
        >
          <DialogTitle className="sr-only">{t('title')}</DialogTitle>
          <div className="flex items-center gap-2 border-b border-border px-3">
            <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <Input
              ref={inputRef}
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              onKeyDown={onInputKeyDown}
              placeholder={t('placeholder')}
              aria-label={t('placeholder')}
              className="border-0 shadow-none focus-visible:ring-0"
              role="combobox"
              aria-expanded={results.length > 0}
              aria-controls="global-search-results"
            />
          </div>

          <div id="global-search-results" role="listbox" className="max-h-80 overflow-y-auto p-2">
            {trimmed.length === 0 ? (
              <p className="px-2 py-6 text-center text-sm text-muted-foreground">{t('hint')}</p>
            ) : searchQuery.isPending ? (
              <div className="flex justify-center py-6">
                <Spinner className="size-5" label={t('title')} />
              </div>
            ) : searchQuery.isError ? (
              <p className="px-2 py-6 text-center text-sm text-destructive">{t('error')}</p>
            ) : results.length === 0 ? (
              <p className="px-2 py-6 text-center text-sm text-muted-foreground">
                {t('empty', { term: trimmed })}
              </p>
            ) : (
              <ul className="space-y-1">
                {results.map((result, index) => {
                  const Icon = kindIcon[result.kind];
                  const active = index === activeIndex;
                  return (
                    <li key={`${result.kind}-${result.id}`}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={active}
                        className={`flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-sm ${
                          active ? 'bg-accent text-accent-foreground' : 'hover:bg-accent'
                        }`}
                        onMouseEnter={() => setActiveIndex(index)}
                        onClick={() => select(result)}
                      >
                        <Icon
                          className="size-4 shrink-0 text-muted-foreground"
                          aria-hidden="true"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{result.title}</span>
                          {result.subtitle ? (
                            <span className="block truncate text-xs text-muted-foreground">
                              {result.subtitle}
                            </span>
                          ) : null}
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {t(`kind.${result.kind}`)}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
