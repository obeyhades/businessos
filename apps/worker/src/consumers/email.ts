import {
  DLX_NAME,
  EMAIL_QUEUE,
  EMAIL_RETRY_QUEUE,
  MAX_JOB_ATTEMPTS,
  RETRY_BASE_DELAY_MS,
  emailSendPayloadSchema,
  outboxEnvelopeSchema,
} from '@businessos/types';
import { Prisma, type PrismaClient } from '@businessos/db';
import type { ObjectStorage } from '@businessos/storage';
import type { Transporter } from 'nodemailer';
import type { Logger } from 'pino';
import type { AmqpConfirmChannel } from '../amqp.js';
import { sendEmail } from '../email/transport.js';

const CONSUMER_NAME = 'email.send';

interface EmailConsumerDeps {
  prisma: PrismaClient;
  channel: AmqpConfirmChannel;
  transport: Transporter;
  storage: ObjectStorage;
  from: string;
  logger: Logger;
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/**
 * email.send consumer. At-least-once with an idempotency ledger: a message id
 * already recorded in processed_messages is acked without another send.
 * Failures retry with exponential backoff via the TTL retry queue; after
 * MAX_JOB_ATTEMPTS the job lands in the DLQ and a failed_jobs row makes it
 * visible in the admin UI.
 */
export async function startEmailConsumer(deps: EmailConsumerDeps): Promise<void> {
  const { prisma, channel, transport, storage, from, logger } = deps;

  await channel.prefetch(5);
  await channel.consume(EMAIL_QUEUE, (message) => {
    if (!message) return;
    void (async () => {
      const attempts = Number(message.properties.headers?.['x-attempts'] ?? 0);
      let envelopeId: string | undefined;

      try {
        const envelope = outboxEnvelopeSchema.parse(JSON.parse(message.content.toString()));
        envelopeId = envelope.id;
        const payload = emailSendPayloadSchema.parse(envelope.payload);

        const alreadyProcessed = await prisma.processedMessage.findUnique({
          where: { messageId_consumer: { messageId: envelope.id, consumer: CONSUMER_NAME } },
        });
        if (alreadyProcessed) {
          logger.info({ messageId: envelope.id }, 'duplicate message skipped');
          channel.ack(message);
          return;
        }

        await sendEmail(transport, from, payload, storage);

        try {
          await prisma.processedMessage.create({
            data: { messageId: envelope.id, consumer: CONSUMER_NAME },
          });
        } catch (error) {
          // Concurrent duplicate — the send already happened, treat as done.
          if (!isUniqueViolation(error)) throw error;
        }

        logger.info({ messageId: envelope.id, kind: payload.kind }, 'email sent');
        channel.ack(message);
      } catch (error) {
        const nextAttempt = attempts + 1;
        logger.error(
          { err: error, messageId: envelopeId, attempt: nextAttempt },
          'email processing failed',
        );

        if (nextAttempt >= MAX_JOB_ATTEMPTS) {
          await prisma.failedJob
            .create({
              data: {
                queue: EMAIL_QUEUE,
                messageType: 'email.send',
                payload: JSON.parse(message.content.toString()) as Prisma.InputJsonValue,
                error: error instanceof Error ? error.message.slice(0, 2000) : String(error),
                attempts: nextAttempt,
              },
            })
            .catch((dbError) => logger.error({ err: dbError }, 'failed to record failed job'));
          channel.publish(DLX_NAME, EMAIL_QUEUE, message.content, {
            persistent: true,
            headers: { 'x-attempts': nextAttempt },
          });
        } else {
          const delay = RETRY_BASE_DELAY_MS * 2 ** (nextAttempt - 1);
          channel.sendToQueue(EMAIL_RETRY_QUEUE, message.content, {
            persistent: true,
            expiration: String(delay),
            headers: { 'x-attempts': nextAttempt },
          });
        }
        channel.ack(message);
      }
    })();
  });

  logger.info({ queue: EMAIL_QUEUE }, 'email consumer started');
}
