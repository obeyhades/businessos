import {
  createEmailLabelBodySchema,
  emailLabelDtoSchema,
  labelIdParamsSchema,
} from '@businessos/types';
import { Prisma } from '@businessos/db';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { errors } from '../../lib/errors.js';
import { orgContext, requirePermission } from '../../plugins/auth.js';
import { auditContext, recordAudit } from '../audit/service.js';
import { toEmailLabelDto } from './mappers.js';

export function registerEmailLabelRoutes(app: FastifyInstance): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.route({
    method: 'GET',
    url: '/v1/email/labels',
    preHandler: [requirePermission('email.read')],
    schema: { tags: ['email'], response: { 200: z.array(emailLabelDtoSchema) } },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const labels = await app.prisma.emailLabel.findMany({
        where: { organizationId },
        orderBy: { name: 'asc' },
      });
      return reply.send(labels.map(toEmailLabelDto));
    },
  });

  r.route({
    method: 'POST',
    url: '/v1/email/labels',
    preHandler: [requirePermission('email.send')],
    schema: {
      tags: ['email'],
      body: createEmailLabelBodySchema,
      response: { 201: emailLabelDtoSchema },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const body = request.body;
      try {
        const label = await app.prisma.$transaction(async (tx) => {
          const created = await tx.emailLabel.create({
            data: { organizationId, name: body.name, color: body.color },
          });
          await recordAudit(tx, {
            action: 'email_label.created',
            organizationId,
            ...auditContext(request),
            entityType: 'email_label',
            entityId: created.id,
            metadata: { name: created.name },
          });
          return created;
        });
        return reply.code(201).send(toEmailLabelDto(label));
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw errors.conflict('duplicate_label', `Label "${body.name}" already exists`);
        }
        throw err;
      }
    },
  });

  r.route({
    method: 'DELETE',
    url: '/v1/email/labels/:labelId',
    preHandler: [requirePermission('email.send')],
    schema: { tags: ['email'], params: labelIdParamsSchema },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const existing = await app.prisma.emailLabel.findFirst({
        where: { id: request.params.labelId, organizationId },
      });
      if (!existing) throw errors.notFound('Label');
      await app.prisma.$transaction(async (tx) => {
        await tx.emailLabel.delete({ where: { id: existing.id } });
        await recordAudit(tx, {
          action: 'email_label.deleted',
          organizationId,
          ...auditContext(request),
          entityType: 'email_label',
          entityId: existing.id,
          metadata: { name: existing.name },
        });
      });
      return reply.code(204).send();
    },
  });
}
