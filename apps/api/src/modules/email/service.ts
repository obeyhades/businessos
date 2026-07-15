import type { Prisma } from '@businessos/db';
import type { FolderView } from '@businessos/types';
import { randomUUID } from 'node:crypto';

type Tx = Prisma.TransactionClient;

/** Strips reply/forward prefixes (Re:, Fwd:, Sv:, Ang:, VB:, …) for threading
 *  and display, collapsing repeats. */
export function normalizeSubject(subject: string): string {
  let s = subject.trim();
  let prev = '';
  while (s !== prev) {
    prev = s;
    s = s.replace(/^(re|fwd|fw|sv|vs|vb|ang|aw)\s*(\[\d+\])?\s*:\s*/i, '').trim();
  }
  return s;
}

/** A one-line preview of a message body. */
export function makeSnippet(body: string): string {
  return body.replace(/\s+/g, ' ').trim().slice(0, 160);
}

export function domainOf(address: string): string {
  return address.split('@')[1] ?? 'businessos.local';
}

/** Generates an RFC 5322 Message-ID for an outbound message. */
export function generateRfcMessageId(fromAddress: string): string {
  return `<${randomUUID()}@${domainOf(fromAddress)}>`;
}

/**
 * Translates a folder VIEW (incl. the computed SENT/DRAFTS) into a thread
 * where-fragment. SENT = has an outbound-sent message; DRAFTS = has a draft;
 * INBOX excludes draft-only threads.
 */
export function folderViewWhere(view: FolderView): Prisma.EmailThreadWhereInput {
  switch (view) {
    case 'SENT':
      return { messages: { some: { direction: 'OUTBOUND', status: 'SENT' } } };
    case 'DRAFTS':
      return { messages: { some: { status: 'DRAFT' } } };
    case 'ARCHIVE':
      return { folder: 'ARCHIVE' };
    case 'TRASH':
      return { folder: 'TRASH' };
    case 'INBOX':
    default:
      return { folder: 'INBOX', messages: { some: { status: { not: 'DRAFT' } } } };
  }
}

/**
 * Recomputes a thread's denormalized aggregates from its messages: message
 * count, last-activity time, snippet, and unread flag (any inbound unread).
 */
export async function recomputeThread(tx: Tx, threadId: string): Promise<void> {
  const messages = await tx.emailMessage.findMany({
    where: { threadId },
    select: {
      direction: true,
      status: true,
      isRead: true,
      bodyText: true,
      subject: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
  });
  if (messages.length === 0) return;
  const last = messages[messages.length - 1]!;
  const unread = messages.some((m) => m.direction === 'INBOUND' && !m.isRead);
  await tx.emailThread.update({
    where: { id: threadId },
    data: {
      messageCount: messages.length,
      lastMessageAt: last.createdAt,
      snippet: makeSnippet(last.bodyText),
      unread,
    },
  });
}

/** A SHARED account is visible to all email readers; a PERSONAL account only
 *  to its owner. */
export function accountVisibilityWhere(userId: string | undefined): Prisma.EmailAccountWhereInput {
  return {
    OR: [{ type: 'SHARED' }, { ownerId: userId ?? '00000000-0000-0000-0000-000000000000' }],
  };
}

/** Same, applied to a thread via its account relation. */
export function threadAccountVisibilityWhere(
  userId: string | undefined,
): Prisma.EmailThreadWhereInput {
  return { account: accountVisibilityWhere(userId) };
}

/** True if the user may see this account (SHARED, or PERSONAL they own). */
export function canSeeAccount(
  account: { type: string; ownerId: string | null },
  userId: string | undefined,
): boolean {
  return account.type === 'SHARED' || (!!userId && account.ownerId === userId);
}

/** Finds the customer an address belongs to (direct or via a contact). */
export async function findCustomerByAddress(
  tx: Tx,
  organizationId: string,
  address: string,
): Promise<string | null> {
  const customer = await tx.customer.findFirst({
    where: { organizationId, email: { equals: address, mode: 'insensitive' } },
    select: { id: true },
  });
  if (customer) return customer.id;
  const contact = await tx.customerContact.findFirst({
    where: { organizationId, email: { equals: address, mode: 'insensitive' } },
    select: { customerId: true },
  });
  return contact?.customerId ?? null;
}
