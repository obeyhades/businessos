import type { Prisma } from '@businessos/db';

type Tx = Prisma.TransactionClient;

/**
 * Row-locks a billing document FOR UPDATE inside the current transaction, so
 * concurrent state transitions on the same document serialize instead of
 * racing (finalize, pay, credit, convert). Call this as the FIRST statement in
 * the transaction, THEN re-read the entity with Prisma and validate its guards
 * on that fresh, locked state. The table names are fixed literals (never user
 * input); the id is parameterized.
 */
export async function lockInvoiceForUpdate(tx: Tx, id: string): Promise<void> {
  await tx.$executeRaw`SELECT id FROM invoices WHERE id = ${id}::uuid FOR UPDATE`;
}

export async function lockQuoteForUpdate(tx: Tx, id: string): Promise<void> {
  await tx.$executeRaw`SELECT id FROM quotes WHERE id = ${id}::uuid FOR UPDATE`;
}

/**
 * Row-locks a voucher FOR UPDATE so concurrent post/reverse/reconcile of the
 * same journal entry serialize (otherwise two posts could both pass the
 * DRAFT guard, allocating two numbers and firing two events).
 */
export async function lockVoucherForUpdate(tx: Tx, id: string): Promise<void> {
  await tx.$executeRaw`SELECT id FROM vouchers WHERE id = ${id}::uuid FOR UPDATE`;
}
