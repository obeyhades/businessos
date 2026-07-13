import { auditLogDtoSchema, paginatedSchema, paginationQuerySchema } from '@businessos/types';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { toAuditLogDto } from '../../lib/mappers.js';
import { toPaginated, toSkipTake } from '../../lib/pagination.js';
import { orgContext, requirePermission } from '../../plugins/auth.js';

export function registerAuditLogRoutes(app: FastifyInstance): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.route({
    method: 'GET',
    url: '/v1/organizations/current/audit-logs',
    preHandler: [requirePermission('audit.read')],
    schema: {
      tags: ['audit'],
      querystring: paginationQuerySchema,
      response: { 200: paginatedSchema(auditLogDtoSchema) },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const { skip, take } = toSkipTake(request.query);
      const [logs, total] = await Promise.all([
        app.prisma.auditLog.findMany({
          where: { organizationId },
          include: { actor: true },
          orderBy: { createdAt: 'desc' },
          skip,
          take,
        }),
        app.prisma.auditLog.count({ where: { organizationId } }),
      ]);
      return reply.send(toPaginated(logs.map(toAuditLogDto), total, request.query));
    },
  });
}
