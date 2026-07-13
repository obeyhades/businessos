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
 * Concurrency safety, in two atomic steps:
 *  1. Ensure the sequence row exists with a raw INSERT ... ON CONFLICT DO
 *     NOTHING — atomic, so concurrent first-finalizations of a brand-new
 *     sequence never collide on the unique constraint (Prisma's upsert is
 *     SELECT-then-INSERT and would 500 under that race).
 *  2. `update` with `{ increment: 1 }` takes a row-level write lock, so
 *     concurrent finalizations serialize and receive distinct, gap-free
 *     values — no duplicate numbers, no skipped numbers.
 */
export async function allocateNumber(
  tx: Tx,
  organizationId: string,
  kind: NumberSequenceKind,
): Promise<string> {
  const defaults = DEFAULTS[kind];
  await tx.$executeRaw`
    INSERT INTO number_sequences (id, organization_id, kind, prefix, padding, next, created_at, updated_at)
    VALUES (gen_random_uuid(), ${organizationId}::uuid, ${kind}::"NumberSequenceKind", ${defaults.prefix}, ${defaults.padding}, 1, now(), now())
    ON CONFLICT (organization_id, kind) DO NOTHING
  `;
  // Atomic increment under a row lock; returns the value we consumed.
  const updated = await tx.numberSequence.update({
    where: { organizationId_kind: { organizationId, kind } },
    data: { next: { increment: 1 } },
  });
  const consumed = updated.next - 1;
  return `${updated.prefix}${String(consumed).padStart(updated.padding, '0')}`;
}

export { NumberSequenceKind };
