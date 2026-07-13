import {
  createQuoteBodySchema,
  invoiceDtoSchema,
  paginatedSchema,
  quoteDtoSchema,
  quoteIdParamsSchema,
  quoteListQuerySchema,
  updateQuoteBodySchema,
} from '@businessos/types';
import type { Prisma } from '@businessos/db';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { errors } from '../../lib/errors.js';
import { toInvoiceDto, toQuoteDto } from '../../lib/mappers-billing.js';
import { toPaginated, toSkipTake } from '../../lib/pagination.js';
import { orgContext, requirePermission } from '../../plugins/auth.js';
import { auditContext, recordAudit } from '../audit/service.js';
import { recordActivity } from '../activity/service.js';
import { enqueueOutbox } from '../outbox/service.js';
import { buildDocument } from '../billing/lines.js';

const quoteInclude = {
  customer: { select: { id: true, name: true } },
  lineItems: true,
} as const;

async function assertCustomer(app: FastifyInstance, organizationId: string, customerId: string) {
  const customer = await app.prisma.customer.findFirst({
    where: { id: customerId, organizationId },
    select: { id: true },
  });
  if (!customer)
    throw errors.badRequest('invalid_customer', 'Customer not found in this organization');
}

export function registerQuoteRoutes(app: FastifyInstance): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.route({
    method: 'GET',
    url: '/v1/quotes',
    preHandler: [requirePermission('invoices.read')],
    schema: {
      tags: ['quotes'],
      querystring: quoteListQuerySchema,
      response: { 200: paginatedSchema(quoteDtoSchema) },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const { skip, take } = toSkipTake(request.query);
      const where: Prisma.QuoteWhereInput = {
        organizationId,
        ...(request.query.status ? { status: request.query.status } : {}),
        ...(request.query.customerId ? { customerId: request.query.customerId } : {}),
        ...(request.query.search
          ? { number: { contains: request.query.search, mode: 'insensitive' } }
          : {}),
      };
      const [rows, total] = await Promise.all([
        app.prisma.quote.findMany({
          where,
          include: quoteInclude,
          orderBy: { createdAt: 'desc' },
          skip,
          take,
        }),
        app.prisma.quote.count({ where }),
      ]);
      return reply.send(toPaginated(rows.map(toQuoteDto), total, request.query));
    },
  });

  r.route({
    method: 'POST',
    url: '/v1/quotes',
    preHandler: [requirePermission('invoices.manage')],
    schema: { tags: ['quotes'], body: createQuoteBodySchema, response: { 201: quoteDtoSchema } },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const body = request.body;
      await assertCustomer(app, organizationId, body.customerId);
      const doc = buildDocument(organizationId, body.lineItems);

      const quote = await app.prisma.$transaction(async (tx) => {
        const created = await tx.quote.create({
          data: {
            organizationId,
            customerId: body.customerId,
            status: 'DRAFT',
            currency: body.currency,
            issueDate: new Date(body.issueDate),
            validUntil: body.validUntil ? new Date(body.validUntil) : null,
            customerNotes: body.customerNotes ?? null,
            internalNotes: body.internalNotes ?? null,
            ...doc.header,
            createdById: request.currentUser?.id ?? null,
            lineItems: { create: doc.lines },
          },
          include: quoteInclude,
        });
        await recordAudit(tx, {
          action: 'quote.created',
          organizationId,
          ...auditContext(request),
          entityType: 'quote',
          entityId: created.id,
        });
        await recordActivity(tx, {
          organizationId,
          actorUserId: request.currentUser?.id ?? null,
          type: 'quote.created',
          ref: { customerId: created.customerId },
          metadata: { totalMinor: Number(created.totalMinor) },
        });
        return created;
      });
      return reply.code(201).send(toQuoteDto(quote));
    },
  });

  r.route({
    method: 'GET',
    url: '/v1/quotes/:quoteId',
    preHandler: [requirePermission('invoices.read')],
    schema: { tags: ['quotes'], params: quoteIdParamsSchema, response: { 200: quoteDtoSchema } },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const quote = await app.prisma.quote.findFirst({
        where: { id: request.params.quoteId, organizationId },
        include: quoteInclude,
      });
      if (!quote) throw errors.notFound('Quote');
      return reply.send(toQuoteDto(quote));
    },
  });

  r.route({
    method: 'PATCH',
    url: '/v1/quotes/:quoteId',
    preHandler: [requirePermission('invoices.manage')],
    schema: {
      tags: ['quotes'],
      params: quoteIdParamsSchema,
      body: updateQuoteBodySchema,
      response: { 200: quoteDtoSchema },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const existing = await app.prisma.quote.findFirst({
        where: { id: request.params.quoteId, organizationId },
      });
      if (!existing) throw errors.notFound('Quote');
      if (existing.status !== 'DRAFT') {
        throw errors.conflict('quote_not_draft', 'Only draft quotes can be edited');
      }
      const body = request.body;
      if (body.customerId) await assertCustomer(app, organizationId, body.customerId);
      const doc = body.lineItems ? buildDocument(organizationId, body.lineItems) : null;

      const updated = await app.prisma.$transaction(async (tx) => {
        if (doc) {
          await tx.quoteLineItem.deleteMany({ where: { quoteId: existing.id } });
        }
        const result = await tx.quote.update({
          where: { id: existing.id },
          data: {
            ...(body.customerId !== undefined ? { customerId: body.customerId } : {}),
            ...(body.currency !== undefined ? { currency: body.currency } : {}),
            ...(body.issueDate !== undefined ? { issueDate: new Date(body.issueDate) } : {}),
            ...(body.validUntil !== undefined
              ? { validUntil: body.validUntil ? new Date(body.validUntil) : null }
              : {}),
            ...(body.customerNotes !== undefined ? { customerNotes: body.customerNotes } : {}),
            ...(body.internalNotes !== undefined ? { internalNotes: body.internalNotes } : {}),
            ...(doc ? { ...doc.header, lineItems: { create: doc.lines } } : {}),
          },
          include: quoteInclude,
        });
        await recordAudit(tx, {
          action: 'quote.updated',
          organizationId,
          ...auditContext(request),
          entityType: 'quote',
          entityId: existing.id,
          metadata: { fields: Object.keys(body) },
        });
        return result;
      });
      return reply.send(toQuoteDto(updated));
    },
  });

  r.route({
    method: 'DELETE',
    url: '/v1/quotes/:quoteId',
    preHandler: [requirePermission('invoices.manage')],
    schema: { tags: ['quotes'], params: quoteIdParamsSchema },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const existing = await app.prisma.quote.findFirst({
        where: { id: request.params.quoteId, organizationId },
      });
      if (!existing) throw errors.notFound('Quote');
      if (existing.status !== 'DRAFT') {
        throw errors.conflict('quote_not_draft', 'Only draft quotes can be deleted');
      }
      await app.prisma.$transaction(async (tx) => {
        await tx.quote.delete({ where: { id: existing.id } });
        await recordAudit(tx, {
          action: 'quote.deleted',
          organizationId,
          ...auditContext(request),
          entityType: 'quote',
          entityId: existing.id,
        });
      });
      return reply.code(204).send();
    },
  });

  // Status transitions: send / accept / decline.
  const transition = (
    path: string,
    from: string[],
    to: 'SENT' | 'ACCEPTED' | 'DECLINED',
    action: 'quote.sent' | 'quote.accepted' | 'quote.declined',
    activity: 'quote.sent' | 'quote.accepted' | 'quote.declined',
  ) => {
    r.route({
      method: 'POST',
      url: `/v1/quotes/:quoteId/${path}`,
      preHandler: [requirePermission('invoices.manage')],
      schema: { tags: ['quotes'], params: quoteIdParamsSchema, response: { 200: quoteDtoSchema } },
      handler: async (request, reply) => {
        const { organizationId } = orgContext(request);
        const existing = await app.prisma.quote.findFirst({
          where: { id: request.params.quoteId, organizationId },
        });
        if (!existing) throw errors.notFound('Quote');
        if (!from.includes(existing.status)) {
          throw errors.conflict(
            'invalid_transition',
            `A ${existing.status} quote cannot be ${to.toLowerCase()}`,
          );
        }
        const updated = await app.prisma.$transaction(async (tx) => {
          const result = await tx.quote.update({
            where: { id: existing.id },
            data: {
              status: to,
              ...(to === 'ACCEPTED' ? { acceptedAt: new Date() } : {}),
              ...(to === 'DECLINED' ? { declinedAt: new Date() } : {}),
            },
            include: quoteInclude,
          });
          await recordAudit(tx, {
            action,
            organizationId,
            ...auditContext(request),
            entityType: 'quote',
            entityId: existing.id,
          });
          await recordActivity(tx, {
            organizationId,
            actorUserId: request.currentUser?.id ?? null,
            type: activity,
            ref: { customerId: existing.customerId },
          });
          if (to === 'ACCEPTED') {
            await enqueueOutbox(tx, 'quote.accepted', {
              organizationId,
              quoteId: existing.id,
              totalMinor: Number(existing.totalMinor),
            });
          }
          return result;
        });
        return reply.send(toQuoteDto(updated));
      },
    });
  };

  transition('send', ['DRAFT'], 'SENT', 'quote.sent', 'quote.sent');
  transition('accept', ['DRAFT', 'SENT'], 'ACCEPTED', 'quote.accepted', 'quote.accepted');
  transition('decline', ['DRAFT', 'SENT'], 'DECLINED', 'quote.declined', 'quote.declined');

  // Convert an accepted quote into a draft invoice (copying its line items).
  r.route({
    method: 'POST',
    url: '/v1/quotes/:quoteId/convert',
    preHandler: [requirePermission('invoices.manage')],
    schema: { tags: ['quotes'], params: quoteIdParamsSchema, response: { 201: invoiceDtoSchema } },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const quote = await app.prisma.quote.findFirst({
        where: { id: request.params.quoteId, organizationId },
        include: { lineItems: true },
      });
      if (!quote) throw errors.notFound('Quote');
      if (quote.status !== 'ACCEPTED') {
        throw errors.conflict('quote_not_accepted', 'Only accepted quotes can be converted');
      }
      if (quote.convertedInvoiceId) {
        throw errors.conflict('already_converted', 'This quote has already been converted');
      }

      const now = new Date();
      const dueDate = new Date(now);
      dueDate.setUTCDate(dueDate.getUTCDate() + 30);

      const invoice = await app.prisma.$transaction(async (tx) => {
        const created = await tx.invoice.create({
          data: {
            organizationId,
            customerId: quote.customerId,
            status: 'DRAFT',
            currency: quote.currency,
            issueDate: now,
            dueDate,
            customerNotes: quote.customerNotes,
            internalNotes: quote.internalNotes,
            subtotalMinor: quote.subtotalMinor,
            discountMinor: quote.discountMinor,
            taxMinor: quote.taxMinor,
            totalMinor: quote.totalMinor,
            taxLines: quote.taxLines ?? undefined,
            createdById: request.currentUser?.id ?? null,
            lineItems: {
              create: quote.lineItems.map((line, i) => ({
                organizationId,
                productId: line.productId,
                description: line.description,
                quantity: line.quantity,
                unitPriceMinor: line.unitPriceMinor,
                discountPercent: line.discountPercent,
                taxRatePercent: line.taxRatePercent,
                lineNetMinor: line.lineNetMinor,
                lineTaxMinor: line.lineTaxMinor,
                lineTotalMinor: line.lineTotalMinor,
                sortOrder: i,
              })),
            },
          },
          include: { customer: { select: { id: true, name: true } }, lineItems: true },
        });
        await tx.quote.update({
          where: { id: quote.id },
          data: { convertedInvoiceId: created.id },
        });
        await recordAudit(tx, {
          action: 'quote.converted',
          organizationId,
          ...auditContext(request),
          entityType: 'quote',
          entityId: quote.id,
          metadata: { invoiceId: created.id },
        });
        await recordActivity(tx, {
          organizationId,
          actorUserId: request.currentUser?.id ?? null,
          type: 'quote.converted',
          ref: { customerId: quote.customerId },
          metadata: { invoiceId: created.id },
        });
        return created;
      });
      return reply.code(201).send(toInvoiceDto(invoice, now));
    },
  });
}
