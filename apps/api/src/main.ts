import { createPrismaClient } from '@businessos/db';
import { buildApp } from './app.js';
import { env } from './env.js';

async function main(): Promise<void> {
  const prisma = createPrismaClient({ databaseUrl: env.DATABASE_URL });
  const app = await buildApp({ config: env, prisma });

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'shutting down');
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ port: env.API_PORT, host: env.API_HOST });
}

main().catch((error) => {
  console.error('API failed to start:', error);
  process.exit(1);
});
