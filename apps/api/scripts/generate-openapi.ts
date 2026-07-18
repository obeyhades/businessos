/**
 * Emits the OpenAPI document to apps/api/openapi.json without needing a
 * database — PrismaClient connects lazily and no query runs during boot.
 * CI regenerates the file and fails if it drifts from the committed copy.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createPrismaClient } from '@businessos/db';
import { buildApp } from '../src/app.js';

async function main(): Promise<void> {
  const app = await buildApp({
    config: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'warn',
      API_PORT: 0,
      API_HOST: '127.0.0.1',
      DATABASE_URL: 'postgresql://unused:unused@localhost:5432/unused',
      SESSION_SECRET: 'openapi-generation-dummy-secret-0123456789',
      WEB_ORIGIN: 'http://localhost:3000',
      APP_BASE_URL: 'http://localhost:3000',
      S3_ENDPOINT: 'http://localhost:9000',
      S3_ACCESS_KEY: 'unused',
      S3_SECRET_KEY: 'unused',
      S3_BUCKET: 'unused',
      S3_REGION: 'us-east-1',
      INBOUND_EMAIL_SECRET: 'unused',
      WEBHOOK_ALLOW_LOCAL: false,
    },
    prisma: createPrismaClient({ databaseUrl: 'postgresql://unused:unused@localhost:5432/unused' }),
    logger: false,
  });
  await app.ready();
  const spec = app.swagger();
  const outPath = resolve(import.meta.dirname, '../openapi.json');
  writeFileSync(outPath, `${JSON.stringify(spec, null, 2)}\n`);
  await app.close();
  console.warn(`OpenAPI spec written to ${outPath}`);
}

main().catch((error) => {
  console.error('OpenAPI generation failed:', error);
  process.exit(1);
});
