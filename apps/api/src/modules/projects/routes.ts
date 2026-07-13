import {
  activityDtoSchema,
  createProjectBodySchema,
  paginatedSchema,
  paginationQuerySchema,
  projectDtoSchema,
  projectIdParamsSchema,
  projectListQuerySchema,
  updateProjectBodySchema,
} from '@businessos/types';
import type { Prisma } from '@businessos/db';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { errors } from '../../lib/errors.js';
import { toActivityDto, toProjectDto } from '../../lib/mappers-domain.js';
import { toPaginated, toSkipTake } from '../../lib/pagination.js';
import { orgContext, requirePermission } from '../../plugins/auth.js';
import { auditContext, recordAudit } from '../audit/service.js';
import { recordActivity } from '../activity/service.js';

const withCustomer = { customer: { select: { id: true, name: true } } } as const;

/** Ensures a customerId (if provided) belongs to this organization. */
async function assertCustomerInOrg(
  app: FastifyInstance,
  organizationId: string,
  customerId: string | null | undefined,
): Promise<void> {
  if (!customerId) return;
  const customer = await app.prisma.customer.findFirst({
    where: { id: customerId, organizationId },
    select: { id: true },
  });
  if (!customer)
    throw errors.badRequest('invalid_customer', 'Customer not found in this organization');
}

export function registerProjectRoutes(app: FastifyInstance): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.route({
    method: 'GET',
    url: '/v1/projects',
    preHandler: [requirePermission('projects.read')],
    schema: {
      tags: ['projects'],
      querystring: projectListQuerySchema,
      response: { 200: paginatedSchema(projectDtoSchema) },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const { skip, take } = toSkipTake(request.query);
      const where: Prisma.ProjectWhereInput = {
        organizationId,
        ...(request.query.status ? { status: request.query.status } : {}),
        ...(request.query.customerId ? { customerId: request.query.customerId } : {}),
        ...(request.query.search
          ? { name: { contains: request.query.search, mode: 'insensitive' } }
          : {}),
      };
      const [rows, total] = await Promise.all([
        app.prisma.project.findMany({
          where,
          include: withCustomer,
          orderBy: { createdAt: 'desc' },
          skip,
          take,
        }),
        app.prisma.project.count({ where }),
      ]);
      return reply.send(toPaginated(rows.map(toProjectDto), total, request.query));
    },
  });

  r.route({
    method: 'POST',
    url: '/v1/projects',
    preHandler: [requirePermission('projects.manage')],
    schema: {
      tags: ['projects'],
      body: createProjectBodySchema,
      response: { 201: projectDtoSchema },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const body = request.body;
      await assertCustomerInOrg(app, organizationId, body.customerId);

      const project = await app.prisma.$transaction(async (tx) => {
        const created = await tx.project.create({
          data: {
            organizationId,
            name: body.name,
            description: body.description ?? null,
            customerId: body.customerId ?? null,
            status: body.status,
            createdById: request.currentUser?.id ?? null,
          },
          include: withCustomer,
        });
        await recordAudit(tx, {
          action: 'project.created',
          organizationId,
          ...auditContext(request),
          entityType: 'project',
          entityId: created.id,
          metadata: { name: created.name },
        });
        await recordActivity(tx, {
          organizationId,
          actorUserId: request.currentUser?.id ?? null,
          type: 'project.created',
          ref: { projectId: created.id, customerId: created.customerId },
          metadata: { name: created.name },
        });
        return created;
      });
      return reply.code(201).send(toProjectDto(project));
    },
  });

  r.route({
    method: 'GET',
    url: '/v1/projects/:projectId',
    preHandler: [requirePermission('projects.read')],
    schema: {
      tags: ['projects'],
      params: projectIdParamsSchema,
      response: { 200: projectDtoSchema },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const project = await app.prisma.project.findFirst({
        where: { id: request.params.projectId, organizationId },
        include: withCustomer,
      });
      if (!project) throw errors.notFound('Project');
      return reply.send(toProjectDto(project));
    },
  });

  r.route({
    method: 'PATCH',
    url: '/v1/projects/:projectId',
    preHandler: [requirePermission('projects.manage')],
    schema: {
      tags: ['projects'],
      params: projectIdParamsSchema,
      body: updateProjectBodySchema,
      response: { 200: projectDtoSchema },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const existing = await app.prisma.project.findFirst({
        where: { id: request.params.projectId, organizationId },
      });
      if (!existing) throw errors.notFound('Project');
      const body = request.body;
      if (body.customerId !== undefined) {
        await assertCustomerInOrg(app, organizationId, body.customerId);
      }

      const updated = await app.prisma.$transaction(async (tx) => {
        const result = await tx.project.update({
          where: { id: existing.id },
          data: {
            ...(body.name !== undefined ? { name: body.name } : {}),
            ...(body.description !== undefined ? { description: body.description } : {}),
            ...(body.customerId !== undefined ? { customerId: body.customerId } : {}),
            ...(body.status !== undefined ? { status: body.status } : {}),
          },
          include: withCustomer,
        });
        const statusChanged = body.status !== undefined && body.status !== existing.status;
        await recordAudit(tx, {
          action:
            statusChanged && body.status === 'ARCHIVED' ? 'project.archived' : 'project.updated',
          organizationId,
          ...auditContext(request),
          entityType: 'project',
          entityId: existing.id,
          metadata: { fields: Object.keys(body) },
        });
        await recordActivity(tx, {
          organizationId,
          actorUserId: request.currentUser?.id ?? null,
          type: statusChanged ? 'project.status_changed' : 'project.updated',
          ref: { projectId: existing.id, customerId: result.customerId },
          ...(statusChanged ? { metadata: { from: existing.status, to: body.status } } : {}),
        });
        return result;
      });
      return reply.send(toProjectDto(updated));
    },
  });

  r.route({
    method: 'GET',
    url: '/v1/projects/:projectId/activity',
    preHandler: [requirePermission('projects.read')],
    schema: {
      tags: ['projects'],
      params: projectIdParamsSchema,
      querystring: paginationQuerySchema,
      response: { 200: paginatedSchema(activityDtoSchema) },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const project = await app.prisma.project.findFirst({
        where: { id: request.params.projectId, organizationId },
        select: { id: true },
      });
      if (!project) throw errors.notFound('Project');
      const { skip, take } = toSkipTake(request.query);
      const where = { organizationId, projectId: project.id };
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
