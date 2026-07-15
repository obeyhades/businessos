import {
  addLabelBodySchema,
  emailThreadDetailDtoSchema,
  emailThreadDtoSchema,
  emailToTaskBodySchema,
  linkThreadBodySchema,
  moveThreadBodySchema,
  paginatedSchema,
  readThreadBodySchema,
  starThreadBodySchema,
  threadIdParamsSchema,
  threadLabelParamsSchema,
  threadListQuerySchema,
  taskDtoSchema,
} from '@businessos/types';
import { type Prisma as PrismaTypes } from '@businessos/db';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { errors } from '../../lib/errors.js';
import { toPaginated, toSkipTake } from '../../lib/pagination.js';
import { orgContext, requirePermission } from '../../plugins/auth.js';
import { auditContext, recordAudit } from '../audit/service.js';
import { recordActivity } from '../activity/service.js';
import { toTaskDto } from '../../lib/mappers-domain.js';
import {
  threadDetailInclude,
  threadInclude,
  toEmailThreadDetailDto,
  toEmailThreadDto,
} from './mappers.js';
import {
  canSeeAccount,
  folderViewWhere,
  makeSnippet,
  threadAccountVisibilityWhere,
} from './service.js';

async function loadThreadForUser(
  app: FastifyInstance,
  organizationId: string,
  threadId: string,
  userId: string | undefined,
) {
  const thread = await app.prisma.emailThread.findFirst({
    where: { id: threadId, organizationId },
    include: { ...threadDetailInclude, account: true },
  });
  if (!thread) throw errors.notFound('Thread');
  if (!canSeeAccount(thread.account, userId)) throw errors.notFound('Thread');
  return thread;
}

