'use client';

import type {
  EmailAccountDto,
  EmailFolder,
  EmailMessageDto,
  EmailMessageStatus,
  EmailThreadDetailDto,
} from '@businessos/types';
import {
  Badge,
  Button,
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Separator,
  cn,
} from '@businessos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  Briefcase,
  Check,
  CircleCheck,
  FolderInput,
  Inbox,
  ListTodo,
  Mail,
  MailOpen,
  Paperclip,
  Pencil,
  Reply,
  Star,
  Tag,
  Trash2,
  UsersRound,
} from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ErrorState, ListSkeleton } from '@/components/data-states';
import { api } from '@/lib/api';
import { useApiErrorMessage } from '@/lib/errors';
import { can, useSession } from '@/lib/session';
import type { ComposeInitial } from './compose-dialog';
import { EmailToTaskDialog } from './email-to-task-dialog';
import { HtmlEmailBody } from './html-email-body';
import { LinkThreadDialog } from './link-thread-dialog';
import { otherParticipants, replySubject } from './mail-utils';

const STATUS_VARIANTS: Record<EmailMessageStatus, 'secondary' | 'outline' | 'destructive'> = {
  DRAFT: 'secondary',
  QUEUED: 'secondary',
  SENT: 'outline',
  FAILED: 'destructive',
  RECEIVED: 'outline',
};

