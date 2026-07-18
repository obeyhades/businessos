import { EXCHANGE_NAME, type OutboxEnvelope } from '@businessos/types';
import { Prisma, type PrismaClient } from '@businessos/db';
import type { Logger } from 'pino';
import type { AmqpConfirmChannel } from './amqp.js';

const POLL_INTERVAL_MS = 1_000;
const BATCH_SIZE = 50;
const MAX_RELAY_ATTEMPTS = 10;
/** Row locks are held across broker confirms, so allow the batch some room. */
const TX_TIMEOUT_MS = 20_000;

interface OutboxRow {
  id: string;
  type: string;
  payload: unknown;
  occurred_at: Date;
}

/**
 * Polls the transactional outbox and publishes pending rows to the events
 * exchange. Multi-worker safe (ADR-0011): each tick claims a batch with
 * SELECT … FOR UPDATE SKIP LOCKED inside a transaction, so concurrent relays
 * never grab the same row and no event is double-published. The row is marked
 * published (or its attempt count bumped) in the SAME transaction that holds the
 * lock, and the broker confirm happens before the mark so a lost publish is
 * retried.
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
      await prisma.$transaction(
        async (tx) => {
          const rows = await tx.$queryRaw<OutboxRow[]>(Prisma.sql`
            SELECT id, type, payload, occurred_at
            FROM outbox_messages
            WHERE published_at IS NULL AND attempts < ${MAX_RELAY_ATTEMPTS}
            ORDER BY occurred_at ASC
            LIMIT ${BATCH_SIZE}
            FOR UPDATE SKIP LOCKED
          `);

          for (const message of rows) {
            const envelope: OutboxEnvelope = {
              id: message.id,
              type: message.type as OutboxEnvelope['type'],
              payload: message.payload,
              occurredAt: message.occurred_at.toISOString(),
            };
            try {
              channel.publish(EXCHANGE_NAME, message.type, Buffer.from(JSON.stringify(envelope)), {
                persistent: true,
                messageId: message.id,
                contentType: 'application/json',
              });
              await channel.waitForConfirms();
              await tx.outboxMessage.update({
                where: { id: message.id },
                data: { publishedAt: new Date() },
              });
            } catch (error) {
              logger.error({ err: error, messageId: message.id }, 'outbox publish failed');
              await tx.outboxMessage.update({
                where: { id: message.id },
                data: {
                  attempts: { increment: 1 },
                  lastError: error instanceof Error ? error.message.slice(0, 1000) : String(error),
                },
              });
            }
          }
        },
        { timeout: TX_TIMEOUT_MS },
      );
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
