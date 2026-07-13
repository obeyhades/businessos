import {
  createProductBodySchema,
  paginatedSchema,
  productDtoSchema,
  productIdParamsSchema,
  productListQuerySchema,
  updateProductBodySchema,
} from '@businessos/types';
import { Prisma, type Prisma as PrismaTypes } from '@businessos/db';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { errors } from '../../lib/errors.js';
import { toProductDto } from '../../lib/mappers-billing.js';
import { toPaginated, toSkipTake } from '../../lib/pagination.js';
import { orgContext, requirePermission } from '../../plugins/auth.js';
import { auditContext, recordAudit } from '../audit/service.js';

function emptyToNull(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return value.length === 0 ? null : value;
}

export function registerProductRoutes(app: FastifyInstance): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.route({
    method: 'GET',
    url: '/v1/products',
    preHandler: [requirePermission('invoices.read')],
    schema: {
      tags: ['products'],
      querystring: productListQuerySchema,
      response: { 200: paginatedSchema(productDtoSchema) },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const { skip, take } = toSkipTake(request.query);
      const where: PrismaTypes.ProductWhereInput = {
        organizationId,
        ...(request.query.active ? { isActive: request.query.active === 'true' } : {}),
        ...(request.query.search
          ? {
              OR: [
                { name: { contains: request.query.search, mode: 'insensitive' } },
                { sku: { contains: request.query.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      };
      const [rows, total] = await Promise.all([
        app.prisma.product.findMany({ where, orderBy: { name: 'asc' }, skip, take }),
        app.prisma.product.count({ where }),
      ]);
      return reply.send(toPaginated(rows.map(toProductDto), total, request.query));
    },
  });

  r.route({
    method: 'POST',
    url: '/v1/products',
    preHandler: [requirePermission('invoices.manage')],
    schema: {
      tags: ['products'],
      body: createProductBodySchema,
      response: { 201: productDtoSchema },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const body = request.body;
      const product = await app.prisma.$transaction(async (tx) => {
        const created = await tx.product.create({
          data: {
            organizationId,
            name: body.name,
            description: emptyToNull(body.description) ?? null,
            sku: emptyToNull(body.sku) ?? null,
            unit: body.unit,
            unitPriceMinor: BigInt(body.unitPriceMinor),
            currency: body.currency,
            taxRatePercent: new Prisma.Decimal(body.taxRatePercent),
            isActive: body.isActive,
            createdById: request.currentUser?.id ?? null,
          },
        });
        await recordAudit(tx, {
          action: 'product.created',
          organizationId,
          ...auditContext(request),
          entityType: 'product',
          entityId: created.id,
          metadata: { name: created.name },
        });
        return created;
      });
      return reply.code(201).send(toProductDto(product));
    },
  });

  r.route({
    method: 'GET',
    url: '/v1/products/:productId',
    preHandler: [requirePermission('invoices.read')],
    schema: {
      tags: ['products'],
      params: productIdParamsSchema,
      response: { 200: productDtoSchema },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const product = await app.prisma.product.findFirst({
        where: { id: request.params.productId, organizationId },
      });
      if (!product) throw errors.notFound('Product');
      return reply.send(toProductDto(product));
    },
  });

  r.route({
    method: 'PATCH',
    url: '/v1/products/:productId',
    preHandler: [requirePermission('invoices.manage')],
    schema: {
      tags: ['products'],
      params: productIdParamsSchema,
      body: updateProductBodySchema,
      response: { 200: productDtoSchema },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const existing = await app.prisma.product.findFirst({
        where: { id: request.params.productId, organizationId },
      });
      if (!existing) throw errors.notFound('Product');
      const body = request.body;
      const updated = await app.prisma.$transaction(async (tx) => {
        const result = await tx.product.update({
          where: { id: existing.id },
          data: {
            ...(body.name !== undefined ? { name: body.name } : {}),
            ...(body.description !== undefined
              ? { description: emptyToNull(body.description) }
              : {}),
            ...(body.sku !== undefined ? { sku: emptyToNull(body.sku) } : {}),
            ...(body.unit !== undefined ? { unit: body.unit } : {}),
            ...(body.unitPriceMinor !== undefined
              ? { unitPriceMinor: BigInt(body.unitPriceMinor) }
              : {}),
            ...(body.currency !== undefined ? { currency: body.currency } : {}),
            ...(body.taxRatePercent !== undefined
              ? { taxRatePercent: new Prisma.Decimal(body.taxRatePercent) }
              : {}),
            ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
          },
        });
        await recordAudit(tx, {
          action: 'product.updated',
          organizationId,
          ...auditContext(request),
          entityType: 'product',
          entityId: existing.id,
          metadata: { fields: Object.keys(body) },
        });
        return result;
      });
      return reply.send(toProductDto(updated));
    },
  });

  r.route({
    method: 'DELETE',
    url: '/v1/products/:productId',
    preHandler: [requirePermission('invoices.manage')],
    schema: { tags: ['products'], params: productIdParamsSchema },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const existing = await app.prisma.product.findFirst({
        where: { id: request.params.productId, organizationId },
      });
      if (!existing) throw errors.notFound('Product');
      await app.prisma.$transaction(async (tx) => {
        await tx.product.delete({ where: { id: existing.id } });
        await recordAudit(tx, {
          action: 'product.deleted',
          organizationId,
          ...auditContext(request),
          entityType: 'product',
          entityId: existing.id,
          metadata: { name: existing.name },
        });
      });
      return reply.code(204).send();
    },
  });
}
