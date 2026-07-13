import { ApiError, createApiClient } from '@businessos/api-client';

/**
 * Single shared client. NEXT_PUBLIC_API_URL is inlined at build time
 * (apps/web/.env.development supplies the dev default); the localhost
 * fallback keeps a misconfigured production build loudly broken in the
 * network tab instead of silently pointing nowhere.
 */
export const api = createApiClient({
  baseUrl: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001',
});

export { ApiError };
