import { createPrismaClient } from '@businessos/db';
import { assertTopology, connectWithRetry } from './amqp.js';
import { startEmailConsumer } from './consumers/email.js';
import { createMailTransport } from './email/transport.js';
import { env } from './env.js';
import { startHealthServer } from './health.js';
import { buildLogger } from './lib/logger.js';
import { startOutboxRelay } from './outbox-relay.js';

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
  const relay = startOutboxRelay(prisma, channel, logger);
  await startEmailConsumer({ prisma, channel, transport, from: env.SMTP_FROM, logger });
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
