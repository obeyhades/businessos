import {
  WEBHOOK_DISPATCH_QUEUE,
  outboxEnvelopeSchema,
  webhookableEventTypes,
} from '@businessos/types';
import { Prisma, type PrismaClient } from '@businessos/db';
import type { Logger } from 'pino';
import type { AmqpConfirmChannel } from '../amqp.js';
import { attemptDelivery } from '../webhook/deliver.js';

const WEBHOOKABLE = new Set<string>(webhookableEventTypes);

interface WebhookConsumerDeps {
  prisma: PrismaClient;
  channel: AmqpConfirmChannel;
  allowLocal: boolean;
  logger: Logger;
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/**
 * webhook.dispatch consumer. Bound to every domain event (# on the events
 * exchange), it fans each event out to the org's enabled endpoints that
 * subscribe to it, creating one delivery row per (endpoint, event) — unique, so
 * redelivery is idempotent — and attempting the first send inline. Failures are
 * left for the retry sweep. A bad message is recorded to failed_jobs and acked
 * so it can't loop.
 */
export async function startWebhookConsumer(deps: WebhookConsumerDeps): Promise<void> {
  const { prisma, channel, allowLocal, logger } = deps;

  await channel.prefetch(10);
  await channel.consume(WEBHOOK_DISPATCH_QUEUE, (message) => {
    if (!message) return;
    void (async () => {
      const rawContent = message.content.toString();
      let envelopeId: string | undefined;
      try {
        const envelope = outboxEnvelopeSchema.parse(JSON.parse(rawContent));
        envelopeId = envelope.id;

        // Only fan out real domain facts (never internal commands like email.send).
        if (WEBHOOKABLE.has(envelope.type)) {
          const payload = envelope.payload as { organizationId?: string } | null;
          const organizationId = payload?.organizationId;
          if (organizationId) {
            const endpoints = await prisma.webhookEndpoint.findMany({
              where: {
                organizationId,
                enabled: true,
                OR: [{ eventTypes: { has: envelope.type } }, { eventTypes: { has: '*' } }],
              },
            });
            for (const endpoint of endpoints) {
              let delivery;
              try {
                delivery = await prisma.webhookDelivery.create({
                  data: {
                    organizationId,
                    endpointId: endpoint.id,
                    eventId: envelope.id,
                    eventType: envelope.type,
                    payload: envelope as unknown as Prisma.InputJsonValue,
                    status: 'PENDING',
                  },
                });
              } catch (err) {
                if (isUniqueViolation(err)) continue; // already dispatched to this endpoint
                throw err;
              }
              await attemptDelivery(prisma, endpoint, delivery, allowLocal);
            }
          }
        }

        channel.ack(message);
      } catch (error) {
        logger.error({ err: error, messageId: envelopeId }, 'webhook dispatch failed');
        await prisma.failedJob
          .create({
            data: {
              queue: WEBHOOK_DISPATCH_QUEUE,
              messageType: 'webhook.dispatch',
              payload: { raw: rawContent } as Prisma.InputJsonValue,
              error: error instanceof Error ? error.message.slice(0, 2000) : String(error),
              attempts: 1,
            },
          })
          .catch((dbError) => logger.error({ err: dbError }, 'failed to record failed job'));
        channel.ack(message);
      }
    })();
  });

  logger.info({ queue: WEBHOOK_DISPATCH_QUEUE }, 'webhook consumer started');
}
