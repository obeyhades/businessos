import {
  createEmailAccountBodySchema,
  emailAccountDtoSchema,
  emailAccountIdParamsSchema,
  updateEmailAccountBodySchema,
} from '@businessos/types';
import { Prisma } from '@businessos/db';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { errors } from '../../lib/errors.js';
import { orgContext, requirePermission } from '../../plugins/auth.js';
import { auditContext, recordAudit } from '../audit/service.js';
import { toEmailAccountDto } from './mappers.js';
import { accountVisibilityWhere, canSeeAccount } from './service.js';

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

export function registerEmailAccountRoutes(app: FastifyInstance): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.route({
    method: 'GET',
    url: '/v1/email/accounts',
    preHandler: [requirePermission('email.read')],
    schema: { tags: ['email'], response: { 200: z.array(emailAccountDtoSchema) } },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const accounts = await app.prisma.emailAccount.findMany({
        where: { organizationId, ...accountVisibilityWhere(request.currentUser?.id) },
        orderBy: [{ type: 'asc' }, { address: 'asc' }],
      });
      return reply.send(accounts.map(toEmailAccountDto));
    },
  });

  r.route({
    method: 'POST',
    url: '/v1/email/accounts',
    preHandler: [requirePermission('email.send')],
    schema: {
      tags: ['email'],
      body: createEmailAccountBodySchema,
      response: { 201: emailAccountDtoSchema },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const body = request.body;
      try {
        const account = await app.prisma.$transaction(async (tx) => {
          const created = await tx.emailAccount.create({
            data: {
              organizationId,
              // Store lowercased so the global-unique index + routing are stable.
              address: body.address.toLowerCase(),
              displayName: body.displayName ?? null,
              type: body.type,
              ownerId: body.type === 'PERSONAL' ? (request.currentUser?.id ?? null) : null,
              createdById: request.currentUser?.id ?? null,
            },
          });
          await recordAudit(tx, {
            action: 'email_account.created',
            organizationId,
            ...auditContext(request),
            entityType: 'email_account',
            entityId: created.id,
            metadata: { address: created.address, type: created.type },
          });
          return created;
        });
        return reply.code(201).send(toEmailAccountDto(account));
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw errors.conflict('duplicate_address', `Mailbox ${body.address} already exists`);
        }
        throw err;
      }
    },
  });

  r.route({
    method: 'PATCH',
    url: '/v1/email/accounts/:accountId',
    preHandler: [requirePermission('email.send')],
    schema: {
      tags: ['email'],
      params: emailAccountIdParamsSchema,
      body: updateEmailAccountBodySchema,
      response: { 200: emailAccountDtoSchema },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const existing = await app.prisma.emailAccount.findFirst({
        where: { id: request.params.accountId, organizationId },
      });
      if (!existing || !canSeeAccount(existing, request.currentUser?.id)) {
        throw errors.notFound('Mailbox');
      }
      const body = request.body;
      const updated = await app.prisma.$transaction(async (tx) => {
        const result = await tx.emailAccount.update({
          where: { id: existing.id },
          data: {
            ...(body.displayName !== undefined ? { displayName: body.displayName } : {}),
            ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
          },
        });
        await recordAudit(tx, {
          action: 'email_account.updated',
          organizationId,
          ...auditContext(request),
          entityType: 'email_account',
          entityId: existing.id,
          metadata: { fields: Object.keys(body) },
        });
        return result;
      });
      return reply.send(toEmailAccountDto(updated));
    },
  });

  r.route({
    method: 'DELETE',
    url: '/v1/email/accounts/:accountId',
    preHandler: [requirePermission('email.send')],
    schema: { tags: ['email'], params: emailAccountIdParamsSchema },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const existing = await app.prisma.emailAccount.findFirst({
        where: { id: request.params.accountId, organizationId },
      });
      if (!existing || !canSeeAccount(existing, request.currentUser?.id)) {
        throw errors.notFound('Mailbox');
      }
      const threadCount = await app.prisma.emailThread.count({
        where: { accountId: existing.id, organizationId },
      });
      if (threadCount > 0) {
        throw errors.conflict(
          'account_in_use',
          'This mailbox has conversations and cannot be deleted',
        );
      }
      await app.prisma.$transaction(async (tx) => {
        await tx.emailAccount.delete({ where: { id: existing.id } });
        await recordAudit(tx, {
          action: 'email_account.deleted',
          organizationId,
          ...auditContext(request),
          entityType: 'email_account',
          entityId: existing.id,
          metadata: { address: existing.address },
        });
      });
      return reply.code(204).send();
    },
  });
}
