import type { Prisma, VoucherStatus } from '@businessos/db';
import type { VoucherLineInput } from '@businessos/types';
import { errors } from '../../lib/errors.js';

type Tx = Prisma.TransactionClient;

/**
 * Statuses that count toward reported balances. A REVERSED voucher still "hit
 * the books" — its offsetting reversal is POSTED, so BOTH must be counted for
 * the reversal to net to zero. Excluding REVERSED would leave the reversal
 * uncancelled. DRAFT is included only when explicitly requested.
 */
export function reportingStatuses(includeDrafts: boolean): VoucherStatus[] {
  return includeDrafts ? ['POSTED', 'REVERSED', 'DRAFT'] : ['POSTED', 'REVERSED'];
}

/** Prisma include that yields everything the voucher mapper needs. */
export const voucherInclude = {
  lines: {
    include: { account: { select: { code: true, name: true } } },
    orderBy: { sortOrder: 'asc' },
  },
  reversedBy: { select: { id: true } },
} satisfies Prisma.VoucherInclude;

export interface BuiltLine {
  accountId: string;
  description: string | null;
  debitMinor: bigint;
  creditMinor: bigint;
  sortOrder: number;
}

export interface BuiltLines {
  lines: BuiltLine[];
  totalDebitMinor: bigint;
  totalCreditMinor: bigint;
}

/**
 * Validates that every line references an active account belonging to the org,
 * then returns the normalized lines plus their debit/credit totals. Does NOT
 * enforce balance — a DRAFT may be saved unbalanced; posting enforces balance.
 */
export async function buildVoucherLines(
  tx: Tx,
  organizationId: string,
  inputs: VoucherLineInput[],
): Promise<BuiltLines> {
  const accountIds = [...new Set(inputs.map((l) => l.accountId))];
  const accounts = await tx.account.findMany({
    where: { id: { in: accountIds }, organizationId },
    select: { id: true, isActive: true },
  });
  const byId = new Map(accounts.map((a) => [a.id, a]));
  for (const id of accountIds) {
    const account = byId.get(id);
    if (!account) throw errors.badRequest('unknown_account', `Account ${id} does not exist`);
    if (!account.isActive) {
      throw errors.badRequest(
        'inactive_account',
        `Account ${id} is inactive and cannot be posted to`,
      );
    }
  }

  let totalDebitMinor = 0n;
  let totalCreditMinor = 0n;
  const lines: BuiltLine[] = inputs.map((l, i) => {
    const debitMinor = BigInt(l.debitMinor);
    const creditMinor = BigInt(l.creditMinor);
    totalDebitMinor += debitMinor;
    totalCreditMinor += creditMinor;
    return {
      accountId: l.accountId,
      description: l.description ?? null,
      debitMinor,
      creditMinor,
      sortOrder: i,
    };
  });
  return { lines, totalDebitMinor, totalCreditMinor };
}

/** Parse an ISO date (YYYY-MM-DD) into a UTC-midnight Date for @db.Date columns. */
export function parseIsoDate(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

/**
 * Finds the fiscal period covering a date. Returns null when no period covers
 * it — posting then fails with `no_fiscal_period`, keeping the ledger inside a
 * defined fiscal structure.
 */
export async function resolvePeriodForDate(
  tx: Tx,
  organizationId: string,
  date: Date,
): Promise<{ id: string; status: string } | null> {
  const period = await tx.fiscalPeriod.findFirst({
    where: { organizationId, startDate: { lte: date }, endDate: { gte: date } },
    orderBy: { startDate: 'desc' },
    select: { id: true, status: true },
  });
  return period;
}

/**
 * Resolves the covering period for a voucher's date and asserts it can accept a
 * posting (must exist and be OPEN). Returns the period id to stamp on the
 * voucher. Throws 409 when missing or locked/closed.
 */
export async function assertPostablePeriod(
  tx: Tx,
  organizationId: string,
  date: Date,
): Promise<string> {
  const period = await resolvePeriodForDate(tx, organizationId, date);
  if (!period) {
    throw errors.conflict(
      'no_fiscal_period',
      'No fiscal period covers this date; create one before posting',
    );
  }
  // Lock the period row and re-read its status under the lock, so a concurrent
  // lock/close of this period serializes with the posting (TOCTOU): either the
  // post commits before the lock, or it sees the new status and is rejected.
  await tx.$executeRaw`SELECT id FROM fiscal_periods WHERE id = ${period.id}::uuid FOR UPDATE`;
  const locked = await tx.fiscalPeriod.findUnique({
    where: { id: period.id },
    select: { status: true },
  });
  if (!locked || locked.status !== 'OPEN') {
    throw errors.conflict(
      'period_locked',
      `The fiscal period is ${locked?.status ?? 'missing'} and cannot accept postings`,
    );
  }
  return period.id;
}
