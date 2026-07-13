import {
  activityDtoSchema,
  createTaskBodySchema,
  paginatedSchema,
  paginationQuerySchema,
  taskDtoSchema,
  taskIdParamsSchema,
  taskListQuerySchema,
  updateTaskBodySchema,
} from '@businessos/types';
import type { Prisma } from '@businessos/db';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { errors } from '../../lib/errors.js';
import { toActivityDto, toTaskDto } from '../../lib/mappers-domain.js';
import { toPaginated, toSkipTake } from '../../lib/pagination.js';
import { orgContext, requirePermission } from '../../plugins/auth.js';
import { auditContext, recordAudit } from '../audit/service.js';
import { recordActivity } from '../activity/service.js';
import { enqueueOutbox } from '../outbox/service.js';

const taskInclude = {
  customer: { select: { id: true, name: true } },
  project: { select: { id: true, name: true } },
  assignee: { select: { id: true, name: true } },
} as const;

/** Validates that referenced customer/project/assignee all belong to the org. */
async function validateRefs(
  app: FastifyInstance,
  organizationId: string,
  refs: { customerId?: string | null; projectId?: string | null; assigneeId?: string | null },
): Promise<void> {
  if (refs.customerId) {
    const found = await app.prisma.customer.findFirst({
      where: { id: refs.customerId, organizationId },
      select: { id: true },
    });
    if (!found)
      throw errors.badRequest('invalid_customer', 'Customer not found in this organization');
  }
  if (refs.projectId) {
    const found = await app.prisma.project.findFirst({
      where: { id: refs.projectId, organizationId },
      select: { id: true },
    });
    if (!found)
      throw errors.badRequest('invalid_project', 'Project not found in this organization');
  }
  if (refs.assigneeId) {
    // Assignee must be a member of this organization.
    const member = await app.prisma.organizationMember.findFirst({
      where: { organizationId, userId: refs.assigneeId },
      select: { id: true },
    });
    if (!member)
      throw errors.badRequest('invalid_assignee', 'Assignee is not a member of this organization');
  }
}

function refFor(task: { customerId: string | null; projectId: string | null; id: string }) {
  return { customerId: task.customerId, projectId: task.projectId, taskId: task.id };
}

