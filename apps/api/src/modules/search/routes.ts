import { searchQuerySchema, searchResponseSchema, type SearchResult } from '@businessos/types';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { hasPermission } from '@businessos/types';
import { orgContext, requireAuth } from '../../plugins/auth.js';
import { errors } from '../../lib/errors.js';

/**
 * Organization-wide search across customers, projects and tasks. Each entity
 * type is only searched if the caller holds its read permission, so results
 * never leak data the role cannot otherwise see.
 */
export function registerSearchRoutes(app: FastifyInstance): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.route({
    method: 'GET',
    url: '/v1/search',
    preHandler: [requireAuth],
    schema: {
      tags: ['search'],
      querystring: searchQuerySchema,
      response: { 200: searchResponseSchema },
    },
    handler: async (request, reply) => {
      const membership = request.membership;
      if (!membership) throw errors.noActiveOrganization();
      const { organizationId } = orgContext(request);
      const { q, limit } = request.query;
      const contains = { contains: q, mode: 'insensitive' as const };
      const perType = Math.max(1, Math.ceil(limit / 3));
      const results: SearchResult[] = [];

      if (hasPermission(membership.role, 'customers.read')) {
        const customers = await app.prisma.customer.findMany({
          where: {
            organizationId,
            OR: [{ name: contains }, { email: contains }, { orgNumber: contains }],
          },
          orderBy: { name: 'asc' },
          take: perType,
        });
        for (const c of customers) {
          results.push({ kind: 'customer', id: c.id, title: c.name, subtitle: c.email ?? c.city });
        }
      }

      if (hasPermission(membership.role, 'projects.read')) {
        const projects = await app.prisma.project.findMany({
          where: { organizationId, name: contains },
          include: { customer: { select: { name: true } } },
          orderBy: { createdAt: 'desc' },
          take: perType,
        });
        for (const p of projects) {
          results.push({
            kind: 'project',
            id: p.id,
            title: p.name,
            subtitle: p.customer?.name ?? null,
          });
        }
      }

      if (hasPermission(membership.role, 'tasks.read')) {
        const tasks = await app.prisma.task.findMany({
          where: { organizationId, title: contains },
          orderBy: { createdAt: 'desc' },
          take: perType,
        });
        for (const t of tasks) {
          results.push({ kind: 'task', id: t.id, title: t.title, subtitle: t.status });
        }
      }

      return reply.send({ results: results.slice(0, limit) });
    },
  });
}
