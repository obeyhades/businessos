import {
  changePasswordBodySchema,
  updateProfileBodySchema,
  userDtoSchema,
} from '@businessos/types';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { errors } from '../../lib/errors.js';
import { toUserDto } from '../../lib/mappers.js';
import { hashPassword, verifyPassword } from '../../lib/passwords.js';
import { requireAuth } from '../../plugins/auth.js';
import { auditContext, recordAudit } from '../audit/service.js';

export function registerMeRoutes(app: FastifyInstance): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.route({
    method: 'GET',
    url: '/v1/me',
    preHandler: [requireAuth],
    schema: { tags: ['me'], response: { 200: userDtoSchema } },
    handler: async (request, reply) => {
      const user = request.currentUser;
      if (!user) throw errors.unauthorized();
      return reply.send(toUserDto(user));
    },
  });

  r.route({
    method: 'PATCH',
    url: '/v1/me',
    preHandler: [requireAuth],
    schema: { tags: ['me'], body: updateProfileBodySchema, response: { 200: userDtoSchema } },
    handler: async (request, reply) => {
      const user = request.currentUser;
      if (!user) throw errors.unauthorized();
      const updated = await app.prisma.$transaction(async (tx) => {
        const result = await tx.user.update({
          where: { id: user.id },
          data: {
            ...(request.body.name !== undefined ? { name: request.body.name } : {}),
            ...(request.body.locale !== undefined ? { locale: request.body.locale } : {}),
          },
        });
        await recordAudit(tx, {
          action: 'user.profile_updated',
          ...auditContext(request),
          entityType: 'user',
          entityId: user.id,
          metadata: { fields: Object.keys(request.body) },
        });
        return result;
      });
      return reply.send(toUserDto(updated));
    },
  });

  r.route({
    method: 'PATCH',
    url: '/v1/me/password',
    preHandler: [requireAuth],
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema: { tags: ['me'], body: changePasswordBodySchema },
    handler: async (request, reply) => {
      const user = request.currentUser;
      const session = request.currentSession;
      if (!user || !session) return reply.code(401).send();

      const valid = await verifyPassword(user.passwordHash, request.body.currentPassword);
      if (!valid) throw errors.badRequest('invalid_password', 'Current password is incorrect');

      const passwordHash = await hashPassword(request.body.newPassword);
      await app.prisma.$transaction(async (tx) => {
        await tx.user.update({ where: { id: user.id }, data: { passwordHash } });
        // Sign out every other device; keep the session that made the change.
        await tx.session.deleteMany({ where: { userId: user.id, id: { not: session.id } } });
        await recordAudit(tx, {
          action: 'user.password_changed',
          ...auditContext(request),
          entityType: 'user',
          entityId: user.id,
        });
      });
      return reply.code(204).send();
    },
  });
}
