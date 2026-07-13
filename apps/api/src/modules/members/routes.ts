import {
  memberDtoSchema,
  memberIdParamsSchema,
  paginatedSchema,
  paginationQuerySchema,
  updateMemberRoleBodySchema,
} from '@businessos/types';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { errors } from '../../lib/errors.js';
import { toMemberDto } from '../../lib/mappers.js';
import { toPaginated, toSkipTake } from '../../lib/pagination.js';
import { orgContext, requirePermission } from '../../plugins/auth.js';
import { auditContext, recordAudit } from '../audit/service.js';

export function registerMemberRoutes(app: FastifyInstance): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.route({
    method: 'GET',
    url: '/v1/organizations/current/members',
    preHandler: [requirePermission('members.read')],
    schema: {
      tags: ['members'],
      querystring: paginationQuerySchema,
      response: { 200: paginatedSchema(memberDtoSchema) },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const { skip, take } = toSkipTake(request.query);
      const [members, total] = await Promise.all([
        app.prisma.organizationMember.findMany({
          where: { organizationId },
          include: { user: true },
          orderBy: { createdAt: 'asc' },
          skip,
          take,
        }),
        app.prisma.organizationMember.count({ where: { organizationId } }),
      ]);
      return reply.send(toPaginated(members.map(toMemberDto), total, request.query));
    },
  });

  r.route({
    method: 'PATCH',
    url: '/v1/organizations/current/members/:memberId',
    preHandler: [requirePermission('members.update_role')],
    schema: {
      tags: ['members'],
      params: memberIdParamsSchema,
      body: updateMemberRoleBodySchema,
      response: { 200: memberDtoSchema },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      // Tenant scoping: the member must belong to the ACTIVE organization.
      const member = await app.prisma.organizationMember.findFirst({
        where: { id: request.params.memberId, organizationId },
        include: { user: true },
      });
      if (!member) throw errors.notFound('Member');
      if (member.userId === request.currentUser?.id) {
        throw errors.badRequest('cannot_change_own_role', 'You cannot change your own role');
      }
      if (member.role === 'OWNER') {
        throw errors.forbidden('Owner roles can only change through ownership transfer');
      }

      const updated = await app.prisma.$transaction(async (tx) => {
        const result = await tx.organizationMember.update({
          where: { id: member.id },
          data: { role: request.body.role },
          include: { user: true },
        });
        await recordAudit(tx, {
          action: 'member.role_changed',
          organizationId,
          ...auditContext(request),
          entityType: 'organization_member',
          entityId: member.id,
          metadata: { from: member.role, to: request.body.role, email: member.user.email },
        });
        return result;
      });
      return reply.send(toMemberDto(updated));
    },
  });

  r.route({
    method: 'DELETE',
    url: '/v1/organizations/current/members/:memberId',
    preHandler: [requirePermission('members.remove')],
    schema: { tags: ['members'], params: memberIdParamsSchema },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const member = await app.prisma.organizationMember.findFirst({
        where: { id: request.params.memberId, organizationId },
        include: { user: true },
      });
      if (!member) throw errors.notFound('Member');
      if (member.userId === request.currentUser?.id) {
        throw errors.badRequest('cannot_remove_self', 'You cannot remove yourself');
      }
      if (member.role === 'OWNER') {
        throw errors.forbidden('Owners cannot be removed');
      }

      await app.prisma.$transaction(async (tx) => {
        await tx.organizationMember.delete({ where: { id: member.id } });
        // Detach any of the removed user's sessions that point at this org.
        await tx.session.updateMany({
          where: { userId: member.userId, activeOrganizationId: organizationId },
          data: { activeOrganizationId: null },
        });
        await recordAudit(tx, {
          action: 'member.removed',
          organizationId,
          ...auditContext(request),
          entityType: 'organization_member',
          entityId: member.id,
          metadata: { email: member.user.email, role: member.role },
        });
      });
      return reply.code(204).send();
    },
  });
}
