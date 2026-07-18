/**
 * Runtime configuration contract for the API. `src/env.ts` produces this from
 * validated environment variables; tests construct it directly.
 */
export interface ApiConfig {
  NODE_ENV: 'development' | 'test' | 'production';
  LOG_LEVEL: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  API_PORT: number;
  API_HOST: string;
  DATABASE_URL: string;
  SESSION_SECRET: string;
  WEB_ORIGIN: string;
  APP_BASE_URL: string;
  S3_ENDPOINT: string;
  S3_ACCESS_KEY: string;
  S3_SECRET_KEY: string;
  S3_BUCKET: string;
  S3_REGION: string;
  INBOUND_EMAIL_SECRET: string;
  WEBHOOK_ALLOW_LOCAL: boolean;
}
