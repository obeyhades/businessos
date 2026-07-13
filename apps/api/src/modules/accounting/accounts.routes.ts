import {
  accountDtoSchema,
  accountIdParamsSchema,
  accountListQuerySchema,
  accountMappingDtoSchema,
  createAccountBodySchema,
  paginatedSchema,
  updateAccountBodySchema,
  updateAccountMappingBodySchema,
} from '@businessos/types';
import { Prisma, type Prisma as PrismaTypes } from '@businessos/db';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { errors } from '../../lib/errors.js';
import { toPaginated, toSkipTake } from '../../lib/pagination.js';
import { orgContext, requirePermission } from '../../plugins/auth.js';
import { auditContext, recordAudit } from '../audit/service.js';
import { toAccountDto, toAccountMappingDto } from './mappers.js';

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

/** Ensures every provided account id exists and belongs to the org. */
async function assertAccountsInOrg(
  prisma: FastifyInstance['prisma'],
  organizationId: string,
  ids: (string | null | undefined)[],
): Promise<void> {
  const present = [...new Set(ids.filter((v): v is string => typeof v === 'string'))];
  if (present.length === 0) return;
  const count = await prisma.account.count({
    where: { id: { in: present }, organizationId },
  });
  if (count !== present.length) {
    throw errors.badRequest(
      'unknown_account',
      'One or more accounts do not exist in this organization',
    );
  }
}

