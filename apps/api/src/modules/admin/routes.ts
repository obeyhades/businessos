import {
  failedJobDtoSchema,
  failedJobIdParamsSchema,
  domainEventTypes,
  paginatedSchema,
  paginationQuerySchema,
  type DomainEventType,
} from '@businessos/types';
import type { FailedJob, Prisma } from '@businessos/db';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { errors } from '../../lib/errors.js';
import { toPaginated, toSkipTake } from '../../lib/pagination.js';
import { requirePlatformAdmin } from '../../plugins/auth.js';

function toFailedJobDto(job: FailedJob) {
  return {
    id: job.id,
    queue: job.queue,
    messageType: job.messageType,
    error: job.error,
    attempts: job.attempts,
    payload: job.payload,
    failedAt: job.failedAt.toISOString(),
    retriedAt: job.retriedAt?.toISOString() ?? null,
  };
}

/**
 * Failed-job viewer. Platform-operator scope: dead-lettered jobs are
 * system-level and may span organizations, so an organization role is
 * never enough — the user account must be flagged isPlatformAdmin.
 */
export function registerAdminRoutes(app: FastifyInstance): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.route({
    method: 'GET',
    url: '/v1/admin/failed-jobs',
    preHandler: [requirePlatformAdmin],
    schema: {
      tags: ['admin'],
      querystring: paginationQuerySchema,
      response: { 200: paginatedSchema(failedJobDtoSchema) },
    },
    handler: async (request, reply) => {
      const { skip, take } = toSkipTake(request.query);
      const [jobs, total] = await Promise.all([
        app.prisma.failedJob.findMany({ orderBy: { failedAt: 'desc' }, skip, take }),
        app.prisma.failedJob.count(),
      ]);
      return reply.send(toPaginated(jobs.map(toFailedJobDto), total, request.query));
    },
  });

  r.route({
    method: 'POST',
    url: '/v1/admin/failed-jobs/:failedJobId/retry',
    preHandler: [requirePlatformAdmin],
    schema: { tags: ['admin'], params: failedJobIdParamsSchema },
    handler: async (request, reply) => {
      const job = await app.prisma.failedJob.findUnique({
        where: { id: request.params.failedJobId },
      });
      if (!job) throw errors.notFound('Failed job');
      if (!domainEventTypes.includes(job.messageType as DomainEventType)) {
        throw errors.badRequest('unknown_message_type', 'This job type can no longer be retried');
      }

      await app.prisma.$transaction(async (tx) => {
        // Re-enqueue through the outbox; the relay picks it up like any new message.
        await tx.outboxMessage.create({
          data: { type: job.messageType, payload: job.payload as Prisma.InputJsonValue },
        });
        await tx.failedJob.update({
          where: { id: job.id },
          data: { retriedAt: new Date() },
        });
      });
      return reply.code(204).send();
    },
  });
}
