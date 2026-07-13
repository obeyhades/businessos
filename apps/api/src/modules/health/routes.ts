import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

const healthResponseSchema = z.object({
  status: z.string(),
  checks: z.record(z.string()).optional(),
});

export function registerHealthRoutes(app: FastifyInstance): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // Liveness: the process is up and the event loop responds.
  r.route({
    method: 'GET',
    url: '/healthz',
    schema: { tags: ['health'], response: { 200: healthResponseSchema } },
    handler: async (_request, reply) => reply.send({ status: 'ok' }),
  });

  // Readiness: dependencies are reachable.
  r.route({
    method: 'GET',
    url: '/readyz',
    schema: { tags: ['health'] },
    handler: async (_request, reply) => {
      try {
        await app.prisma.$queryRaw`SELECT 1`;
        return reply.send({ status: 'ready', checks: { database: 'ok' } });
      } catch {
        return reply.code(503).send({ status: 'unavailable', checks: { database: 'failed' } });
      }
    },
  });
}
