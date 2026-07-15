import type { EmailAccountDto, EmailMessageDto, FolderView } from '@businessos/types';

/** All list views in display order (SENT/DRAFTS are server-computed views). */
export const FOLDER_VIEWS: FolderView[] = ['INBOX', 'SENT', 'DRAFTS', 'ARCHIVE', 'TRASH'];

/** Loose client-side address check; the server enforces the real schema. */
export function isValidEmailAddress(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/** "Re: subject" unless the subject already carries a reply prefix. */
export function replySubject(subject: string): string {
  return /^re:/i.test(subject.trim()) ? subject : `Re: ${subject}`;
}

/**
 * Everyone who took part in the thread except our own mailbox — the default
 * `to` list of a reply. Derived from the last non-draft message first so the
 * most recent counterpart ends up first.
 */
export function otherParticipants(
  messages: EmailMessageDto[],
  ownAddress: string | null,
): string[] {
  const own = ownAddress?.toLowerCase() ?? null;
  const seen = new Set<string>();
  const result: string[] = [];
  const add = (address: string) => {
    const normalized = address.trim().toLowerCase();
    if (normalized.length === 0 || normalized === own || seen.has(normalized)) return;
    seen.add(normalized);
    result.push(normalized);
  };
  const ordered = [...messages].reverse().filter((m) => m.status !== 'DRAFT');
  for (const message of ordered) {
    add(message.fromAddress);
    for (const to of message.toAddresses) add(to);
    for (const cc of message.ccAddresses) add(cc);
  }
  return result;
}

/** Display name for a mailbox in pickers and lists. */
export function accountLabel(account: EmailAccountDto): string {
  return account.displayName !== null && account.displayName.length > 0
    ? account.displayName
    : account.address;
}

/** Mailboxes the current user may see: shared ones plus their own personal ones. */
export function visibleAccounts(
  accounts: EmailAccountDto[],
  currentUserId: string | undefined,
): EmailAccountDto[] {
  return accounts.filter(
    (account) => account.type === 'SHARED' || account.ownerId === currentUserId,
  );
}
