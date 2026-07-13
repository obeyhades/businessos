import {
  activityDtoSchema,
  createCustomerBodySchema,
  customerDtoSchema,
  customerIdParamsSchema,
  customerListQuerySchema,
  paginatedSchema,
  paginationQuerySchema,
  updateCustomerBodySchema,
} from '@businessos/types';
import type { Prisma } from '@businessos/db';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { errors } from '../../lib/errors.js';
import { toActivityDto, toCustomerDto } from '../../lib/mappers-domain.js';
import { toPaginated, toSkipTake } from '../../lib/pagination.js';
import { orgContext, requirePermission } from '../../plugins/auth.js';
import { auditContext, recordAudit } from '../audit/service.js';
import { recordActivity } from '../activity/service.js';

/** Normalizes '' from optional email/text fields to null for storage. */
function emptyToNull(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  return value.length === 0 ? null : value;
}

export function registerCustomerRoutes(app: FastifyInstance): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.route({
    method: 'GET',
    url: '/v1/customers',
    preHandler: [requirePermission('customers.read')],
    schema: {
      tags: ['customers'],
      querystring: customerListQuerySchema,
      response: { 200: paginatedSchema(customerDtoSchema) },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const { skip, take } = toSkipTake(request.query);
      const where: Prisma.CustomerWhereInput = {
        organizationId,
        ...(request.query.status ? { status: request.query.status } : {}),
        ...(request.query.search
          ? {
              OR: [
                { name: { contains: request.query.search, mode: 'insensitive' } },
                { email: { contains: request.query.search, mode: 'insensitive' } },
                { orgNumber: { contains: request.query.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      };
      const [rows, total] = await Promise.all([
        app.prisma.customer.findMany({ where, orderBy: { name: 'asc' }, skip, take }),
        app.prisma.customer.count({ where }),
      ]);
      return reply.send(toPaginated(rows.map(toCustomerDto), total, request.query));
    },
  });

  r.route({
    method: 'POST',
    url: '/v1/customers',
    preHandler: [requirePermission('customers.manage')],
    schema: {
      tags: ['customers'],
      body: createCustomerBodySchema,
      response: { 201: customerDtoSchema },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const body = request.body;
      const customer = await app.prisma.$transaction(async (tx) => {
        const created = await tx.customer.create({
          data: {
            organizationId,
            name: body.name,
            orgNumber: emptyToNull(body.orgNumber),
            email: emptyToNull(body.email),
            phone: emptyToNull(body.phone),
            addressLine1: emptyToNull(body.addressLine1),
            addressLine2: emptyToNull(body.addressLine2),
            postalCode: emptyToNull(body.postalCode),
            city: emptyToNull(body.city),
            country: emptyToNull(body.country),
            notes: emptyToNull(body.notes),
            status: body.status,
            createdById: request.currentUser?.id ?? null,
          },
        });
        await recordAudit(tx, {
          action: 'customer.created',
          organizationId,
          ...auditContext(request),
          entityType: 'customer',
          entityId: created.id,
          metadata: { name: created.name },
        });
        await recordActivity(tx, {
          organizationId,
          actorUserId: request.currentUser?.id ?? null,
          type: 'customer.created',
          ref: { customerId: created.id },
          metadata: { name: created.name },
        });
        return created;
      });
      return reply.code(201).send(toCustomerDto(customer));
    },
  });

  r.route({
    method: 'GET',
    url: '/v1/customers/:customerId',
    preHandler: [requirePermission('customers.read')],
    schema: {
      tags: ['customers'],
      params: customerIdParamsSchema,
      response: { 200: customerDtoSchema },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const customer = await app.prisma.customer.findFirst({
        where: { id: request.params.customerId, organizationId },
      });
      if (!customer) throw errors.notFound('Customer');
      return reply.send(toCustomerDto(customer));
    },
  });

  r.route({
    method: 'PATCH',
    url: '/v1/customers/:customerId',
    preHandler: [requirePermission('customers.manage')],
    schema: {
      tags: ['customers'],
      params: customerIdParamsSchema,
      body: updateCustomerBodySchema,
      response: { 200: customerDtoSchema },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const existing = await app.prisma.customer.findFirst({
        where: { id: request.params.customerId, organizationId },
      });
      if (!existing) throw errors.notFound('Customer');
      const body = request.body;

      const updated = await app.prisma.$transaction(async (tx) => {
        const result = await tx.customer.update({
          where: { id: existing.id },
          data: {
            ...(body.name !== undefined ? { name: body.name } : {}),
            ...(body.orgNumber !== undefined ? { orgNumber: emptyToNull(body.orgNumber) } : {}),
            ...(body.email !== undefined ? { email: emptyToNull(body.email) } : {}),
            ...(body.phone !== undefined ? { phone: emptyToNull(body.phone) } : {}),
            ...(body.addressLine1 !== undefined
              ? { addressLine1: emptyToNull(body.addressLine1) }
              : {}),
            ...(body.addressLine2 !== undefined
              ? { addressLine2: emptyToNull(body.addressLine2) }
              : {}),
            ...(body.postalCode !== undefined ? { postalCode: emptyToNull(body.postalCode) } : {}),
            ...(body.city !== undefined ? { city: emptyToNull(body.city) } : {}),
            ...(body.country !== undefined ? { country: emptyToNull(body.country) } : {}),
            ...(body.notes !== undefined ? { notes: emptyToNull(body.notes) } : {}),
            ...(body.status !== undefined ? { status: body.status } : {}),
          },
        });
        const archived = body.status === 'ARCHIVED' && existing.status !== 'ARCHIVED';
        await recordAudit(tx, {
          action: archived ? 'customer.archived' : 'customer.updated',
          organizationId,
          ...auditContext(request),
          entityType: 'customer',
          entityId: existing.id,
          metadata: { fields: Object.keys(body) },
        });
        await recordActivity(tx, {
          organizationId,
          actorUserId: request.currentUser?.id ?? null,
          type: archived ? 'customer.archived' : 'customer.updated',
          ref: { customerId: existing.id },
        });
        return result;
      });
      return reply.send(toCustomerDto(updated));
    },
  });

  // Customer timeline: activities denormalized onto this customer (includes its
  // projects' and tasks' activities).
  r.route({
    method: 'GET',
    url: '/v1/customers/:customerId/activity',
    preHandler: [requirePermission('customers.read')],
    schema: {
      tags: ['customers'],
      params: customerIdParamsSchema,
      querystring: paginationQuerySchema,
      response: { 200: paginatedSchema(activityDtoSchema) },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const customer = await app.prisma.customer.findFirst({
        where: { id: request.params.customerId, organizationId },
        select: { id: true },
      });
      if (!customer) throw errors.notFound('Customer');
      const { skip, take } = toSkipTake(request.query);
      const where = { organizationId, customerId: customer.id };
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