export function registerTaskRoutes(app: FastifyInstance): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.route({
    method: 'GET',
    url: '/v1/tasks',
    preHandler: [requirePermission('tasks.read')],
    schema: {
      tags: ['tasks'],
      querystring: taskListQuerySchema,
      response: { 200: paginatedSchema(taskDtoSchema) },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const query = request.query;
      const { skip, take } = toSkipTake(query);
      const where: Prisma.TaskWhereInput = {
        organizationId,
        ...(query.status ? { status: query.status } : {}),
        ...(query.priority ? { priority: query.priority } : {}),
        ...(query.projectId ? { projectId: query.projectId } : {}),
        ...(query.customerId ? { customerId: query.customerId } : {}),
        ...(query.mine
          ? { assigneeId: request.currentUser?.id }
          : query.assigneeId
            ? { assigneeId: query.assigneeId }
            : {}),
        ...(query.search ? { title: { contains: query.search, mode: 'insensitive' } } : {}),
      };
      const [rows, total] = await Promise.all([
        app.prisma.task.findMany({
          where,
          include: taskInclude,
          orderBy: [
            { status: 'asc' },
            { dueDate: { sort: 'asc', nulls: 'last' } },
            { createdAt: 'desc' },
          ],
          skip,
          take,
        }),
        app.prisma.task.count({ where }),
      ]);
      return reply.send(toPaginated(rows.map(toTaskDto), total, query));
    },
  });

  r.route({
    method: 'POST',
    url: '/v1/tasks',
    preHandler: [requirePermission('tasks.manage')],
    schema: { tags: ['tasks'], body: createTaskBodySchema, response: { 201: taskDtoSchema } },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const body = request.body;
      await validateRefs(app, organizationId, body);
      const isDone = body.status === 'DONE';

      const task = await app.prisma.$transaction(async (tx) => {
        const created = await tx.task.create({
          data: {
            organizationId,
            title: body.title,
            description: body.description ?? null,
            status: body.status,
            priority: body.priority,
            dueDate: body.dueDate ? new Date(body.dueDate) : null,
            customerId: body.customerId ?? null,
            projectId: body.projectId ?? null,
            assigneeId: body.assigneeId ?? null,
            completedAt: isDone ? new Date() : null,
            createdById: request.currentUser?.id ?? null,
          },
          include: taskInclude,
        });
        await recordAudit(tx, {
          action: 'task.created',
          organizationId,
          ...auditContext(request),
          entityType: 'task',
          entityId: created.id,
          metadata: { title: created.title },
        });
        await recordActivity(tx, {
          organizationId,
          actorUserId: request.currentUser?.id ?? null,
          type: 'task.created',
          ref: refFor(created),
          metadata: { title: created.title },
        });
        return created;
      });
      return reply.code(201).send(toTaskDto(task));
    },
  });

  r.route({
    method: 'GET',
    url: '/v1/tasks/:taskId',
    preHandler: [requirePermission('tasks.read')],
    schema: { tags: ['tasks'], params: taskIdParamsSchema, response: { 200: taskDtoSchema } },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const task = await app.prisma.task.findFirst({
        where: { id: request.params.taskId, organizationId },
        include: taskInclude,
      });
      if (!task) throw errors.notFound('Task');
      return reply.send(toTaskDto(task));
    },
  });

  r.route({
    method: 'PATCH',
    url: '/v1/tasks/:taskId',
    preHandler: [requirePermission('tasks.manage')],
    schema: {
      tags: ['tasks'],
      params: taskIdParamsSchema,
      body: updateTaskBodySchema,
      response: { 200: taskDtoSchema },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const existing = await app.prisma.task.findFirst({
        where: { id: request.params.taskId, organizationId },
      });
      if (!existing) throw errors.notFound('Task');
      const body = request.body;
      await validateRefs(app, organizationId, body);

      const becomingDone = body.status === 'DONE' && existing.status !== 'DONE';
      const leavingDone =
        body.status !== undefined && body.status !== 'DONE' && existing.status === 'DONE';
      const statusChanged = body.status !== undefined && body.status !== existing.status;
      const assigneeChanged =
        body.assigneeId !== undefined && body.assigneeId !== existing.assigneeId;

      const updated = await app.prisma.$transaction(async (tx) => {
        const result = await tx.task.update({
          where: { id: existing.id },
          data: {
            ...(body.title !== undefined ? { title: body.title } : {}),
            ...(body.description !== undefined ? { description: body.description } : {}),
            ...(body.status !== undefined ? { status: body.status } : {}),
            ...(body.priority !== undefined ? { priority: body.priority } : {}),
            ...(body.dueDate !== undefined
              ? { dueDate: body.dueDate ? new Date(body.dueDate) : null }
              : {}),
            ...(body.customerId !== undefined ? { customerId: body.customerId } : {}),
            ...(body.projectId !== undefined ? { projectId: body.projectId } : {}),
            ...(body.assigneeId !== undefined ? { assigneeId: body.assigneeId } : {}),
            ...(becomingDone ? { completedAt: new Date() } : {}),
            ...(leavingDone ? { completedAt: null } : {}),
          },
          include: taskInclude,
        });
        await recordAudit(tx, {
          action: becomingDone ? 'task.completed' : 'task.updated',
          organizationId,
          ...auditContext(request),
          entityType: 'task',
          entityId: existing.id,
          metadata: { fields: Object.keys(body) },
        });
        if (becomingDone) {
          await recordActivity(tx, {
            organizationId,
            actorUserId: request.currentUser?.id ?? null,
            type: 'task.completed',
            ref: refFor(result),
            metadata: { title: result.title },
          });
          await enqueueOutbox(tx, 'task.completed', {
            organizationId,
            taskId: result.id,
            title: result.title,
          });
        } else if (statusChanged) {
          await recordActivity(tx, {
            organizationId,
            actorUserId: request.currentUser?.id ?? null,
            type: 'task.status_changed',
            ref: refFor(result),
            metadata: { from: existing.status, to: body.status },
          });
        }
        if (assigneeChanged && result.assigneeId) {
          await recordActivity(tx, {
            organizationId,
            actorUserId: request.currentUser?.id ?? null,
            type: 'task.assigned',
            ref: refFor(result),
            metadata: { assigneeId: result.assigneeId },
          });
        }
        return result;
      });
      return reply.send(toTaskDto(updated));
    },
  });

  r.route({
    method: 'DELETE',
    url: '/v1/tasks/:taskId',
    preHandler: [requirePermission('tasks.manage')],
    schema: { tags: ['tasks'], params: taskIdParamsSchema },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const existing = await app.prisma.task.findFirst({
        where: { id: request.params.taskId, organizationId },
      });
      if (!existing) throw errors.notFound('Task');
      await app.prisma.$transaction(async (tx) => {
        await tx.task.delete({ where: { id: existing.id } });
        await recordAudit(tx, {
          action: 'task.deleted',
          organizationId,
          ...auditContext(request),
          entityType: 'task',
          entityId: existing.id,
          metadata: { title: existing.title },
        });
      });
      return reply.code(204).send();
    },
  });

  r.route({
    method: 'GET',
    url: '/v1/tasks/:taskId/activity',
    preHandler: [requirePermission('tasks.read')],
    schema: {
      tags: ['tasks'],
      params: taskIdParamsSchema,
      querystring: paginationQuerySchema,
      response: { 200: paginatedSchema(activityDtoSchema) },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const task = await app.prisma.task.findFirst({
        where: { id: request.params.taskId, organizationId },
        select: { id: true },
      });
      if (!task) throw errors.notFound('Task');
      const { skip, take } = toSkipTake(request.query);
      const where = { organizationId, taskId: task.id };
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
