import type { PrismaClient } from '@businessos/db';
import type { Logger } from 'pino';

const OPEN_STATUSES = ['OPEN', 'SENT', 'PARTIALLY_PAID'] as const;

/**
 * Periodically flags issued-but-unpaid invoices past their due date as OVERDUE
 * and records an audit + activity row. A payment or credit moves them back out
 * of OVERDUE via the API's status recomputation. Runs as a single instance.
 */
export function startOverdueSweep(
  prisma: PrismaClient,
  intervalSeconds: number,
  logger: Logger,
): { stop: () => void } {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;

  async function sweep(): Promise<void> {
    try {
      const now = new Date();
      const overdue = await prisma.invoice.findMany({
        where: { status: { in: [...OPEN_STATUSES] }, dueDate: { lt: now } },
        select: { id: true, organizationId: true, customerId: true, number: true },
        take: 500,
      });
      for (const invoice of overdue) {
        await prisma.$transaction(async (tx) => {
          // Re-check inside the tx: only flip if still unpaid past due.
          const current = await tx.invoice.findUnique({
            where: { id: invoice.id },
            select: { status: true, totalMinor: true, amountPaidMinor: true, creditedMinor: true },
          });
          if (
            !current ||
            !OPEN_STATUSES.includes(current.status as (typeof OPEN_STATUSES)[number])
          ) {
            return;
          }
          const due = current.totalMinor - current.amountPaidMinor - current.creditedMinor;
          if (due <= 0n) return;

          await tx.invoice.update({ where: { id: invoice.id }, data: { status: 'OVERDUE' } });
          await tx.auditLog.create({
            data: {
              organizationId: invoice.organizationId,
              action: 'invoice.overdue',
              entityType: 'invoice',
              entityId: invoice.id,
              metadata: { number: invoice.number },
            },
          });
          await tx.activity.create({
            data: {
              organizationId: invoice.organizationId,
              type: 'invoice.overdue',
              customerId: invoice.customerId,
              metadata: { number: invoice.number },
            },
          });
        });
      }
      if (overdue.length > 0)
        logger.info({ count: overdue.length }, 'overdue sweep flagged invoices');
    } catch (error) {
      logger.error({ err: error }, 'overdue sweep failed');
    } finally {
      if (!stopped) timer = setTimeout(() => void sweep(), intervalSeconds * 1000);
    }
  }

  // First sweep shortly after boot, then on the configured interval.
  timer = setTimeout(() => void sweep(), 5_000);
  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
