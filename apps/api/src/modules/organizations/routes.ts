import {
  createOrganizationBodySchema,
  membershipDtoSchema,
  organizationDtoSchema,
  sessionDtoSchema,
  switchOrganizationBodySchema,
  updateOrganizationBodySchema,
} from '@businessos/types';
import { Prisma } from '@businessos/db';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { errors } from '../../lib/errors.js';
import { toMembershipDto, toOrganizationDto } from '../../lib/mappers.js';
import { slugify, slugWithSuffix } from '../../lib/slug.js';
import { orgContext, requireAuth, requirePermission } from '../../plugins/auth.js';
import { auditContext, recordAudit } from '../audit/service.js';
import { enqueueOutbox } from '../outbox/service.js';
import { buildSessionDto } from '../auth/session.js';

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

export function registerOrganizationRoutes(app: FastifyInstance): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.route({
    method: 'POST',
    url: '/v1/organizations',
    preHandler: [requireAuth],
    schema: {
      tags: ['organizations'],
      body: createOrganizationBodySchema,
      response: { 201: organizationDtoSchema },
    },
    handler: async (request, reply) => {
      const user = request.currentUser;
      const session = request.currentSession;
      if (!user || !session) throw errors.unauthorized();

      const createOrg = async (slug: string) =>
        app.prisma.$transaction(async (tx) => {
          const org = await tx.organization.create({
            data: {
              name: request.body.name,
              slug,
              locale: request.body.locale,
              currency: request.body.currency,
              createdById: user.id,
            },
          });
          await tx.organizationMember.create({
            data: { organizationId: org.id, userId: user.id, role: 'OWNER' },
          });
          await recordAudit(tx, {
            action: 'organization.created',
            organizationId: org.id,
            ...auditContext(request),
            entityType: 'organization',
            entityId: org.id,
            metadata: { name: org.name },
          });
          await enqueueOutbox(tx, 'organization.created', {
            organizationId: org.id,
            name: org.name,
          });
          return org;
        });

      let org;
      try {
        org = await createOrg(slugify(request.body.name));
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        org = await createOrg(slugWithSuffix(request.body.name));
      }

      await app.prisma.session.update({
        where: { id: session.id },
        data: { activeOrganizationId: org.id },
      });

      return reply.code(201).send(toOrganizationDto(org));
    },
  });

  r.route({
    method: 'GET',
    url: '/v1/organizations',
    preHandler: [requireAuth],
    schema: { tags: ['organizations'], response: { 200: z.array(membershipDtoSchema) } },
    handler: async (request, reply) => {
      const user = request.currentUser;
      if (!user) throw errors.unauthorized();
      const memberships = await app.prisma.organizationMember.findMany({
        where: { userId: user.id },
        include: { organization: true },
        orderBy: { createdAt: 'asc' },
      });
      return reply.send(memberships.map(toMembershipDto));
    },
  });

  r.route({
    method: 'GET',
    url: '/v1/organizations/current',
    preHandler: [requirePermission('org.read')],
    schema: { tags: ['organizations'], response: { 200: organizationDtoSchema } },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const org = await app.prisma.organization.findUnique({ where: { id: organizationId } });
      if (!org) throw errors.notFound('Organization');
      return reply.send(toOrganizationDto(org));
    },
  });

  r.route({
    method: 'PATCH',
    url: '/v1/organizations/current',
    preHandler: [requirePermission('org.update')],
    schema: {
      tags: ['organizations'],
      body: updateOrganizationBodySchema,
      response: { 200: organizationDtoSchema },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const updated = await app.prisma.$transaction(async (tx) => {
        const org = await tx.organization.update({
          where: { id: organizationId },
          data: {
            ...(request.body.name !== undefined ? { name: request.body.name } : {}),
            ...(request.body.locale !== undefined ? { locale: request.body.locale } : {}),
            ...(request.body.currency !== undefined ? { currency: request.body.currency } : {}),
          },
        });
        await recordAudit(tx, {
          action: 'organization.updated',
          organizationId,
          ...auditContext(request),
          entityType: 'organization',
          entityId: organizationId,
          metadata: { fields: Object.keys(request.body) },
        });
        return org;
      });
      return reply.send(toOrganizationDto(updated));
    },
  });

  r.route({
    method: 'POST',
    url: '/v1/organizations/switch',
    preHandler: [requireAuth],
    schema: {
      tags: ['organizations'],
      body: switchOrganizationBodySchema,
      response: { 200: sessionDtoSchema },
    },
    handler: async (request, reply) => {
      const user = request.currentUser;
      const session = request.currentSession;
      if (!user || !session) throw errors.unauthorized();

      // The critical tenant check: the authenticated user must actually be a
      // member of the requested organization. Client-supplied IDs are never
      // trusted beyond this validated lookup.
      const membership = await app.prisma.organizationMember.findUnique({
        where: {
          organizationId_userId: {
            organizationId: request.body.organizationId,
            userId: user.id,
          },
        },
      });
      if (!membership) throw errors.forbidden('You are not a member of this organization');

      await app.prisma.session.update({
        where: { id: session.id },
        data: { activeOrganizationId: membership.organizationId },
      });
      await recordAudit(app.prisma, {
        action: 'organization.switched',
        organizationId: membership.organizationId,
        ...auditContext(request),
        entityType: 'organization',
        entityId: membership.organizationId,
      });

      return reply.send(await buildSessionDto(app.prisma, user, membership.organizationId));
    },
  });
}
