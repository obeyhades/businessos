import { createPrismaClient } from '@businessos/db';
import { ObjectStorage } from '@businessos/storage';
import { assertTopology, connectWithRetry } from './amqp.js';
import { startAccountingConsumer } from './consumers/accounting.js';
import { startEmailConsumer } from './consumers/email.js';
import { startTranscriptionConsumer } from './consumers/transcription.js';
import { startWebhookConsumer } from './consumers/webhook.js';
import { startExportConsumer } from './consumers/export.js';
import { StubTranscriber } from './transcription/stub.js';
import { startWebhookRetrySweep } from './webhook-retry-sweep.js';
import { startRetentionSweep } from './retention-sweep.js';
import { createMailTransport } from './email/transport.js';
import { env } from './env.js';
import { startHealthServer } from './health.js';
import { buildLogger } from './lib/logger.js';
import { startOutboxRelay } from './outbox-relay.js';
import { startOverdueSweep } from './overdue-sweep.js';
import { startReminderSweep } from './reminder-sweep.js';

async function main(): Promise<void> {
  const logger = buildLogger(env);
  const prisma = createPrismaClient({ databaseUrl: env.DATABASE_URL });

  const connection = await connectWithRetry(env.RABBITMQ_URL, logger);
  let amqpConnected = true;
  connection.on('close', () => {
    amqpConnected = false;
    // Supervisor (docker/pm2/tsx watch) restarts us; reconnect loops belong to Phase 9 hardening.
    logger.error('rabbitmq connection closed, exiting');
    process.exit(1);
  });
  connection.on('error', (error) => logger.error({ err: error }, 'rabbitmq connection error'));

  const channel = await connection.createConfirmChannel();
  await assertTopology(channel);

  const transport = createMailTransport(env);
  const storage = new ObjectStorage({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    accessKeyId: env.S3_ACCESS_KEY,
    secretAccessKey: env.S3_SECRET_KEY,
    bucket: env.S3_BUCKET,
  });
  const relay = startOutboxRelay(prisma, channel, logger);
  await startEmailConsumer({ prisma, channel, transport, storage, from: env.SMTP_FROM, logger });
  await startAccountingConsumer({ prisma, channel, logger });
  // Phase 8: a deterministic local stub STT; Phase 9 swaps in a real provider.
  await startTranscriptionConsumer({
    prisma,
    channel,
    storage,
    transcriber: new StubTranscriber(),
    logger,
  });
  // Phase 9: integrations + compliance.
  await startWebhookConsumer({ prisma, channel, allowLocal: env.WEBHOOK_ALLOW_LOCAL, logger });
  await startExportConsumer({ prisma, channel, storage, logger });
  const overdueSweep = startOverdueSweep(prisma, env.OVERDUE_SWEEP_SECONDS, logger);
  const reminderSweep = startReminderSweep(prisma, env.REMINDER_SWEEP_SECONDS, logger);
  const webhookRetrySweep = startWebhookRetrySweep(
    prisma,
    env.WEBHOOK_RETRY_SWEEP_SECONDS,
    env.WEBHOOK_ALLOW_LOCAL,
    logger,
  );
  const retentionSweep = startRetentionSweep(prisma, storage, env.RETENTION_SWEEP_SECONDS, logger);
  const healthServer = startHealthServer(
    env.WORKER_HEALTH_PORT,
    prisma,
    () => amqpConnected,
    logger,
  );

  logger.info('worker started');

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'shutting down');
    relay.stop();
    overdueSweep.stop();
    reminderSweep.stop();
    webhookRetrySweep.stop();
    retentionSweep.stop();
    healthServer.close();
    try {
      await channel.close();
      await connection.close();
    } catch {
      // Connection may already be closed.
    }
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error) => {
  console.error('Worker failed to start:', error);
  process.exit(1);
});