export function registerAccountRoutes(app: FastifyInstance): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.route({
    method: 'GET',
    url: '/v1/accounting/accounts',
    preHandler: [requirePermission('accounting.read')],
    schema: {
      tags: ['accounting'],
      querystring: accountListQuerySchema,
      response: { 200: paginatedSchema(accountDtoSchema) },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const { skip, take } = toSkipTake(request.query);
      const where: PrismaTypes.AccountWhereInput = {
        organizationId,
        ...(request.query.type ? { type: request.query.type } : {}),
        ...(request.query.active ? { isActive: request.query.active === 'true' } : {}),
        ...(request.query.search
          ? {
              OR: [
                { code: { contains: request.query.search, mode: 'insensitive' } },
                { name: { contains: request.query.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      };
      const [rows, total] = await Promise.all([
        app.prisma.account.findMany({ where, orderBy: { code: 'asc' }, skip, take }),
        app.prisma.account.count({ where }),
      ]);
      return reply.send(toPaginated(rows.map(toAccountDto), total, request.query));
    },
  });

  r.route({
    method: 'POST',
    url: '/v1/accounting/accounts',
    preHandler: [requirePermission('accounting.manage')],
    schema: {
      tags: ['accounting'],
      body: createAccountBodySchema,
      response: { 201: accountDtoSchema },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const body = request.body;
      try {
        const account = await app.prisma.$transaction(async (tx) => {
          const created = await tx.account.create({
            data: {
              organizationId,
              code: body.code,
              name: body.name,
              type: body.type,
              description: body.description ?? null,
              isActive: body.isActive,
              createdById: request.currentUser?.id ?? null,
            },
          });
          await recordAudit(tx, {
            action: 'account.created',
            organizationId,
            ...auditContext(request),
            entityType: 'account',
            entityId: created.id,
            metadata: { code: created.code, type: created.type },
          });
          return created;
        });
        return reply.code(201).send(toAccountDto(account));
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw errors.conflict('duplicate_code', `Account code ${body.code} already exists`);
        }
        throw err;
      }
    },
  });

  r.route({
    method: 'GET',
    url: '/v1/accounting/accounts/:accountId',
    preHandler: [requirePermission('accounting.read')],
    schema: {
      tags: ['accounting'],
      params: accountIdParamsSchema,
      response: { 200: accountDtoSchema },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const account = await app.prisma.account.findFirst({
        where: { id: request.params.accountId, organizationId },
      });
      if (!account) throw errors.notFound('Account');
      return reply.send(toAccountDto(account));
    },
  });

  r.route({
    method: 'PATCH',
    url: '/v1/accounting/accounts/:accountId',
    preHandler: [requirePermission('accounting.manage')],
    schema: {
      tags: ['accounting'],
      params: accountIdParamsSchema,
      body: updateAccountBodySchema,
      response: { 200: accountDtoSchema },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const existing = await app.prisma.account.findFirst({
        where: { id: request.params.accountId, organizationId },
      });
      if (!existing) throw errors.notFound('Account');
      const body = request.body;
      const updated = await app.prisma.$transaction(async (tx) => {
        // An account's type is fixed once it carries journal entries — changing
        // it would retroactively reclassify already-posted (immutable) lines and
        // shift the trial balance.
        if (body.type !== undefined && body.type !== existing.type) {
          const lineCount = await tx.voucherLine.count({
            where: { accountId: existing.id, organizationId },
          });
          if (lineCount > 0) {
            throw errors.conflict(
              'account_in_use',
              'Cannot change the type of an account that has journal entries',
            );
          }
        }
        const result = await tx.account.update({
          where: { id: existing.id },
          data: {
            ...(body.name !== undefined ? { name: body.name } : {}),
            ...(body.type !== undefined ? { type: body.type } : {}),
            ...(body.description !== undefined ? { description: body.description } : {}),
            ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
          },
        });
        await recordAudit(tx, {
          action: body.isActive === false ? 'account.deactivated' : 'account.updated',
          organizationId,
          ...auditContext(request),
          entityType: 'account',
          entityId: existing.id,
          metadata: { fields: Object.keys(body) },
        });
        return result;
      });
      return reply.send(toAccountDto(updated));
    },
  });

  r.route({
    method: 'DELETE',
    url: '/v1/accounting/accounts/:accountId',
    preHandler: [requirePermission('accounting.manage')],
    schema: { tags: ['accounting'], params: accountIdParamsSchema },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const existing = await app.prisma.account.findFirst({
        where: { id: request.params.accountId, organizationId },
      });
      if (!existing) throw errors.notFound('Account');
      // An account referenced by any voucher line must be preserved for the
      // audit trail — deactivate it instead of deleting.
      const lineCount = await app.prisma.voucherLine.count({
        where: { accountId: existing.id, organizationId },
      });
      if (lineCount > 0) {
        throw errors.conflict(
          'account_in_use',
          'Account has journal entries; deactivate it instead',
        );
      }
      await app.prisma.$transaction(async (tx) => {
        await tx.account.delete({ where: { id: existing.id } });
        await recordAudit(tx, {
          action: 'account.updated',
          organizationId,
          ...auditContext(request),
          entityType: 'account',
          entityId: existing.id,
          metadata: { deleted: true, code: existing.code },
        });
      });
      return reply.code(204).send();
    },
  });

  // --- Account mapping (configurable rules for auto-generated drafts) ---------

  r.route({
    method: 'GET',
    url: '/v1/accounting/mapping',
    preHandler: [requirePermission('accounting.read')],
    schema: { tags: ['accounting'], response: { 200: accountMappingDtoSchema } },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const mapping = await app.prisma.accountMapping.findUnique({ where: { organizationId } });
      return reply.send(toAccountMappingDto(mapping));
    },
  });

  r.route({
    method: 'PUT',
    url: '/v1/accounting/mapping',
    preHandler: [requirePermission('accounting.manage')],
    schema: {
      tags: ['accounting'],
      body: updateAccountMappingBodySchema,
      response: { 200: accountMappingDtoSchema },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const body = request.body;
      await assertAccountsInOrg(app.prisma, organizationId, [
        body.salesAccountId,
        body.outputVatAccountId,
        body.receivableAccountId,
        body.bankAccountId,
      ]);
      const mapping = await app.prisma.$transaction(async (tx) => {
        const result = await tx.accountMapping.upsert({
          where: { organizationId },
          create: {
            organizationId,
            salesAccountId: body.salesAccountId ?? null,
            outputVatAccountId: body.outputVatAccountId ?? null,
            receivableAccountId: body.receivableAccountId ?? null,
            bankAccountId: body.bankAccountId ?? null,
          },
          update: {
            ...(body.salesAccountId !== undefined ? { salesAccountId: body.salesAccountId } : {}),
            ...(body.outputVatAccountId !== undefined
              ? { outputVatAccountId: body.outputVatAccountId }
              : {}),
            ...(body.receivableAccountId !== undefined
              ? { receivableAccountId: body.receivableAccountId }
              : {}),
            ...(body.bankAccountId !== undefined ? { bankAccountId: body.bankAccountId } : {}),
          },
        });
        await recordAudit(tx, {
          action: 'account_mapping.updated',
          organizationId,
          ...auditContext(request),
          entityType: 'account_mapping',
          entityId: result.id,
          metadata: { fields: Object.keys(body) },
        });
        return result;
      });
      return reply.send(toAccountMappingDto(mapping));
    },
  });
}
