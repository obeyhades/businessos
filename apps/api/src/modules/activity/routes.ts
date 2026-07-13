import { activityDtoSchema, paginatedSchema, paginationQuerySchema } from '@businessos/types';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { toActivityDto } from '../../lib/mappers-domain.js';
import { toPaginated, toSkipTake } from '../../lib/pagination.js';
import { orgContext, requirePermission } from '../../plugins/auth.js';

export function registerActivityRoutes(app: FastifyInstance): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // Organization-wide recent activity feed (dashboard).
  r.route({
    method: 'GET',
    url: '/v1/activity',
    preHandler: [requirePermission('dashboard.read')],
    schema: {
      tags: ['activity'],
      querystring: paginationQuerySchema,
      response: { 200: paginatedSchema(activityDtoSchema) },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const { skip, take } = toSkipTake(request.query);
      const where = { organizationId };
      const [rows, total] = await Promise.all([
        app.prisma.activity.findMany({
          where,
          include: { actor: true },
          orderBy: { createdAt: 'desc' },
          skip,
          take,
        }),
        app.prisma.activity.count({ where }),
      ]);
      return reply.send(toPaginated(rows.map(toActivityDto), total, request.query));
    },
  });
}
