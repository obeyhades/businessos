import { WEBHOOK_MAX_ATTEMPTS } from '@businessos/types';
import type { PrismaClient } from '@businessos/db';
import type { Logger } from 'pino';
import { attemptDelivery } from './webhook/deliver.js';

const BATCH = 50;
/** A never-attempted PENDING row this old is treated as a crashed inline
 *  attempt and recovered (the grace window avoids racing the live inline send). */
const STRANDED_GRACE_MS = 2 * 60 * 1000;

/**
 * Re-attempts webhook deliveries whose backoff has elapsed. Retriable failures
 * are left PENDING with a future nextAttemptAt by the delivery step, so this
 * only picks up rows that are actually due (or a crash-stranded first attempt).
 * A `running` guard prevents overlapping sweeps.
 */
export function startWebhookRetrySweep(
  prisma: PrismaClient,
  intervalSeconds: number,
  allowLocal: boolean,
  logger: Logger,
): { stop: () => void } {
  let stopped = false;
  let running = false;
  let timer: NodeJS.Timeout | undefined;

  async function sweep(): Promise<void> {
    if (running) return;
    running = true;
    try {
      const now = new Date();
      const due = await prisma.webhookDelivery.findMany({
        where: {
          status: 'PENDING',
          attempts: { lt: WEBHOOK_MAX_ATTEMPTS },
          endpoint: { enabled: true },
          OR: [
            { nextAttemptAt: { lte: now } },
            { nextAttemptAt: null, createdAt: { lt: new Date(now.getTime() - STRANDED_GRACE_MS) } },
          ],
        },
        include: { endpoint: true },
        orderBy: { nextAttemptAt: { sort: 'asc', nulls: 'first' } },
        take: BATCH,
      });

      for (const delivery of due) {
        try {
          await attemptDelivery(prisma, delivery.endpoint, delivery, allowLocal);
        } catch (err) {
          logger.error({ err, deliveryId: delivery.id }, 'webhook retry attempt errored');
        }
      }
      if (due.length > 0) logger.info({ count: due.length }, 'webhook retry sweep processed');
    } catch (err) {
      logger.error({ err }, 'webhook retry sweep failed');
    } finally {
      running = false;
      if (!stopped) timer = setTimeout(() => void sweep(), intervalSeconds * 1000);
    }
  }

  timer = setTimeout(() => void sweep(), intervalSeconds * 1000);
  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
