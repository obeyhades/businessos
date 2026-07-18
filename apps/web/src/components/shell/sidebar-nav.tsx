'use client';

import { cn } from '@businessos/ui';
import {
  BarChart3,
  BookOpen,
  BookText,
  Briefcase,
  CalendarClock,
  CalendarDays,
  CalendarRange,
  CircleCheck,
  ClipboardList,
  Contact,
  FileText,
  LayoutDashboard,
  Mail,
  Mic,
  Package,
  ReceiptText,
  ScrollText,
  Settings,
  ShieldCheck,
  Users,
  UsersRound,
  Webhook,
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
    | 'calendar'
    | 'email'
    | 'recordings'
    | 'members'
    | 'personnel'
    | 'onboarding'
    | 'absences'
    | 'products'
    | 'quotes'
    | 'invoices'
    | 'accountingJournal'
    | 'accountingAccounts'
    | 'accountingPeriods'
    | 'accountingReports'
    | 'auditLog'
    | 'settings'
    | 'webhooks'
    | 'dataPrivacy'
    | 'failedJobs';
  icon: typeof LayoutDashboard;
  visible: boolean;
}

function NavLink({ item, onNavigate }: { item: NavItem; onNavigate?: () => void }) {
  const t = useTranslations('nav');
  const pathname = usePathname();
  const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
  const Icon = item.icon;
  return (
    <Link
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
}

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const t = useTranslations('nav');
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
    {
      href: '/calendar',
      labelKey: 'calendar',
      icon: CalendarDays,
      visible: can(session, 'calendar.read'),
    },
    {
      href: '/mail',
      labelKey: 'email',
      icon: Mail,
      visible: can(session, 'email.read'),
    },
    {
      href: '/recordings',
      labelKey: 'recordings',
      icon: Mic,
      visible: can(session, 'recordings.read'),
    },
    { href: '/members', labelKey: 'members', icon: Users, visible: can(session, 'members.read') },
    {
      href: '/employees',
      labelKey: 'personnel',
      icon: Contact,
      visible: can(session, 'personnel.read'),
    },
    {
      href: '/onboarding-templates',
      labelKey: 'onboarding',
      icon: ClipboardList,
      visible: can(session, 'personnel.manage'),
    },
    {
      href: '/absences',
      labelKey: 'absences',
      icon: CalendarClock,
      visible: can(session, 'personnel.read'),
    },
    {
      href: '/products',
      labelKey: 'products',
      icon: Package,
      visible: can(session, 'invoices.read'),
    },
    {
      href: '/quotes',
      labelKey: 'quotes',
      icon: FileText,
      visible: can(session, 'invoices.read'),
    },
    {
      href: '/invoices',
      labelKey: 'invoices',
      icon: ReceiptText,
      visible: can(session, 'invoices.read'),
    },
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
      href: '/settings/webhooks',
      labelKey: 'webhooks',
      icon: Webhook,
      visible: can(session, 'integrations.read'),
    },
    {
      href: '/settings/data',
      labelKey: 'dataPrivacy',
      icon: ShieldCheck,
      visible: can(session, 'org.update'),
    },
    {
      href: '/admin/failed-jobs',
      labelKey: 'failedJobs',
      icon: Wrench,
      visible: session?.user.isPlatformAdmin ?? false,
    },
  ];

  const accountingItems: NavItem[] = [
    {
      href: '/accounting/vouchers',
      labelKey: 'accountingJournal',
      icon: BookOpen,
      visible: true,
    },
    {
      href: '/accounting/accounts',
      labelKey: 'accountingAccounts',
      icon: BookText,
      visible: true,
    },
    {
      href: '/accounting/periods',
      labelKey: 'accountingPeriods',
      icon: CalendarRange,
      visible: true,
    },
    {
      href: '/accounting/reports',
      labelKey: 'accountingReports',
      icon: BarChart3,
      visible: true,
    },
  ];

  const showAccounting = can(session, 'accounting.read');

  return (
    <nav className="flex flex-col gap-1 p-3" aria-label={t('dashboard')}>
      {items
        .filter((item) => item.visible)
        .map((item) => (
          <NavLink key={item.href} item={item} onNavigate={onNavigate} />
        ))}

      {showAccounting ? (
        <>
          <p className="px-3 pb-1 pt-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t('accounting')}
          </p>
          {accountingItems.map((item) => (
            <NavLink key={item.href} item={item} onNavigate={onNavigate} />
          ))}
        </>
      ) : null}
    </nav>
  );
}