function LinkedChip({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  return (
    <Badge variant="outline" className="gap-1 p-0 font-normal">
      <Link
        href={href}
        className="flex items-center gap-1 px-2.5 py-0.5 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {icon}
        {label}
      </Link>
    </Badge>
  );
}

function MessageCard({
  message,
  subjectFallback,
  canSend,
  onEditDraft,
  onDeleteDraft,
}: {
  message: EmailMessageDto;
  subjectFallback: string;
  canSend: boolean;
  onEditDraft: (message: EmailMessageDto) => void;
  onDeleteDraft: (message: EmailMessageDto) => void;
}) {
  const t = useTranslations('email');
  const format = useFormatter();

  const isDraft = message.status === 'DRAFT';
  const timestamp = message.sentAt ?? message.receivedAt ?? message.createdAt;
  const from =
    message.fromName !== null && message.fromName.length > 0
      ? `${message.fromName} <${message.fromAddress}>`
      : message.fromAddress;

  return (
    <article
      className={cn('rounded-lg border border-border p-4', isDraft && 'border-dashed bg-muted/30')}
    >
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-0.5 text-sm">
          <p className="truncate font-medium">{from}</p>
          <p className="truncate text-xs text-muted-foreground">
            {t('message.to')}: {message.toAddresses.join(', ')}
          </p>
          {message.ccAddresses.length > 0 ? (
            <p className="truncate text-xs text-muted-foreground">
              {t('message.cc')}: {message.ccAddresses.join(', ')}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {message.direction === 'OUTBOUND' ? (
            <Badge variant={STATUS_VARIANTS[message.status]}>{t(`status.${message.status}`)}</Badge>
          ) : null}
          <span className="text-xs text-muted-foreground">
            {format.dateTime(new Date(timestamp), { dateStyle: 'medium', timeStyle: 'short' })}
          </span>
        </div>
      </header>

      {message.status === 'FAILED' && message.error !== null ? (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {message.error}
        </p>
      ) : null}

      <div className="mt-3">
        {message.bodyHtml !== null && message.bodyHtml.length > 0 ? (
          <HtmlEmailBody
            html={message.bodyHtml}
            title={message.subject.length > 0 ? message.subject : subjectFallback}
          />
        ) : (
          <p className="whitespace-pre-wrap break-words text-sm">{message.bodyText}</p>
        )}
      </div>

      {message.attachments.length > 0 ? (
        <ul className="mt-3 space-y-1">
          {message.attachments.map((attachment) => (
            <li
              key={attachment.id}
              className="flex items-center gap-2 text-sm text-muted-foreground"
            >
              <Paperclip aria-hidden="true" className="size-3.5 shrink-0" />
              <span className="min-w-0 truncate">{attachment.fileName}</span>
              <span className="shrink-0 text-xs">
                {Math.max(1, Math.round(attachment.size / 1024))} kB
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {isDraft && canSend ? (
        <div className="mt-3 flex gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => onEditDraft(message)}>
            <Pencil aria-hidden="true" />
            {t('message.editDraft')}
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => onDeleteDraft(message)}>
            <Trash2 aria-hidden="true" />
            {t('message.deleteDraft')}
          </Button>
        </div>
      ) : null}
    </article>
  );
}

/**
 * Right pane: the selected thread's messages plus the action toolbar. Opening
 * an unread thread marks it read (email.send holders only — READONLY must not
 * mutate).
 */
export function ThreadView({
  threadId,
  accounts,
  canSend,
  onOpenCompose,
}: {
  threadId: string;
  /** All visible mailboxes; used to exclude our own address from reply recipients. */
  accounts: EmailAccountDto[];
  canSend: boolean;
  onOpenCompose: (initial: ComposeInitial) => void;
}) {
  const t = useTranslations('email.thread');
  const tEmail = useTranslations('email');
  const tCommon = useTranslations('common');
  const queryClient = useQueryClient();
  const errorMessage = useApiErrorMessage();
  const { data: session } = useSession();

  const [linkOpen, setLinkOpen] = useState(false);
  const [toTaskOpen, setToTaskOpen] = useState(false);
  const [deleteDraftTarget, setDeleteDraftTarget] = useState<EmailMessageDto | undefined>(
    undefined,
  );

  const threadQuery = useQuery({
    queryKey: ['emailThread', threadId],
    queryFn: () => api.email.getThread(threadId),
    // Sent messages go DRAFT -> QUEUED -> SENT asynchronously via the worker;
    // poll while anything is still queued so the status badge settles.
    refetchInterval: (query) =>
      query.state.data?.messages.some((m) => m.status === 'QUEUED') ? 4000 : false,
  });
  const thread = threadQuery.data;

  const applyThread = async (updated: EmailThreadDetailDto): Promise<void> => {
    queryClient.setQueryData(['emailThread', threadId], updated);
    await queryClient.invalidateQueries({ queryKey: ['emailThreads'] });
  };

  const invalidate = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ['emailThreads'] });
    await queryClient.invalidateQueries({ queryKey: ['emailThread', threadId] });
  };

  const markReadMutation = useMutation({
    mutationFn: (read: boolean) => api.email.markRead(threadId, { read }),
    onSuccess: applyThread,
    onError: (error) => toast.error(errorMessage(error)),
  });

  // Opening an unread thread marks it read exactly once per thread.
  const autoReadFor = useRef<string | null>(null);
  const markRead = markReadMutation.mutate;
  useEffect(() => {
    if (!canSend || !thread || !thread.unread) return;
    if (autoReadFor.current === thread.id) return;
    autoReadFor.current = thread.id;
    markRead(true);
  }, [thread, canSend, markRead]);

  const starMutation = useMutation({
    mutationFn: (starred: boolean) => api.email.star(threadId, { starred }),
    onSuccess: invalidate,
    onError: (error) => toast.error(errorMessage(error)),
  });

  const moveMutation = useMutation({
    mutationFn: (folder: EmailFolder) => api.email.move(threadId, { folder }),
    onSuccess: async () => {
      toast.success(t('moved'));
      await invalidate();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const addLabelMutation = useMutation({
    mutationFn: (labelId: string) => api.email.addLabel(threadId, { labelId }),
    onSuccess: invalidate,
    onError: (error) => toast.error(errorMessage(error)),
  });

  const removeLabelMutation = useMutation({
    mutationFn: (labelId: string) => api.email.removeThreadLabel(threadId, labelId),
    onSuccess: invalidate,
    onError: (error) => toast.error(errorMessage(error)),
  });

  const deleteDraftMutation = useMutation({
    mutationFn: (messageId: string) => api.email.deleteDraft(messageId),
    onSuccess: async () => {
      toast.success(tEmail('composeDialog.draftDeleted'));
      setDeleteDraftTarget(undefined);
      await invalidate();
    },
    onError: (error) => {
      toast.error(errorMessage(error));
      setDeleteDraftTarget(undefined);
    },
  });

  const labelsQuery = useQuery({
    queryKey: ['emailLabels'],
    queryFn: () => api.email.listLabels(),
  });
  const allLabels = labelsQuery.data ?? [];

  const customerQuery = useQuery({
    queryKey: ['customer', thread?.customerId],
    queryFn: () => api.customers.get(thread?.customerId ?? ''),
    enabled: thread?.customerId != null && can(session, 'customers.read'),
  });
  const projectQuery = useQuery({
    queryKey: ['project', thread?.projectId],
    queryFn: () => api.projects.get(thread?.projectId ?? ''),
    enabled: thread?.projectId != null && can(session, 'projects.read'),
  });
  const taskQuery = useQuery({
    queryKey: ['task', thread?.taskId],
    queryFn: () => api.tasks.get(thread?.taskId ?? ''),
    enabled: thread?.taskId != null && can(session, 'tasks.read'),
  });

  if (threadQuery.isPending) {
    return <ListSkeleton rows={6} />;
  }
  if (threadQuery.isError) {
    return (
      <ErrorState
        message={errorMessage(threadQuery.error)}
        onRetry={() => void threadQuery.refetch()}
      />
    );
  }
  if (!thread) return null;

  function openReply(): void {
    if (!thread) return;
    const ownAddress = accounts.find((account) => account.id === thread.accountId)?.address ?? null;
    onOpenCompose({
      threadId: thread.id,
      accountId: thread.accountId,
      to: otherParticipants(thread.messages, ownAddress),
      cc: [],
      subject: replySubject(thread.subject),
      bodyText: '',
    });
  }

  function openEditDraft(message: EmailMessageDto): void {
    if (!thread) return;
    onOpenCompose({
      threadId: thread.id,
      draftId: message.id,
      accountId: thread.accountId,
      to: message.toAddresses,
      cc: message.ccAddresses,
      subject: message.subject,
      bodyText: message.bodyText,
    });
  }

  const threadLabelIds = new Set(thread.labels.map((label) => label.id));
  const moveTargets: EmailFolder[] = (['INBOX', 'ARCHIVE', 'TRASH'] as const).filter(
    (folder) => folder !== thread.folder,
  );
  const moveLabels: Record<EmailFolder, string> = {
    INBOX: t('moveToInbox'),
    ARCHIVE: t('archive'),
    TRASH: t('moveToTrash'),
  };
  const moveIcons: Record<EmailFolder, React.ReactNode> = {
    INBOX: <Inbox aria-hidden="true" />,
    ARCHIVE: <Archive aria-hidden="true" />,
    TRASH: <Trash2 aria-hidden="true" />,
  };

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h2 className="min-w-0 flex-1 break-words text-lg font-semibold">{thread.subject}</h2>
          {canSend ? (
            <div className="flex shrink-0 flex-wrap items-center gap-1">
              <Button type="button" size="sm" variant="outline" onClick={openReply}>
                <Reply aria-hidden="true" />
                {t('reply')}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={thread.unread ? t('markRead') : t('markUnread')}
                disabled={markReadMutation.isPending}
                onClick={() => markReadMutation.mutate(thread.unread)}
              >
                {thread.unread ? <MailOpen aria-hidden="true" /> : <Mail aria-hidden="true" />}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={thread.isStarred ? t('unstar') : t('star')}
                aria-pressed={thread.isStarred}
                disabled={starMutation.isPending}
                onClick={() => starMutation.mutate(!thread.isStarred)}
              >
                <Star
                  aria-hidden="true"
                  className={cn(thread.isStarred && 'fill-amber-400 text-amber-400')}
                />
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="ghost" size="icon" aria-label={t('move')}>
                    <FolderInput aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {moveTargets.map((folder) => (
                    <DropdownMenuItem key={folder} onSelect={() => moveMutation.mutate(folder)}>
                      {moveIcons[folder]}
                      {moveLabels[folder]}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="ghost" size="icon" aria-label={t('labels')}>
                    <Tag aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {allLabels.length === 0 ? (
                    <DropdownMenuItem disabled>{tEmail('labels.empty')}</DropdownMenuItem>
                  ) : (
                    allLabels.map((label) => {
                      const applied = threadLabelIds.has(label.id);
                      return (
                        <DropdownMenuItem
                          key={label.id}
                          onSelect={() =>
                            applied
                              ? removeLabelMutation.mutate(label.id)
                              : addLabelMutation.mutate(label.id)
                          }
                        >
                          <span
                            aria-hidden="true"
                            className="size-3 rounded-full"
                            style={{ backgroundColor: label.color }}
                          />
                          <span className="flex-1">{label.name}</span>
                          {applied ? <Check aria-hidden="true" /> : null}
                        </DropdownMenuItem>
                      );
                    })
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
              <Button type="button" size="sm" variant="outline" onClick={() => setLinkOpen(true)}>
                <UsersRound aria-hidden="true" />
                {t('link')}
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => setToTaskOpen(true)}>
                <ListTodo aria-hidden="true" />
                {t('toTask')}
              </Button>
            </div>
          ) : null}
        </div>

        {thread.labels.length > 0 ||
        thread.customerId !== null ||
        thread.projectId !== null ||
        thread.taskId !== null ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {thread.labels.map((label) => (
              <Badge key={label.id} variant="outline" className="gap-1 font-normal">
                <span
                  aria-hidden="true"
                  className="size-2 rounded-full"
                  style={{ backgroundColor: label.color }}
                />
                {label.name}
                {canSend ? (
                  <button
                    type="button"
                    aria-label={tEmail('labels.removeLabel', { name: label.name })}
                    className="rounded-sm hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => removeLabelMutation.mutate(label.id)}
                  >
                    <Trash2 aria-hidden="true" className="size-3" />
                  </button>
                ) : null}
              </Badge>
            ))}
            {thread.customerId !== null ? (
              <LinkedChip
                href={`/customers/${thread.customerId}`}
                icon={<UsersRound aria-hidden="true" className="size-3" />}
                label={customerQuery.data?.name ?? t('linkedCustomer')}
              />
            ) : null}
            {thread.projectId !== null ? (
              <LinkedChip
                href={`/projects/${thread.projectId}`}
                icon={<Briefcase aria-hidden="true" className="size-3" />}
                label={projectQuery.data?.name ?? t('linkedProject')}
              />
            ) : null}
            {thread.taskId !== null ? (
              <LinkedChip
                href={`/tasks/${thread.taskId}`}
                icon={<CircleCheck aria-hidden="true" className="size-3" />}
                label={taskQuery.data?.title ?? t('linkedTask')}
              />
            ) : null}
          </div>
        ) : null}
      </div>

      <Separator />

      <div className="space-y-4">
        {thread.messages.map((message) => (
          <MessageCard
            key={message.id}
            message={message}
            subjectFallback={thread.subject}
            canSend={canSend}
            onEditDraft={openEditDraft}
            onDeleteDraft={setDeleteDraftTarget}
          />
        ))}
      </div>

      <LinkThreadDialog open={linkOpen} onOpenChange={setLinkOpen} thread={thread} />
      <EmailToTaskDialog open={toTaskOpen} onOpenChange={setToTaskOpen} thread={thread} />
      <ConfirmDialog
        open={deleteDraftTarget !== undefined}
        onOpenChange={(next) => (next ? undefined : setDeleteDraftTarget(undefined))}
        title={tEmail('message.deleteDraft')}
        description={tEmail('message.deleteDraftConfirm')}
        confirmLabel={tEmail('message.deleteDraft')}
        cancelLabel={tCommon('cancel')}
        destructive
        pending={deleteDraftMutation.isPending}
        onConfirm={() => deleteDraftTarget && deleteDraftMutation.mutate(deleteDraftTarget.id)}
      />
    </div>
  );
}
