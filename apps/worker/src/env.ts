import { commonEnvSchema, loadRootDotenv, parseEnv } from '@businessos/config';
import { z } from 'zod';

loadRootDotenv();

export const env = parseEnv({
  ...commonEnvSchema,
  DATABASE_URL: z.string().url(),
  RABBITMQ_URL: z.string().min(1),
  WORKER_HEALTH_PORT: z.coerce.number().int().min(1).max(65535).default(3009),
  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535),
  SMTP_FROM: z.string().min(3),
});

export type WorkerEnv = typeof env;
