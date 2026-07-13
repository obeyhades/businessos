import {
  forgotPasswordBodySchema,
  loginBodySchema,
  registerBodySchema,
  resetPasswordBodySchema,
  sessionDtoSchema,
} from '@businessos/types';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { clearSessionCookie, setSessionCookie } from '../../lib/cookies.js';
import { errors } from '../../lib/errors.js';
import { auditContext, recordAudit } from '../audit/service.js';
import { requireAuth } from '../../plugins/auth.js';
import {
  registerUser,
  requestPasswordReset,
  resetPassword,
  verifyLogin,
} from './service.js';
import { buildSessionDto, createSession, defaultOrganizationId } from './session.js';

const AUTH_RATE_LIMIT = { max: 10, timeWindow: '1 minute' } as const;

export function registerAuthRoutes(app: FastifyInstance): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const deps = { prisma: app.prisma, config: app.config };

  r.route({
    method: 'POST',
    url: '/v1/auth/register',
    config: { rateLimit: AUTH_RATE_LIMIT },
    schema: {
      tags: ['auth'],
      body: registerBodySchema,
      response: { 201: sessionDtoSchema },
    },
    handler: async (request, reply) => {
      const meta = { ip: request.ip, userAgent: request.headers['user-agent'] };
      const user = await registerUser(deps, request.body, meta);
      const { token } = await createSession(app.prisma, user.id, null, meta);
      setSessionCookie(reply, app.config, token);
      return reply.code(201).send(await buildSessionDto(app.prisma, user, null));
    },
  });

  r.route({
    method: 'POST',
    url: '/v1/auth/login',
    config: { rateLimit: AUTH_RATE_LIMIT },
    schema: {
      tags: ['auth'],
      body: loginBodySchema,
      response: { 200: sessionDtoSchema },
    },
    handler: async (request, reply) => {
      const meta = { ip: request.ip, userAgent: request.headers['user-agent'] };
      const user = await verifyLogin(deps, request.body, meta);
      const activeOrganizationId = await defaultOrganizationId(app.prisma, user.id);
      const { token } = await createSession(app.prisma, user.id, activeOrganizationId, meta);
      setSessionCookie(reply, app.config, token);
      return reply.send(await buildSessionDto(app.prisma, user, activeOrganizationId));
    },
  });

  r.route({
    method: 'POST',
    url: '/v1/auth/logout',
    preHandler: [requireAuth],
    schema: { tags: ['auth'] },
    handler: async (request, reply) => {
      // requireAuth guarantees these are set.
      const session = request.currentSession;
      if (session) {
        await app.prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
      }
      await recordAudit(app.prisma, {
        action: 'user.logout',
        ...auditContext(request),
        entityType: 'user',
        entityId: request.currentUser?.id,
      });
      clearSessionCookie(reply);
      return reply.code(204).send();
    },
  });

  r.route({
    method: 'POST',
    url: '/v1/auth/forgot-password',
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    schema: { tags: ['auth'], body: forgotPasswordBodySchema },
    handler: async (request, reply) => {
      await requestPasswordReset(deps, request.body, {
        ip: request.ip,
        userAgent: request.headers['user-agent'],
      });
      // Identical response whether or not the account exists.
      return reply.code(204).send();
    },
  });

  r.route({
    method: 'POST',
    url: '/v1/auth/reset-password',
    config: { rateLimit: AUTH_RATE_LIMIT },
    schema: { tags: ['auth'], body: resetPasswordBodySchema },
    handler: async (request, reply) => {
      await resetPassword(deps, request.body, {
        ip: request.ip,
        userAgent: request.headers['user-agent'],
      });
      return reply.code(204).send();
    },
  });

  r.route({
    method: 'GET',
    url: '/v1/auth/session',
    preHandler: [requireAuth],
    schema: { tags: ['auth'], response: { 200: sessionDtoSchema } },
    handler: async (request, reply) => {
      const user = request.currentUser;
      const session = request.currentSession;
      if (!user || !session) throw errors.unauthorized();
      // Only report an active organization the user is still a member of.
      const activeOrganizationId = request.membership ? session.activeOrganizationId : null;
      return reply.send(await buildSessionDto(app.prisma, user, activeOrganizationId));
    },
  });
}
