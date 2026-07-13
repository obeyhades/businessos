import {
  createInvitationBodySchema,
  invitationDtoSchema,
  invitationIdParamsSchema,
  invitationPreviewDtoSchema,
  invitationTokenParamsSchema,
  sessionDtoSchema,
  type AssignableRole,
} from '@businessos/types';
import type { Invitation, Organization } from '@businessos/db';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { errors } from '../../lib/errors.js';
import { toInvitationDto } from '../../lib/mappers.js';
import { generateToken, hashToken } from '../../lib/tokens.js';
import { orgContext, requireAuth, requirePermission } from '../../plugins/auth.js';
import { auditContext, recordAudit } from '../audit/service.js';
import { enqueueEmail, enqueueOutbox } from '../outbox/service.js';
import { buildSessionDto } from '../auth/session.js';

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function isPending(invitation: Invitation): boolean {
  return (
    invitation.acceptedAt === null &&
    invitation.revokedAt === null &&
    invitation.expiresAt.getTime() > Date.now()
  );
}

function invitationEmailText(org: Organization, role: string, link: string): string {
  return [
    `You have been invited to join ${org.name} on BusinessOS as ${role.toLowerCase()}.`,
    '',
    'Accept the invitation here (valid for 7 days):',
    link,
    '',
    'If you were not expecting this invitation, you can ignore this email.',
    '',
    '---',
    `Du har blivit inbjuden till ${org.name} på BusinessOS.`,
    'Acceptera inbjudan via länken ovan (giltig i 7 dagar).',
  ].join('\n');
}

