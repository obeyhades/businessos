import { ACCOUNTING_QUEUE, outboxEnvelopeSchema } from '@businessos/types';
import { Prisma, type PrismaClient } from '@businessos/db';
import type { Logger } from 'pino';
import type { AmqpConfirmChannel } from '../amqp.js';
import {
  generateInvoiceDraftVoucher,
  generatePaymentDraftVoucher,
  type DraftResult,
} from '../accounting-drafts.js';

const CONSUMER_NAME = 'accounting.draft';

interface AccountingConsumerDeps {
  prisma: PrismaClient;
  channel: AmqpConfirmChannel;
  logger: Logger;
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/**
 * accounting.draft consumer. Reacts to invoice.finalized / payment.registered
 * by generating a DRAFT voucher via the org's account mapping. At-least-once
 * with a processed-message idempotency ledger. Unlike email there is no retry
 * ladder: a hard failure is recorded to failed_jobs and acked (dropped) so a
 * bad message can't loop — the accountant can always create the voucher by
 * hand. Draft generation is best-effort; the ledger's integrity comes from the
 * post/balance/period rules in the API, not from this consumer.
 */
export async function startAccountingConsumer(deps: AccountingConsumerDeps): Promise<void> {
  const { prisma, channel, logger } = deps;

  await channel.prefetch(5);
  await channel.consume(ACCOUNTING_QUEUE, (message) => {
    if (!message) return;
    void (async () => {
      // Capture the raw body once — the error path must never re-parse it, or a
      // malformed payload would throw inside catch and the message would never ack.
      const rawContent = message.content.toString();
      let envelopeId: string | undefined;
      try {
        const envelope = outboxEnvelopeSchema.parse(JSON.parse(rawContent));
        envelopeId = envelope.id;

        const already = await prisma.processedMessage.findUnique({
          where: { messageId_consumer: { messageId: envelope.id, consumer: CONSUMER_NAME } },
        });
        if (already) {
          channel.ack(message);
          return;
        }

        const payload = envelope.payload as {
          organizationId?: string;
          invoiceId?: string;
          paymentId?: string;
        };
        let result: DraftResult | 'ignored' = 'ignored';
        if (envelope.type === 'invoice.finalized' && payload.organizationId && payload.invoiceId) {
          result = await generateInvoiceDraftVoucher(
            prisma,
            payload.organizationId,
            payload.invoiceId,
          );
        } else if (
          envelope.type === 'payment.registered' &&
          payload.organizationId &&
          payload.paymentId
        ) {
          result = await generatePaymentDraftVoucher(
            prisma,
            payload.organizationId,
            payload.paymentId,
          );
        }

        try {
          await prisma.processedMessage.create({
            data: { messageId: envelope.id, consumer: CONSUMER_NAME },
          });
        } catch (error) {
          if (!isUniqueViolation(error)) throw error;
        }

        logger.info(
          { messageId: envelope.id, type: envelope.type, result },
          'accounting draft processed',
        );
        channel.ack(message);
      } catch (error) {
        logger.error({ err: error, messageId: envelopeId }, 'accounting draft failed');
        await prisma.failedJob
          .create({
            data: {
              queue: ACCOUNTING_QUEUE,
              messageType: 'accounting.draft',
              // Store the raw body verbatim — never re-parse (it may be the very
              // thing that failed to parse).
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

  logger.info({ queue: ACCOUNTING_QUEUE }, 'accounting consumer started');
}
