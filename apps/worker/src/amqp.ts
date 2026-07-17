import amqplib from 'amqplib';
import {
  ACCOUNTING_QUEUE,
  DEAD_LETTER_QUEUE,
  DLX_NAME,
  EMAIL_QUEUE,
  EMAIL_RETRY_QUEUE,
  EXCHANGE_NAME,
  TRANSCRIPTION_QUEUE,
} from '@businessos/types';
import type { Logger } from 'pino';

export type AmqpConnection = Awaited<ReturnType<typeof amqplib.connect>>;
export type AmqpConfirmChannel = Awaited<ReturnType<AmqpConnection['createConfirmChannel']>>;

const CONNECT_ATTEMPTS = 10;
const CONNECT_RETRY_DELAY_MS = 3_000;

export async function connectWithRetry(url: string, logger: Logger): Promise<AmqpConnection> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= CONNECT_ATTEMPTS; attempt += 1) {
    try {
      return await amqplib.connect(url);
    } catch (error) {
      lastError = error;
      logger.warn({ attempt, maxAttempts: CONNECT_ATTEMPTS }, 'rabbitmq connect failed, retrying');
      await new Promise((resolve) => setTimeout(resolve, CONNECT_RETRY_DELAY_MS));
    }
  }
  throw lastError;
}

/**
 * Declares the full messaging topology. Idempotent — safe to run on every
 * worker start.
 *
 * events exchange (topic) ──▶ email.send queue ──(nack after max attempts)──▶ handled in code
 *                              │
 *                              └─ retries go to email.send.retry with a per-message
 *                                 TTL, whose dead-letter target is the events
 *                                 exchange again (routing key email.send).
 * dlx exchange (topic) ──▶ businessos.dead-letter (paired with a failed_jobs row)
 */
export async function assertTopology(channel: AmqpConfirmChannel): Promise<void> {
  await channel.assertExchange(EXCHANGE_NAME, 'topic', { durable: true });
  await channel.assertExchange(DLX_NAME, 'topic', { durable: true });

  await channel.assertQueue(EMAIL_QUEUE, { durable: true });
  await channel.bindQueue(EMAIL_QUEUE, EXCHANGE_NAME, 'email.send');

  await channel.assertQueue(EMAIL_RETRY_QUEUE, {
    durable: true,
    arguments: {
      'x-dead-letter-exchange': EXCHANGE_NAME,
      'x-dead-letter-routing-key': 'email.send',
    },
  });

  // Phase 5: draft-voucher generation reacts to invoice + payment events.
  await channel.assertQueue(ACCOUNTING_QUEUE, { durable: true });
  await channel.bindQueue(ACCOUNTING_QUEUE, EXCHANGE_NAME, 'invoice.finalized');
  await channel.bindQueue(ACCOUNTING_QUEUE, EXCHANGE_NAME, 'payment.registered');

  // Phase 8: async speech-to-text reacts to uploaded recordings.
  await channel.assertQueue(TRANSCRIPTION_QUEUE, { durable: true });
  await channel.bindQueue(TRANSCRIPTION_QUEUE, EXCHANGE_NAME, 'recording.uploaded');

  await channel.assertQueue(DEAD_LETTER_QUEUE, { durable: true });
  await channel.bindQueue(DEAD_LETTER_QUEUE, DLX_NAME, '#');
}
