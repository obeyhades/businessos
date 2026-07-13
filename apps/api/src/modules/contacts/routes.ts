import {
  contactDtoSchema,
  contactIdParamsSchema,
  createContactBodySchema,
  customerIdParamsSchema,
  updateContactBodySchema,
} from '@businessos/types';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { errors } from '../../lib/errors.js';
import { toContactDto } from '../../lib/mappers-domain.js';
import { orgContext, requirePermission } from '../../plugins/auth.js';
import { auditContext, recordAudit } from '../audit/service.js';
import { recordActivity } from '../activity/service.js';

function emptyToNull(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  return value.length === 0 ? null : value;
}

async function assertCustomer(
  app: FastifyInstance,
  organizationId: string,
  customerId: string,
): Promise<void> {
  const customer = await app.prisma.customer.findFirst({
    where: { id: customerId, organizationId },
    select: { id: true },
  });
  if (!customer) throw errors.notFound('Customer');
}

export function registerContactRoutes(app: FastifyInstance): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.route({
    method: 'GET',
    url: '/v1/customers/:customerId/contacts',
    preHandler: [requirePermission('customers.read')],
    schema: {
      tags: ['contacts'],
      params: customerIdParamsSchema,
      response: { 200: z.array(contactDtoSchema) },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      await assertCustomer(app, organizationId, request.params.customerId);
      const contacts = await app.prisma.customerContact.findMany({
        where: { organizationId, customerId: request.params.customerId },
        orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }],
      });
      return reply.send(contacts.map(toContactDto));
    },
  });

  r.route({
    method: 'POST',
    url: '/v1/customers/:customerId/contacts',
    preHandler: [requirePermission('customers.manage')],
    schema: {
      tags: ['contacts'],
      params: customerIdParamsSchema,
      body: createContactBodySchema,
      response: { 201: contactDtoSchema },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      await assertCustomer(app, organizationId, request.params.customerId);
      const body = request.body;

      const contact = await app.prisma.$transaction(async (tx) => {
        // At most one primary contact per customer.
        if (body.isPrimary) {
          await tx.customerContact.updateMany({
            where: { customerId: request.params.customerId, isPrimary: true },
            data: { isPrimary: false },
          });
        }
        const created = await tx.customerContact.create({
          data: {
            organizationId,
            customerId: request.params.customerId,
            name: body.name,
            email: emptyToNull(body.email),
            phone: emptyToNull(body.phone),
            title: emptyToNull(body.title),
            isPrimary: body.isPrimary,
          },
        });
        await recordAudit(tx, {
          action: 'contact.created',
          organizationId,
          ...auditContext(request),
          entityType: 'customer_contact',
          entityId: created.id,
          metadata: { customerId: request.params.customerId, name: created.name },
        });
        await recordActivity(tx, {
          organizationId,
          actorUserId: request.currentUser?.id ?? null,
          type: 'contact.added',
          ref: { customerId: request.params.customerId },
          metadata: { name: created.name },
        });
        return created;
      });
      return reply.code(201).send(toContactDto(contact));
    },
  });

  r.route({
    method: 'PATCH',
    url: '/v1/customers/:customerId/contacts/:contactId',
    preHandler: [requirePermission('customers.manage')],
    schema: {
      tags: ['contacts'],
      params: contactIdParamsSchema,
      body: updateContactBodySchema,
      response: { 200: contactDtoSchema },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const existing = await app.prisma.customerContact.findFirst({
        where: {
          id: request.params.contactId,
          customerId: request.params.customerId,
          organizationId,
        },
      });
      if (!existing) throw errors.notFound('Contact');
      const body = request.body;

      const updated = await app.prisma.$transaction(async (tx) => {
        if (body.isPrimary) {
          await tx.customerContact.updateMany({
            where: {
              customerId: request.params.customerId,
              isPrimary: true,
              id: { not: existing.id },
            },
            data: { isPrimary: false },
          });
        }
        const result = await tx.customerContact.update({
          where: { id: existing.id },
          data: {
            ...(body.name !== undefined ? { name: body.name } : {}),
            ...(body.email !== undefined ? { email: emptyToNull(body.email) } : {}),
            ...(body.phone !== undefined ? { phone: emptyToNull(body.phone) } : {}),
            ...(body.title !== undefined ? { title: emptyToNull(body.title) } : {}),
            ...(body.isPrimary !== undefined ? { isPrimary: body.isPrimary } : {}),
          },
        });
        await recordAudit(tx, {
          action: 'contact.updated',
          organizationId,
          ...auditContext(request),
          entityType: 'customer_contact',
          entityId: existing.id,
          metadata: { fields: Object.keys(body) },
        });
        return result;
      });
      return reply.send(toContactDto(updated));
    },
  });

  r.route({
    method: 'DELETE',
    url: '/v1/customers/:customerId/contacts/:contactId',
    preHandler: [requirePermission('customers.manage')],
    schema: { tags: ['contacts'], params: contactIdParamsSchema },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const existing = await app.prisma.customerContact.findFirst({
        where: {
          id: request.params.contactId,
          customerId: request.params.customerId,
          organizationId,
        },
      });
      if (!existing) throw errors.notFound('Contact');
      await app.prisma.$transaction(async (tx) => {
        await tx.customerContact.delete({ where: { id: existing.id } });
        await recordAudit(tx, {
          action: 'contact.deleted',
          organizationId,
          ...auditContext(request),
          entityType: 'customer_contact',
          entityId: existing.id,
          metadata: { name: existing.name },
        });
      });
      return reply.code(204).send();
    },
  });
}
