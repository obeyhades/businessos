'use client';

import { Button, Separator } from '@businessos/ui';
import { Menu, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { GlobalSearch } from '@/components/phase2/global-search';
import { OrgSwitcher } from './org-switcher';
import { SidebarNav } from './sidebar-nav';
import { UserMenu } from './user-menu';

export function AppShell({ children }: { children: ReactNode }) {
  const t = useTranslations('common');
  const tNav = useTranslations('nav');
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar */}
      <aside className="hidden w-60 shrink-0 border-r border-border bg-card md:flex md:flex-col">
        <div className="flex h-14 items-center px-6">
          <Link href="/dashboard" className="text-base font-semibold">
            {t('appName')}
          </Link>
        </div>
        <Separator />
        <SidebarNav />
      </aside>

      {/* Mobile sidebar overlay */}
      {sidebarOpen ? (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            type="button"
            aria-label={tNav('closeMenu')}
            className="absolute inset-0 bg-black/50"
            onClick={() => setSidebarOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 flex w-60 flex-col border-r border-border bg-card">
            <div className="flex h-14 items-center justify-between px-4">
              <span className="text-base font-semibold">{t('appName')}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={tNav('closeMenu')}
                onClick={() => setSidebarOpen(false)}
              >
                <X aria-hidden="true" />
              </Button>
            </div>
            <Separator />
            <SidebarNav onNavigate={() => setSidebarOpen(false)} />
          </aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background px-4 md:px-6">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="md:hidden"
            aria-label={tNav('openMenu')}
            onClick={() => setSidebarOpen(true)}
          >
            <Menu aria-hidden="true" />
          </Button>
          <OrgSwitcher />
          <div className="flex-1" />
          <GlobalSearch />
          <UserMenu />
        </header>
        <main className="flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
