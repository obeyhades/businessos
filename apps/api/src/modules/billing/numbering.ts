import type { Prisma } from '@businessos/db';
import { NumberSequenceKind } from '@businessos/db';

type Tx = Prisma.TransactionClient;

const DEFAULTS: Record<NumberSequenceKind, { prefix: string; padding: number }> = {
  QUOTE: { prefix: 'Q-', padding: 4 },
  INVOICE: { prefix: 'INV-', padding: 4 },
  CREDIT_NOTE: { prefix: 'CN-', padding: 4 },
};

/**
 * Allocates the next document number for an organization + kind. MUST be called
 * inside the same transaction as the document being numbered.
 *
 * Concurrency safety: the row is created once (upsert), then `update` with an
 * atomic `{ increment: 1 }` takes a row-level write lock. Two concurrent
 * finalizations for the same org+kind serialize on that lock and receive
 * distinct, gap-free values — no duplicate numbers, no skipped numbers.
 */
export async function allocateNumber(
  tx: Tx,
  organizationId: string,
  kind: NumberSequenceKind,
): Promise<string> {
  const defaults = DEFAULTS[kind];
  // Ensure the sequence row exists (no-op if already present).
  await tx.numberSequence.upsert({
    where: { organizationId_kind: { organizationId, kind } },
    create: { organizationId, kind, prefix: defaults.prefix, padding: defaults.padding, next: 1 },
    update: {},
  });
  // Atomic increment under a row lock; returns the value we consumed.
  const updated = await tx.numberSequence.update({
    where: { organizationId_kind: { organizationId, kind } },
    data: { next: { increment: 1 } },
  });
  const consumed = updated.next - 1;
  return `${updated.prefix}${String(consumed).padStart(updated.padding, '0')}`;
}

export { NumberSequenceKind };