export function registerEmailThreadRoutes(app: FastifyInstance): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // --- List (folder views, filters, search) ----------------------------------
  r.route({
    method: 'GET',
    url: '/v1/email/threads',
    preHandler: [requirePermission('email.read')],
    schema: {
      tags: ['email'],
      querystring: threadListQuerySchema,
      response: { 200: paginatedSchema(emailThreadDtoSchema) },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const userId = request.currentUser?.id;
      const q = request.query;
      const { skip, take } = toSkipTake(q);

      const and: PrismaTypes.EmailThreadWhereInput[] = [
        threadAccountVisibilityWhere(userId),
        folderViewWhere(q.folder ?? 'INBOX'),
      ];
      if (q.accountId) and.push({ accountId: q.accountId });
      if (q.labelId) and.push({ labels: { some: { labelId: q.labelId } } });
      if (q.customerId) and.push({ customerId: q.customerId });
      if (q.unread) and.push({ unread: q.unread === 'true' });
      if (q.starred) and.push({ isStarred: q.starred === 'true' });
      if (q.search) {
        and.push({
          OR: [
            { subject: { contains: q.search, mode: 'insensitive' } },
            { snippet: { contains: q.search, mode: 'insensitive' } },
            {
              messages: {
                some: {
                  OR: [
                    { bodyText: { contains: q.search, mode: 'insensitive' } },
                    { fromAddress: { contains: q.search, mode: 'insensitive' } },
                  ],
                },
              },
            },
          ],
        });
      }
      const where: PrismaTypes.EmailThreadWhereInput = { organizationId, AND: and };
      const [rows, total] = await Promise.all([
        app.prisma.emailThread.findMany({
          where,
          include: threadInclude,
          orderBy: { lastMessageAt: 'desc' },
          skip,
          take,
        }),
        app.prisma.emailThread.count({ where }),
      ]);
      return reply.send(toPaginated(rows.map(toEmailThreadDto), total, q));
    },
  });

  // --- Detail -----------------------------------------------------------------
  r.route({
    method: 'GET',
    url: '/v1/email/threads/:threadId',
    preHandler: [requirePermission('email.read')],
    schema: {
      tags: ['email'],
      params: threadIdParamsSchema,
      response: { 200: emailThreadDetailDtoSchema },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const thread = await loadThreadForUser(
        app,
        organizationId,
        request.params.threadId,
        request.currentUser?.id,
      );
      return reply.send(toEmailThreadDetailDto(thread));
    },
  });

  // --- Mark read / unread -----------------------------------------------------
  r.route({
    method: 'POST',
    url: '/v1/email/threads/:threadId/read',
    preHandler: [requirePermission('email.send')],
    schema: {
      tags: ['email'],
      params: threadIdParamsSchema,
      body: readThreadBodySchema,
      response: { 200: emailThreadDetailDtoSchema },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const existing = await loadThreadForUser(
        app,
        organizationId,
        request.params.threadId,
        request.currentUser?.id,
      );
      const read = request.body.read;
      await app.prisma.$transaction(async (tx) => {
        await tx.emailMessage.updateMany({
          where: { threadId: existing.id, direction: 'INBOUND' },
          data: { isRead: read },
        });
        await tx.emailThread.update({ where: { id: existing.id }, data: { unread: !read } });
      });
      const fresh = await loadThreadForUser(
        app,
        organizationId,
        existing.id,
        request.currentUser?.id,
      );
      return reply.send(toEmailThreadDetailDto(fresh));
    },
  });

  // --- Star / unstar ----------------------------------------------------------
  r.route({
    method: 'POST',
    url: '/v1/email/threads/:threadId/star',
    preHandler: [requirePermission('email.send')],
    schema: {
      tags: ['email'],
      params: threadIdParamsSchema,
      body: starThreadBodySchema,
      response: { 200: emailThreadDtoSchema },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const existing = await loadThreadForUser(
        app,
        organizationId,
        request.params.threadId,
        request.currentUser?.id,
      );
      const updated = await app.prisma.emailThread.update({
        where: { id: existing.id },
        data: { isStarred: request.body.starred },
        include: threadInclude,
      });
      return reply.send(toEmailThreadDto(updated));
    },
  });

  // --- Move (INBOX / ARCHIVE / TRASH) -----------------------------------------
  r.route({
    method: 'POST',
    url: '/v1/email/threads/:threadId/move',
    preHandler: [requirePermission('email.send')],
    schema: {
      tags: ['email'],
      params: threadIdParamsSchema,
      body: moveThreadBodySchema,
      response: { 200: emailThreadDtoSchema },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const existing = await loadThreadForUser(
        app,
        organizationId,
        request.params.threadId,
        request.currentUser?.id,
      );
      const updated = await app.prisma.$transaction(async (tx) => {
        const result = await tx.emailThread.update({
          where: { id: existing.id },
          data: { folder: request.body.folder },
          include: threadInclude,
        });
        await recordAudit(tx, {
          action: 'email_thread.moved',
          organizationId,
          ...auditContext(request),
          entityType: 'email_thread',
          entityId: existing.id,
          metadata: { folder: request.body.folder },
        });
        return result;
      });
      return reply.send(toEmailThreadDto(updated));
    },
  });

  // --- Link to a customer / project / task ------------------------------------
  r.route({
    method: 'PATCH',
    url: '/v1/email/threads/:threadId/link',
    preHandler: [requirePermission('email.send')],
    schema: {
      tags: ['email'],
      params: threadIdParamsSchema,
      body: linkThreadBodySchema,
      response: { 200: emailThreadDtoSchema },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const body = request.body;
      const existing = await loadThreadForUser(
        app,
        organizationId,
        request.params.threadId,
        request.currentUser?.id,
      );
      // Validate any provided links belong to the org.
      const checks: Array<Promise<void>> = [];
      if (body.customerId) {
        checks.push(
          app.prisma.customer
            .findFirst({ where: { id: body.customerId, organizationId }, select: { id: true } })
            .then((c) => {
              if (!c) throw errors.badRequest('unknown_customer', 'Customer not found');
            }),
        );
      }
      if (body.projectId) {
        checks.push(
          app.prisma.project
            .findFirst({ where: { id: body.projectId, organizationId }, select: { id: true } })
            .then((p) => {
              if (!p) throw errors.badRequest('unknown_project', 'Project not found');
            }),
        );
      }
      if (body.taskId) {
        checks.push(
          app.prisma.task
            .findFirst({ where: { id: body.taskId, organizationId }, select: { id: true } })
            .then((t) => {
              if (!t) throw errors.badRequest('unknown_task', 'Task not found');
            }),
        );
      }
      await Promise.all(checks);

      const updated = await app.prisma.$transaction(async (tx) => {
        const result = await tx.emailThread.update({
          where: { id: existing.id },
          data: {
            ...(body.customerId !== undefined ? { customerId: body.customerId } : {}),
            ...(body.projectId !== undefined ? { projectId: body.projectId } : {}),
            // A human touching the customer link pins it — auto-link (inbound)
            // must never resurrect a link the user deliberately cleared.
            ...(body.customerId !== undefined ? { customerLinkLocked: true } : {}),
            ...(body.taskId !== undefined ? { taskId: body.taskId } : {}),
          },
          include: threadInclude,
        });
        await recordAudit(tx, {
          action: 'email_thread.linked',
          organizationId,
          ...auditContext(request),
          entityType: 'email_thread',
          entityId: existing.id,
          metadata: { fields: Object.keys(body) },
        });
        return result;
      });
      return reply.send(toEmailThreadDto(updated));
    },
  });

  // --- Labels -----------------------------------------------------------------
  r.route({
    method: 'POST',
    url: '/v1/email/threads/:threadId/labels',
    preHandler: [requirePermission('email.send')],
    schema: {
      tags: ['email'],
      params: threadIdParamsSchema,
      body: addLabelBodySchema,
      response: { 200: emailThreadDtoSchema },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const existing = await loadThreadForUser(
        app,
        organizationId,
        request.params.threadId,
        request.currentUser?.id,
      );
      const label = await app.prisma.emailLabel.findFirst({
        where: { id: request.body.labelId, organizationId },
        select: { id: true },
      });
      if (!label) throw errors.badRequest('unknown_label', 'Label not found in this organization');
      const updated = await app.prisma.$transaction(async (tx) => {
        await tx.emailThreadLabel.upsert({
          where: { threadId_labelId: { threadId: existing.id, labelId: label.id } },
          create: { organizationId, threadId: existing.id, labelId: label.id },
          update: {},
        });
        await recordAudit(tx, {
          action: 'email_thread.labeled',
          organizationId,
          ...auditContext(request),
          entityType: 'email_thread',
          entityId: existing.id,
          metadata: { labelId: label.id },
        });
        return tx.emailThread.findUniqueOrThrow({
          where: { id: existing.id },
          include: threadInclude,
        });
      });
      return reply.send(toEmailThreadDto(updated));
    },
  });

  r.route({
    method: 'DELETE',
    url: '/v1/email/threads/:threadId/labels/:labelId',
    preHandler: [requirePermission('email.send')],
    schema: {
      tags: ['email'],
      params: threadLabelParamsSchema,
      response: { 200: emailThreadDtoSchema },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const existing = await loadThreadForUser(
        app,
        organizationId,
        request.params.threadId,
        request.currentUser?.id,
      );
      await app.prisma.emailThreadLabel.deleteMany({
        where: { threadId: existing.id, labelId: request.params.labelId },
      });
      const updated = await app.prisma.emailThread.findUniqueOrThrow({
        where: { id: existing.id },
        include: threadInclude,
      });
      return reply.send(toEmailThreadDto(updated));
    },
  });

  // --- Convert to a task ------------------------------------------------------
  r.route({
    method: 'POST',
    url: '/v1/email/threads/:threadId/task',
    preHandler: [requirePermission('email.send')],
    schema: {
      tags: ['email'],
      params: threadIdParamsSchema,
      body: emailToTaskBodySchema,
      response: { 201: taskDtoSchema },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const body = request.body;
      const thread = await loadThreadForUser(
        app,
        organizationId,
        request.params.threadId,
        request.currentUser?.id,
      );
      if (body.assigneeId) {
        const member = await app.prisma.organizationMember.findFirst({
          where: { organizationId, userId: body.assigneeId },
          select: { id: true },
        });
        if (!member)
          throw errors.badRequest(
            'unknown_assignee',
            'Assignee is not a member of this organization',
          );
      }
      const lastMessage = thread.messages[thread.messages.length - 1];
      const task = await app.prisma.$transaction(async (tx) => {
        const created = await tx.task.create({
          data: {
            organizationId,
            title: body.title ?? thread.subject.slice(0, 300),
            description: lastMessage ? makeSnippet(lastMessage.bodyText).slice(0, 2000) : null,
            customerId: thread.customerId,
            projectId: thread.projectId,
            assigneeId: body.assigneeId ?? null,
            dueDate: body.dueDate ? new Date(body.dueDate) : null,
            createdById: request.currentUser?.id ?? null,
          },
          include: {
            customer: { select: { id: true, name: true } },
            project: { select: { id: true, name: true } },
            employee: { select: { id: true, firstName: true, lastName: true } },
            assignee: { select: { id: true, name: true } },
          },
        });
        await tx.emailThread.update({ where: { id: thread.id }, data: { taskId: created.id } });
        await recordAudit(tx, {
          action: 'email.converted_to_task',
          organizationId,
          ...auditContext(request),
          entityType: 'task',
          entityId: created.id,
          metadata: { threadId: thread.id },
        });
        if (created.customerId || created.projectId) {
          await recordActivity(tx, {
            organizationId,
            actorUserId: request.currentUser?.id ?? null,
            type: 'task.created',
            ref: {
              customerId: created.customerId,
              projectId: created.projectId,
              taskId: created.id,
              employeeId: null,
            },
            metadata: { title: created.title, fromEmail: true },
          });
        }
        return created;
      });
      return reply.code(201).send(toTaskDto(task));
    },
  });
}
