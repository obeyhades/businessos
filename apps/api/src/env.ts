import { commonEnvSchema, loadRootDotenv, parseEnv } from '@businessos/config';
import { z } from 'zod';

loadRootDotenv();

export const env = parseEnv({
  ...commonEnvSchema,
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  API_HOST: z.string().default('127.0.0.1'),
  DATABASE_URL: z.string().url(),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  WEB_ORIGIN: z.string().url(),
  APP_BASE_URL: z.string().url(),
  S3_ENDPOINT: z.string().url(),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  S3_BUCKET: z.string().min(1),
  S3_REGION: z.string().min(1).default('us-east-1'),
  /** Shared secret the inbound-email provider webhook must present. Required
   *  (no default) so a misconfigured deploy can't accept forged inbound mail. */
  INBOUND_EMAIL_SECRET: z.string().min(16, 'INBOUND_EMAIL_SECRET must be at least 16 characters'),
  /** Dev/test only: allow webhook URLs to target http/loopback hosts. MUST stay
   *  false in production or the SSRF guard is defeated. */
  WEBHOOK_ALLOW_LOCAL: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1'),
});

export type ApiEnv = typeof env;
