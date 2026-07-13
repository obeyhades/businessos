import {
  commentDtoSchema,
  createCommentBodySchema,
  hasPermission,
  uuidSchema,
  type EntityKind,
  type OrganizationRole,
  type Permission,
} from '@businessos/types';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { errors } from '../../lib/errors.js';
import { toCommentDto } from '../../lib/mappers-domain.js';
import { orgContext, requirePermission } from '../../plugins/auth.js';
import { auditContext, recordAudit } from '../audit/service.js';
import { recordActivity, resolveEntityRef } from '../activity/service.js';

interface KindConfig {
  kind: EntityKind;
  path: 'customers' | 'projects' | 'tasks';
  read: 'customers.read' | 'projects.read' | 'tasks.read';
  manage: 'customers.manage' | 'projects.manage' | 'tasks.manage';
  fk: 'customerId' | 'projectId' | 'taskId';
}

const KINDS: KindConfig[] = [
  {
    kind: 'customer',
    path: 'customers',
    read: 'customers.read',
    manage: 'customers.manage',
    fk: 'customerId',
  },
  {
    kind: 'project',
    path: 'projects',
    read: 'projects.read',
    manage: 'projects.manage',
    fk: 'projectId',
  },
  { kind: 'task', path: 'tasks', read: 'tasks.read', manage: 'tasks.manage', fk: 'taskId' },
];

const parentParams = z.object({ entityId: uuidSchema });
const commentParams = z.object({ entityId: uuidSchema, commentId: uuidSchema });

export function registerCommentRoutes(app: FastifyInstance): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  for (const cfg of KINDS) {
    r.route({
      method: 'GET',
      url: `/v1/${cfg.path}/:entityId/comments`,
      preHandler: [requirePermission(cfg.read)],
      schema: {
        tags: ['comments'],
        params: parentParams,
        response: { 200: z.array(commentDtoSchema) },
      },
      handler: async (request, reply) => {
        const { organizationId } = orgContext(request);
        await resolveEntityRef(app.prisma, organizationId, cfg.kind, request.params.entityId);
        const comments = await app.prisma.comment.findMany({
          where: { organizationId, [cfg.fk]: request.params.entityId },
          include: { author: true },
          orderBy: { createdAt: 'asc' },
        });
        return reply.send(comments.map(toCommentDto));
      },
    });

    r.route({
      method: 'POST',
      url: `/v1/${cfg.path}/:entityId/comments`,
      preHandler: [requirePermission(cfg.manage)],
      schema: {
        tags: ['comments'],
        params: parentParams,
        body: createCommentBodySchema,
        response: { 201: commentDtoSchema },
      },
      handler: async (request, reply) => {
        const { organizationId } = orgContext(request);
        const ref = await resolveEntityRef(
          app.prisma,
          organizationId,
          cfg.kind,
          request.params.entityId,
        );

        const comment = await app.prisma.$transaction(async (tx) => {
          const created = await tx.comment.create({
            data: {
              organizationId,
              authorId: request.currentUser?.id ?? null,
              body: request.body.body,
              [cfg.fk]: request.params.entityId,
            },
            include: { author: true },
          });
          await recordAudit(tx, {
            action: 'comment.created',
            organizationId,
            ...auditContext(request),
            entityType: `${cfg.kind}_comment`,
            entityId: created.id,
          });
          await recordActivity(tx, {
            organizationId,
            actorUserId: request.currentUser?.id ?? null,
            type: 'comment.added',
            ref,
          });
          return created;
        });
        return reply.code(201).send(toCommentDto(comment));
      },
    });

    r.route({
      method: 'DELETE',
      url: `/v1/${cfg.path}/:entityId/comments/:commentId`,
      // Anyone who can read the parent may reach here; authorship / manage is
      // checked in the handler so authors can delete their own comment.
      preHandler: [requirePermission(cfg.read)],
      schema: { tags: ['comments'], params: commentParams },
      handler: async (request, reply) => {
        const { organizationId, role } = orgContext(request);
        const comment = await app.prisma.comment.findFirst({
          where: {
            id: request.params.commentId,
            organizationId,
            [cfg.fk]: request.params.entityId,
          },
        });
        if (!comment) throw errors.notFound('Comment');
        const isAuthor = comment.authorId === request.currentUser?.id;
        if (!isAuthor && !hasManage(role, cfg.manage)) throw errors.forbidden();

        await app.prisma.$transaction(async (tx) => {
          await tx.comment.delete({ where: { id: comment.id } });
          await recordAudit(tx, {
            action: 'comment.deleted',
            organizationId,
            ...auditContext(request),
            entityType: `${cfg.kind}_comment`,
            entityId: comment.id,
          });
        });
        return reply.code(204).send();
      },
    });
  }
}

function hasManage(role: string, permission: Permission): boolean {
  return hasPermission(role as OrganizationRole, permission);
}
