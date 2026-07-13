import { EXCHANGE_NAME, type OutboxEnvelope } from '@businessos/types';
import type { PrismaClient } from '@businessos/db';
import type { Logger } from 'pino';
import type { AmqpConfirmChannel } from './amqp.js';

const POLL_INTERVAL_MS = 1_000;
const BATCH_SIZE = 50;
const MAX_RELAY_ATTEMPTS = 10;

/**
 * Polls the transactional outbox and publishes pending rows to the events
 * exchange. Runs as a single instance (one worker) — with multiple workers
 * this loop must move to SELECT ... FOR UPDATE SKIP LOCKED, documented in
 * ADR-0005.
 */
export function startOutboxRelay(
  prisma: PrismaClient,
  channel: AmqpConfirmChannel,
  logger: Logger,
): { stop: () => void } {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;

  async function tick(): Promise<void> {
    try {
      const pending = await prisma.outboxMessage.findMany({
        where: { publishedAt: null, attempts: { lt: MAX_RELAY_ATTEMPTS } },
        orderBy: { occurredAt: 'asc' },
        take: BATCH_SIZE,
      });

      for (const message of pending) {
        const envelope: OutboxEnvelope = {
          id: message.id,
          type: message.type as OutboxEnvelope['type'],
          payload: message.payload,
          occurredAt: message.occurredAt.toISOString(),
        };
        try {
          channel.publish(EXCHANGE_NAME, message.type, Buffer.from(JSON.stringify(envelope)), {
            persistent: true,
            messageId: message.id,
            contentType: 'application/json',
          });
          await channel.waitForConfirms();
          await prisma.outboxMessage.update({
            where: { id: message.id },
            data: { publishedAt: new Date() },
          });
        } catch (error) {
          logger.error({ err: error, messageId: message.id }, 'outbox publish failed');
          await prisma.outboxMessage.update({
            where: { id: message.id },
            data: {
              attempts: { increment: 1 },
              lastError: error instanceof Error ? error.message.slice(0, 1000) : String(error),
            },
          });
        }
      }
    } catch (error) {
      logger.error({ err: error }, 'outbox relay tick failed');
    } finally {
      if (!stopped) timer = setTimeout(() => void tick(), POLL_INTERVAL_MS);
    }
  }

  void tick();
  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
