import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';
import { errors } from '../lib/errors.js';

export const SESSION_COOKIE = 'bos_session';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Security baseline: headers, CORS restricted to the web origin, global rate
 * limiting and an Origin/Referer CSRF check (defence in depth on top of
 * SameSite=Lax session cookies).
 */
export async function registerSecurity(app: FastifyInstance): Promise<void> {
  await app.register(helmet, {
    // JSON API — no HTML is served, CSP would only add noise to error responses.
    contentSecurityPolicy: false,
  });

  await app.register(cors, {
    origin: [app.config.WEB_ORIGIN],
    credentials: true,
  });

  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
  });

  await app.register(cookie);

  const allowedOrigins = new Set([app.config.WEB_ORIGIN, app.config.APP_BASE_URL]);

  app.addHook('onRequest', async (request) => {
    if (!UNSAFE_METHODS.has(request.method)) return;
    // CSRF only matters for cookie-authenticated requests.
    if (!request.headers.cookie?.includes(`${SESSION_COOKIE}=`)) return;

    const origin = request.headers.origin;
    if (origin) {
      if (!allowedOrigins.has(origin)) throw errors.csrfRejected();
      return;
    }
    const referer = request.headers.referer;
    if (referer) {
      const ok = [...allowedOrigins].some((allowed) => referer.startsWith(`${allowed}/`) || referer === allowed);
      if (!ok) throw errors.csrfRejected();
      return;
    }
    // Cookie-bearing state change without any origin information: reject.
    // Browser clients always send Origin for cross-site and fetch requests;
    // non-browser clients should use header-based auth (future API tokens).
    throw errors.csrfRejected();
  });
}
