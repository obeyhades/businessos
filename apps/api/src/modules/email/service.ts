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
      // A message counts as "sent" from queue time onward; the worker later
      // flips QUEUED → SENT. Exclude trashed threads.
      return {
        folder: { not: 'TRASH' },
        messages: { some: { direction: 'OUTBOUND', status: { in: ['QUEUED', 'SENT'] } } },
      };
    case 'DRAFTS':
      return { folder: { not: 'TRASH' }, messages: { some: { status: 'DRAFT' } } };
    case 'ARCHIVE':
      return { folder: 'ARCHIVE' };
    case 'TRASH':
      return { folder: 'TRASH' };
    case 'INBOX':
    default:
      // Inbox is inbound mail only — outbound-only (composed/sent) threads live
      // in the SENT view, not here.
      return { folder: 'INBOX', messages: { some: { direction: 'INBOUND' } } };
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
      isRead: true,
      bodyText: true,
      sentAt: true,
      receivedAt: true,
      createdAt: true,
    },
  });
  if (messages.length === 0) return;
  // Rank by effective activity time — a sent draft counts as recent activity
  // (Gmail-style), even though it was composed earlier.
  const effective = (m: (typeof messages)[number]): number =>
    (m.sentAt ?? m.receivedAt ?? m.createdAt).getTime();
  const last = messages.reduce((a, b) => (effective(b) >= effective(a) ? b : a));
  const unread = messages.some((m) => m.direction === 'INBOUND' && !m.isRead);
  await tx.emailThread.update({
    where: { id: threadId },
    data: {
      messageCount: messages.length,
      lastMessageAt: new Date(effective(last)),
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

/** Finds the customer an address belongs to (direct or via a contact). Returns
 *  null when the match is AMBIGUOUS (a shared/generic address maps to more than
 *  one customer) — better to leave it for manual linking than misattribute. */
export async function findCustomerByAddress(
  tx: Tx,
  organizationId: string,
  address: string,
): Promise<string | null> {
  const customers = await tx.customer.findMany({
    where: { organizationId, email: { equals: address, mode: 'insensitive' } },
    select: { id: true },
    take: 2,
  });
  if (customers.length === 1) return customers[0]!.id;
  if (customers.length > 1) return null; // ambiguous → skip auto-link

  const contacts = await tx.customerContact.findMany({
    where: { organizationId, email: { equals: address, mode: 'insensitive' } },
    select: { customerId: true },
    take: 5,
  });
  const distinct = [...new Set(contacts.map((c) => c.customerId))];
  return distinct.length === 1 ? distinct[0]! : null;
}
