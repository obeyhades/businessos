'use client';

import { cn } from '@businessos/ui';
import {
  Briefcase,
  CircleCheck,
  LayoutDashboard,
  ScrollText,
  Settings,
  Users,
  UsersRound,
  Wrench,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { can, useSession } from '@/lib/session';

interface NavItem {
  href: string;
  labelKey:
    | 'dashboard'
    | 'customers'
    | 'projects'
    | 'tasks'
    | 'members'
    | 'auditLog'
    | 'settings'
    | 'failedJobs';
  icon: typeof LayoutDashboard;
  visible: boolean;
}

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const t = useTranslations('nav');
  const pathname = usePathname();
  const { data: session } = useSession();

  const items: NavItem[] = [
    { href: '/dashboard', labelKey: 'dashboard', icon: LayoutDashboard, visible: true },
    {
      href: '/customers',
      labelKey: 'customers',
      icon: UsersRound,
      visible: can(session, 'customers.read'),
    },
    {
      href: '/projects',
      labelKey: 'projects',
      icon: Briefcase,
      visible: can(session, 'projects.read'),
    },
    {
      href: '/tasks',
      labelKey: 'tasks',
      icon: CircleCheck,
      visible: can(session, 'tasks.read'),
    },
    { href: '/members', labelKey: 'members', icon: Users, visible: can(session, 'members.read') },
    {
      href: '/audit-log',
      labelKey: 'auditLog',
      icon: ScrollText,
      visible: can(session, 'audit.read'),
    },
    {
      href: '/settings/organization',
      labelKey: 'settings',
      icon: Settings,
      visible: can(session, 'org.read'),
    },
    {
      href: '/admin/failed-jobs',
      labelKey: 'failedJobs',
      icon: Wrench,
      visible: session?.user.isPlatformAdmin ?? false,
    },
  ];

  return (
    <nav className="flex flex-col gap-1 p-3" aria-label={t('dashboard')}>
      {items
        .filter((item) => item.visible)
        .map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                active
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
              )}
            >
              <Icon className="size-4 shrink-0" aria-hidden="true" />
              {t(item.labelKey)}
            </Link>
          );
        })}
    </nav>
  );
}