export function registerInvitationRoutes(app: FastifyInstance): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.route({
    method: 'POST',
    url: '/v1/organizations/current/invitations',
    preHandler: [requirePermission('members.invite')],
    schema: {
      tags: ['invitations'],
      body: createInvitationBodySchema,
      response: { 201: invitationDtoSchema },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const { email, role } = request.body;

      const existingMember = await app.prisma.organizationMember.findFirst({
        where: { organizationId, user: { email } },
      });
      if (existingMember) {
        throw errors.conflict('already_member', 'This person is already a member');
      }

      const pendingInvitation = await app.prisma.invitation.findFirst({
        where: {
          organizationId,
          email,
          acceptedAt: null,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
      });
      if (pendingInvitation) {
        throw errors.conflict(
          'invitation_pending',
          'An invitation for this email is already pending',
        );
      }

      const org = await app.prisma.organization.findUniqueOrThrow({
        where: { id: organizationId },
      });
      const token = generateToken();
      const link = `${app.config.APP_BASE_URL}/accept-invite?token=${token}`;

      const invitation = await app.prisma.$transaction(async (tx) => {
        const created = await tx.invitation.create({
          data: {
            organizationId,
            email,
            role,
            tokenHash: hashToken(token),
            expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
            invitedById: request.currentUser?.id ?? null,
          },
          include: { invitedBy: true },
        });
        await recordAudit(tx, {
          action: 'member.invited',
          organizationId,
          ...auditContext(request),
          entityType: 'invitation',
          entityId: created.id,
          metadata: { email, role },
        });
        await enqueueOutbox(tx, 'member.invited', {
          organizationId,
          invitationId: created.id,
          email,
          role,
        });
        await enqueueEmail(tx, {
          to: email,
          kind: 'invitation',
          organizationId,
          subject: `Invitation to ${org.name} on BusinessOS / Inbjudan till ${org.name}`,
          text: invitationEmailText(org, role, link),
        });
        return created;
      });

      return reply.code(201).send(toInvitationDto(invitation));
    },
  });

  r.route({
    method: 'GET',
    url: '/v1/organizations/current/invitations',
    preHandler: [requirePermission('members.invite')],
    schema: { tags: ['invitations'], response: { 200: z.array(invitationDtoSchema) } },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const invitations = await app.prisma.invitation.findMany({
        where: {
          organizationId,
          acceptedAt: null,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        include: { invitedBy: true },
        orderBy: { createdAt: 'desc' },
      });
      return reply.send(invitations.map(toInvitationDto));
    },
  });

  r.route({
    method: 'DELETE',
    url: '/v1/organizations/current/invitations/:invitationId',
    preHandler: [requirePermission('members.invite')],
    schema: { tags: ['invitations'], params: invitationIdParamsSchema },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const invitation = await app.prisma.invitation.findFirst({
        where: { id: request.params.invitationId, organizationId },
      });
      if (!invitation || !isPending(invitation)) throw errors.notFound('Invitation');

      await app.prisma.$transaction(async (tx) => {
        await tx.invitation.update({
          where: { id: invitation.id },
          data: { revokedAt: new Date() },
        });
        await recordAudit(tx, {
          action: 'member.invitation_revoked',
          organizationId,
          ...auditContext(request),
          entityType: 'invitation',
          entityId: invitation.id,
          metadata: { email: invitation.email },
        });
      });
      return reply.code(204).send();
    },
  });

  // Public: preview an invitation before login/registration.
  r.route({
    method: 'GET',
    url: '/v1/invitations/:token',
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    schema: {
      tags: ['invitations'],
      params: invitationTokenParamsSchema,
      response: { 200: invitationPreviewDtoSchema },
    },
    handler: async (request, reply) => {
      const invitation = await app.prisma.invitation.findUnique({
        where: { tokenHash: hashToken(request.params.token) },
        include: { organization: true },
      });
      if (!invitation || !isPending(invitation)) throw errors.notFound('Invitation');
      return reply.send({
        organizationName: invitation.organization.name,
        email: invitation.email,
        role: invitation.role as AssignableRole,
        expiresAt: invitation.expiresAt.toISOString(),
      });
    },
  });

  r.route({
    method: 'POST',
    url: '/v1/invitations/:token/accept',
    preHandler: [requireAuth],
    schema: {
      tags: ['invitations'],
      params: invitationTokenParamsSchema,
      response: { 200: sessionDtoSchema },
    },
    handler: async (request, reply) => {
      const user = request.currentUser;
      const session = request.currentSession;
      if (!user || !session) throw errors.unauthorized();

      const invitation = await app.prisma.invitation.findUnique({
        where: { tokenHash: hashToken(request.params.token) },
      });
      if (!invitation) throw errors.notFound('Invitation');
      // The rightful acceptor re-using an accepted token gets an honest 409;
      // everyone else still sees 404 so token state is never leaked.
      if (invitation.acceptedAt && invitation.email === user.email) {
        const alreadyMember = await app.prisma.organizationMember.findUnique({
          where: {
            organizationId_userId: { organizationId: invitation.organizationId, userId: user.id },
          },
        });
        if (alreadyMember) {
          throw errors.conflict('already_member', 'You are already a member of this organization');
        }
      }
      if (!isPending(invitation)) throw errors.notFound('Invitation');
      if (invitation.email !== user.email) {
        throw errors.forbidden('This invitation was sent to a different email address');
      }

      const existingMember = await app.prisma.organizationMember.findUnique({
        where: {
          organizationId_userId: { organizationId: invitation.organizationId, userId: user.id },
        },
      });
      if (existingMember) {
        throw errors.conflict('already_member', 'You are already a member of this organization');
      }

      await app.prisma.$transaction(async (tx) => {
        const member = await tx.organizationMember.create({
          data: {
            organizationId: invitation.organizationId,
            userId: user.id,
            role: invitation.role,
          },
        });
        await tx.invitation.update({
          where: { id: invitation.id },
          data: { acceptedAt: new Date() },
        });
        await recordAudit(tx, {
          action: 'member.invitation_accepted',
          organizationId: invitation.organizationId,
          ...auditContext(request),
          entityType: 'organization_member',
          entityId: member.id,
          metadata: { email: user.email, role: invitation.role },
        });
        await enqueueOutbox(tx, 'member.invitation_accepted', {
          organizationId: invitation.organizationId,
          userId: user.id,
          role: invitation.role,
        });
      });

      await app.prisma.session.update({
        where: { id: session.id },
        data: { activeOrganizationId: invitation.organizationId },
      });

      return reply.send(await buildSessionDto(app.prisma, user, invitation.organizationId));
    },
  });
}
