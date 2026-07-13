import type { FastifyReply } from 'fastify';
import type { ApiConfig } from '../config.js';
import { SESSION_COOKIE } from '../plugins/security.js';
import { SESSION_TTL_SECONDS } from '../modules/auth/session.js';

export function setSessionCookie(reply: FastifyReply, config: ApiConfig, token: string): void {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}
