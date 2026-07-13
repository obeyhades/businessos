import { Prisma, type PrismaClient } from '@businessos/db';

type Tx = Prisma.TransactionClient;

export type DraftResult =
  'created' | 'skipped:duplicate' | 'skipped:missing_source' | 'skipped:mapping_incomplete';

/** Truncate a timestamp to a UTC date-only value for @db.Date columns. */
function toDateOnly(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** A concurrent duplicate lost the race to the (org, sourceType, sourceId)
 *  partial-unique index — treat it as an already-generated draft. */
function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

async function resolvePeriodId(tx: Tx, organizationId: string, date: Date): Promise<string | null> {
  const period = await tx.fiscalPeriod.findFirst({
    where: { organizationId, startDate: { lte: date }, endDate: { gte: date } },
    orderBy: { startDate: 'desc' },
    select: { id: true },
  });
  return period?.id ?? null;
}

/** Confirm the mapped accounts still exist and are active in the org. */
async function activeAccountIds(
  tx: Tx,
  organizationId: string,
  ids: string[],
): Promise<Set<string>> {
  const rows = await tx.account.findMany({
    where: { id: { in: ids }, organizationId, isActive: true },
    select: { id: true },
  });
  return new Set(rows.map((r) => r.id));
}

interface DraftLine {
  accountId: string;
  description: string;
  debitMinor: bigint;
  creditMinor: bigint;
  sortOrder: number;
}

/**
 * Generates a DRAFT voucher from a finalized invoice using the org's account
 * mapping:  Dr Accounts receivable (gross) / Cr Sales (net) / Cr Output VAT
 * (tax). The accountant reviews and posts it. Idempotent via (sourceType,
 * sourceId) plus the consumer's processed-message ledger. Never posts
 * automatically — auto-posting is intentionally out of scope pending review.
 */
export async function generateInvoiceDraftVoucher(
  prisma: PrismaClient,
  organizationId: string,
  invoiceId: string,
): Promise<DraftResult> {
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, organizationId },
    select: {
      id: true,
      customerId: true,
      number: true,
      totalMinor: true,
      taxMinor: true,
      finalizedAt: true,
      issueDate: true,
    },
  });
  if (!invoice) return 'skipped:missing_source';

  const mapping = await prisma.accountMapping.findUnique({ where: { organizationId } });
  const receivable = mapping?.receivableAccountId ?? null;
  const sales = mapping?.salesAccountId ?? null;
  const vat = mapping?.outputVatAccountId ?? null;
  const total = invoice.totalMinor;
  const tax = invoice.taxMinor;
  const net = total - tax;
  if (!receivable || !sales || (tax > 0n && !vat)) return 'skipped:mapping_incomplete';

  try {
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.voucher.findFirst({
        where: { organizationId, sourceType: 'invoice', sourceId: invoiceId },
        select: { id: true },
      });
      if (existing) return 'skipped:duplicate';

      const need = [receivable, sales, ...(tax > 0n ? [vat!] : [])];
      const active = await activeAccountIds(tx, organizationId, need);
      if (need.some((id) => !active.has(id))) return 'skipped:mapping_incomplete';

      const label = `Invoice ${invoice.number ?? invoiceId}`;
      const date = toDateOnly(invoice.finalizedAt ?? invoice.issueDate);
      const lines: DraftLine[] = [
        {
          accountId: receivable,
          description: label,
          debitMinor: total,
          creditMinor: 0n,
          sortOrder: 0,
        },
        { accountId: sales, description: 'Sales', debitMinor: 0n, creditMinor: net, sortOrder: 1 },
      ];
      if (tax > 0n) {
        lines.push({
          accountId: vat!,
          description: 'Output VAT',
          debitMinor: 0n,
          creditMinor: tax,
          sortOrder: 2,
        });
      }

      const voucher = await tx.voucher.create({
        data: {
          organizationId,
          date,
          description: label,
          status: 'DRAFT',
          source: 'INVOICE',
          sourceType: 'invoice',
          sourceId: invoiceId,
          fiscalPeriodId: await resolvePeriodId(tx, organizationId, date),
          totalDebitMinor: total,
          totalCreditMinor: net + tax,
          lines: { create: lines.map((l) => ({ organizationId, ...l })) },
        },
      });
      await tx.auditLog.create({
        data: {
          organizationId,
          action: 'voucher.created',
          entityType: 'voucher',
          entityId: voucher.id,
          metadata: { source: 'invoice', invoiceId, auto: true },
        },
      });
      await tx.activity.create({
        data: {
          organizationId,
          type: 'invoice.accounting_drafted',
          customerId: invoice.customerId,
          metadata: { invoiceId, voucherId: voucher.id },
        },
      });
      return 'created';
    });
  } catch (err) {
    if (isUniqueViolation(err)) return 'skipped:duplicate';
    throw err;
  }
}

/**
 * Generates a DRAFT voucher from a registered payment:
 *   Dr Bank / Cr Accounts receivable, both for the payment amount.
 */
export async function generatePaymentDraftVoucher(
  prisma: PrismaClient,
  organizationId: string,
  paymentId: string,
): Promise<DraftResult> {
  const payment = await prisma.payment.findFirst({
    where: { id: paymentId, organizationId },
    select: {
      id: true,
      amountMinor: true,
      paidOn: true,
      invoice: { select: { number: true, customerId: true } },
    },
  });
  if (!payment) return 'skipped:missing_source';

  const mapping = await prisma.accountMapping.findUnique({ where: { organizationId } });
  const bank = mapping?.bankAccountId ?? null;
  const receivable = mapping?.receivableAccountId ?? null;
  if (!bank || !receivable) return 'skipped:mapping_incomplete';

  const amount = payment.amountMinor;
  try {
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.voucher.findFirst({
        where: { organizationId, sourceType: 'payment', sourceId: paymentId },
        select: { id: true },
      });
      if (existing) return 'skipped:duplicate';

      const active = await activeAccountIds(tx, organizationId, [bank, receivable]);
      if (!active.has(bank) || !active.has(receivable)) return 'skipped:mapping_incomplete';

      const label = `Payment for invoice ${payment.invoice.number ?? ''}`.trim();
      const date = toDateOnly(payment.paidOn);
      const voucher = await tx.voucher.create({
        data: {
          organizationId,
          date,
          description: label,
          status: 'DRAFT',
          source: 'PAYMENT',
          sourceType: 'payment',
          sourceId: paymentId,
          fiscalPeriodId: await resolvePeriodId(tx, organizationId, date),
          totalDebitMinor: amount,
          totalCreditMinor: amount,
          lines: {
            create: [
              {
                organizationId,
                accountId: bank,
                description: label,
                debitMinor: amount,
                creditMinor: 0n,
                sortOrder: 0,
              },
              {
                organizationId,
                accountId: receivable,
                description: 'Accounts receivable',
                debitMinor: 0n,
                creditMinor: amount,
                sortOrder: 1,
              },
            ],
          },
        },
      });
      await tx.auditLog.create({
        data: {
          organizationId,
          action: 'voucher.created',
          entityType: 'voucher',
          entityId: voucher.id,
          metadata: { source: 'payment', paymentId, auto: true },
        },
      });
      await tx.activity.create({
        data: {
          organizationId,
          type: 'invoice.accounting_drafted',
          customerId: payment.invoice.customerId,
          metadata: { paymentId, voucherId: voucher.id },
        },
      });
      return 'created';
    });
  } catch (err) {
    if (isUniqueViolation(err)) return 'skipped:duplicate';
    throw err;
  }
}

export { Prisma };
