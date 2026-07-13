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
}
