'use client';

import type { EmailAccountDto, EmailLabelDto, FolderView } from '@businessos/types';
import { Button, cn } from '@businessos/ui';
import {
  Archive,
  FileText,
  Inbox,
  PenSquare,
  Send,
  Settings2,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ListSkeleton } from '@/components/data-states';
import { AccountManageDialog } from './account-manage-dialog';
import { LabelManageDialog } from './label-manage-dialog';
import { FOLDER_VIEWS, accountLabel } from './mail-utils';

const FOLDER_ICONS: Record<FolderView, LucideIcon> = {
  INBOX: Inbox,
  SENT: Send,
  DRAFTS: FileText,
  ARCHIVE: Archive,
  TRASH: Trash2,
};

function SidebarRow({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active
          ? 'bg-accent font-medium text-accent-foreground'
          : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
      )}
    >
      {children}
    </button>
  );
}

/**
 * Left pane of the mail layout: compose button, mailbox picker, folder list
 * and label list. Managers (email.send) also get mailbox/label management.
 */
export function MailSidebar({
  accounts,
  accountsLoading,
  labels,
  labelsLoading,
  accountId,
  folder,
  labelId,
  onSelectAccount,
  onSelectFolder,
  onSelectLabel,
  onCompose,
  canSend,
}: {
  accounts: EmailAccountDto[];
  accountsLoading: boolean;
  labels: EmailLabelDto[];
  labelsLoading: boolean;
  accountId: string | undefined;
  folder: FolderView;
  labelId: string | undefined;
  onSelectAccount: (accountId: string | undefined) => void;
  onSelectFolder: (folder: FolderView) => void;
  onSelectLabel: (labelId: string) => void;
  onCompose: () => void;
  canSend: boolean;
}) {
  const t = useTranslations('email');
  const [manageAccountsOpen, setManageAccountsOpen] = useState(false);
  const [manageLabelsOpen, setManageLabelsOpen] = useState(false);

  return (
    <aside className="space-y-5">
      {canSend ? (
        <Button type="button" className="w-full" onClick={onCompose}>
          <PenSquare aria-hidden="true" />
          {t('compose')}
        </Button>
      ) : null}

      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <h2 className="px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t('accounts.heading')}
          </h2>
          {canSend ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label={t('accounts.manage')}
              onClick={() => setManageAccountsOpen(true)}
            >
              <Settings2 aria-hidden="true" className="size-3.5" />
            </Button>
          ) : null}
        </div>
        {accountsLoading ? (
          <ListSkeleton rows={2} />
        ) : (
          <>
            <SidebarRow active={accountId === undefined} onClick={() => onSelectAccount(undefined)}>
              <span className="min-w-0 flex-1 truncate">{t('accounts.all')}</span>
            </SidebarRow>
            {accounts.map((account) => (
              <SidebarRow
                key={account.id}
                active={accountId === account.id}
                onClick={() => onSelectAccount(account.id)}
              >
                <span className="min-w-0 flex-1 truncate">{accountLabel(account)}</span>
                {!account.isActive ? (
                  <span className="text-xs text-muted-foreground">{t('accounts.inactive')}</span>
                ) : null}
              </SidebarRow>
            ))}
            {accounts.length === 0 ? (
              <p className="px-2 text-sm text-muted-foreground">{t('accounts.empty')}</p>
            ) : null}
          </>
        )}
      </div>

      <div className="space-y-1">
        <h2 className="px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t('folders.heading')}
        </h2>
        {FOLDER_VIEWS.map((view) => {
          const Icon = FOLDER_ICONS[view];
          return (
            <SidebarRow
              key={view}
              active={labelId === undefined && folder === view}
              onClick={() => onSelectFolder(view)}
            >
              <Icon aria-hidden="true" className="size-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{t(`folders.${view}`)}</span>
            </SidebarRow>
          );
        })}
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <h2 className="px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t('labels.heading')}
          </h2>
          {canSend ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label={t('labels.manage')}
              onClick={() => setManageLabelsOpen(true)}
            >
              <Settings2 aria-hidden="true" className="size-3.5" />
            </Button>
          ) : null}
        </div>
        {labelsLoading ? (
          <ListSkeleton rows={2} />
        ) : labels.length === 0 ? (
          <p className="px-2 text-sm text-muted-foreground">{t('labels.empty')}</p>
        ) : (
          labels.map((label) => (
            <SidebarRow
              key={label.id}
              active={labelId === label.id}
              onClick={() => onSelectLabel(label.id)}
            >
              <span
                aria-hidden="true"
                className="size-3 shrink-0 rounded-full"
                style={{ backgroundColor: label.color }}
              />
              <span className="min-w-0 flex-1 truncate">{label.name}</span>
            </SidebarRow>
          ))
        )}
      </div>

      <AccountManageDialog
        open={manageAccountsOpen}
        onOpenChange={setManageAccountsOpen}
        accounts={accounts}
      />
      <LabelManageDialog
        open={manageLabelsOpen}
        onOpenChange={setManageLabelsOpen}
        labels={labels}
      />
    </aside>
  );
}
