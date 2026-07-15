import type {
  EmailAccount,
  EmailAttachment,
  EmailLabel,
  EmailMessage,
  EmailThread,
  EmailThreadLabel,
  Prisma,
} from '@businessos/db';
import type {
  EmailAccountDto,
  EmailAttachmentDto,
  EmailLabelDto,
  EmailMessageDto,
  EmailThreadDetailDto,
  EmailThreadDto,
} from '@businessos/types';

export function toEmailAccountDto(a: EmailAccount): EmailAccountDto {
  return {
    id: a.id,
    address: a.address,
    displayName: a.displayName,
    type: a.type,
    ownerId: a.ownerId,
    provider: a.provider,
    isActive: a.isActive,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}

export function toEmailLabelDto(l: EmailLabel): EmailLabelDto {
  return { id: l.id, name: l.name, color: l.color };
}

export function toEmailAttachmentDto(a: EmailAttachment): EmailAttachmentDto {
  return { id: a.id, fileName: a.fileName, contentType: a.contentType, size: a.size };
}

type MessageWithAttachments = EmailMessage & { attachments: EmailAttachment[] };

export function toEmailMessageDto(m: MessageWithAttachments): EmailMessageDto {
  return {
    id: m.id,
    threadId: m.threadId,
    direction: m.direction,
    status: m.status,
    fromAddress: m.fromAddress,
    fromName: m.fromName,
    toAddresses: m.toAddresses,
    ccAddresses: m.ccAddresses,
    subject: m.subject,
    bodyText: m.bodyText,
    bodyHtml: m.bodyHtml,
    messageId: m.messageId,
    inReplyTo: m.inReplyTo,
    isRead: m.isRead,
    sentAt: m.sentAt?.toISOString() ?? null,
    receivedAt: m.receivedAt?.toISOString() ?? null,
    error: m.error,
    attachments: m.attachments.map(toEmailAttachmentDto),
    createdAt: m.createdAt.toISOString(),
  };
}

type ThreadWithLabels = EmailThread & {
  labels: (EmailThreadLabel & { label: EmailLabel })[];
};

export function toEmailThreadDto(t: ThreadWithLabels): EmailThreadDto {
  return {
    id: t.id,
    accountId: t.accountId,
    subject: t.subject,
    snippet: t.snippet,
    folder: t.folder,
    isStarred: t.isStarred,
    unread: t.unread,
    messageCount: t.messageCount,
    lastMessageAt: t.lastMessageAt.toISOString(),
    customerId: t.customerId,
    projectId: t.projectId,
    taskId: t.taskId,
    labels: t.labels.map((tl) => toEmailLabelDto(tl.label)),
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

export function toEmailThreadDetailDto(
  t: ThreadWithLabels & { messages: MessageWithAttachments[] },
): EmailThreadDetailDto {
  return { ...toEmailThreadDto(t), messages: t.messages.map(toEmailMessageDto) };
}

export const threadInclude = {
  labels: { include: { label: true } },
} satisfies Prisma.EmailThreadInclude;

export const threadDetailInclude = {
  labels: { include: { label: true } },
  messages: { include: { attachments: true }, orderBy: { createdAt: 'asc' } },
} satisfies Prisma.EmailThreadInclude;
