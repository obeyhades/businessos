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
});

export type ApiEnv = typeof env;
