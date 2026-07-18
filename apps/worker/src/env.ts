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
  S3_ENDPOINT: z.string().url(),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  S3_BUCKET: z.string().min(1),
  S3_REGION: z.string().min(1).default('us-east-1'),
  /** How often to sweep for overdue invoices, in seconds. */
  OVERDUE_SWEEP_SECONDS: z.coerce.number().int().min(30).default(300),
  /** How often to sweep for due event reminders, in seconds. */
  REMINDER_SWEEP_SECONDS: z.coerce.number().int().min(15).default(60),
  /** How often to retry failed webhook deliveries, in seconds. */
  WEBHOOK_RETRY_SWEEP_SECONDS: z.coerce.number().int().min(5).default(30),
  /** How often to enforce data-retention policies, in seconds. */
  RETENTION_SWEEP_SECONDS: z.coerce.number().int().min(60).default(3600),
  /** Dev/test only: allow webhook delivery to http/loopback hosts. */
  WEBHOOK_ALLOW_LOCAL: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1'),
});

export type WorkerEnv = typeof env;
