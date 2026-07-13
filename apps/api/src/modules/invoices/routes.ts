import {
  activityDtoSchema,
  createInvoiceBodySchema,
  invoiceDtoSchema,
  invoiceIdParamsSchema,
  invoiceListQuerySchema,
  paginatedSchema,
  paginationQuerySchema,
  sendInvoiceBodySchema,
  updateInvoiceBodySchema,
} from '@businessos/types';
import type { Invoice, InvoiceLineItem, Prisma } from '@businessos/db';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { errors } from '../../lib/errors.js';
import { renderInvoicePdf } from '../../lib/invoice-pdf.js';
import { toActivityDto } from '../../lib/mappers-domain.js';
import { toInvoiceDto } from '../../lib/mappers-billing.js';
import { toPaginated, toSkipTake } from '../../lib/pagination.js';
import { orgContext, requirePermission } from '../../plugins/auth.js';
import { auditContext, recordAudit } from '../audit/service.js';
import { recordActivity } from '../activity/service.js';
import { enqueueEmail, enqueueOutbox } from '../outbox/service.js';
import { buildDocument } from '../billing/lines.js';
import { allocateNumber } from '../billing/numbering.js';
import { lockInvoiceForUpdate } from '../billing/locks.js';

const invoiceInclude = {
  customer: { select: { id: true, name: true } },
  lineItems: true,
} as const;

// Issued + outstanding invoices that may still be emailed.
const SENDABLE_STATUSES = new Set(['OPEN', 'SENT', 'PARTIALLY_PAID', 'OVERDUE']);

async function assertCustomer(app: FastifyInstance, organizationId: string, customerId: string) {
  const customer = await app.prisma.customer.findFirst({
    where: { id: customerId, organizationId },
    select: { id: true },
  });
  if (!customer)
    throw errors.badRequest('invalid_customer', 'Customer not found in this organization');
}

/** Generates the PDF and stores it in object storage; best-effort. */
async function generateAndStorePdf(
  app: FastifyInstance,
  invoice: Invoice & { customer: { name: string }; lineItems: InvoiceLineItem[] },
  organizationName: string,
): Promise<void> {
  try {
    const buffer = await renderInvoicePdf({
      organizationName,
      number: invoice.number ?? '',
      currency: invoice.currency,
      issueDate: invoice.issueDate.toISOString().slice(0, 10),
      dueDate: invoice.dueDate.toISOString().slice(0, 10),
      customerName: invoice.customer.name,
      customerNotes: invoice.customerNotes,
      lineItems: invoice.lineItems.map((l) => ({
        description: l.description,
        quantity: Number(l.quantity),
        unitPriceMinor: Number(l.unitPriceMinor),
        taxRatePercent: Number(l.taxRatePercent),
        lineNetMinor: Number(l.lineNetMinor),
      })),
      subtotalMinor: Number(invoice.subtotalMinor),
      taxMinor: Number(invoice.taxMinor),
      totalMinor: Number(invoice.totalMinor),
    });
    const key = app.storage.buildKey(invoice.organizationId, `${invoice.number ?? invoice.id}.pdf`);
    await app.storage.put(key, buffer, 'application/pdf');
    await app.prisma.invoice.update({ where: { id: invoice.id }, data: { pdfStorageKey: key } });
  } catch (error) {
    app.log.error({ err: error, invoiceId: invoice.id }, 'invoice PDF generation failed');
  }
}

export function registerInvoiceRoutes(app: FastifyInstance): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.route({
    method: 'GET',
    url: '/v1/invoices',
    preHandler: [requirePermission('invoices.read')],
    schema: {
      tags: ['invoices'],
      querystring: invoiceListQuerySchema,
      response: { 200: paginatedSchema(invoiceDtoSchema) },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const { skip, take } = toSkipTake(request.query);
      const where: Prisma.InvoiceWhereInput = {
        organizationId,
        ...(request.query.status ? { status: request.query.status } : {}),
        ...(request.query.customerId ? { customerId: request.query.customerId } : {}),
        ...(request.query.search
          ? { number: { contains: request.query.search, mode: 'insensitive' } }
          : {}),
      };
      const now = new Date();
      const [rows, total] = await Promise.all([
        app.prisma.invoice.findMany({
          where,
          include: invoiceInclude,
          orderBy: { createdAt: 'desc' },
          skip,
          take,
        }),
        app.prisma.invoice.count({ where }),
      ]);
      return reply.send(
        toPaginated(
          rows.map((row) => toInvoiceDto(row, now)),
          total,
          request.query,
        ),
      );
    },
  });

  r.route({
    method: 'POST',
    url: '/v1/invoices',
    preHandler: [requirePermission('invoices.manage')],
    schema: {
      tags: ['invoices'],
      body: createInvoiceBodySchema,
      response: { 201: invoiceDtoSchema },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const body = request.body;
      await assertCustomer(app, organizationId, body.customerId);
      const doc = buildDocument(organizationId, body.lineItems);
      const now = new Date();

      const invoice = await app.prisma.$transaction(async (tx) => {
        const created = await tx.invoice.create({
          data: {
            organizationId,
            customerId: body.customerId,
            status: 'DRAFT',
            currency: body.currency,
            issueDate: new Date(body.issueDate),
            dueDate: new Date(body.dueDate),
            customerNotes: body.customerNotes ?? null,
            internalNotes: body.internalNotes ?? null,
            ...doc.header,
            createdById: request.currentUser?.id ?? null,
            lineItems: { create: doc.lines },
          },
          include: invoiceInclude,
        });
        await recordAudit(tx, {
          action: 'invoice.created',
          organizationId,
          ...auditContext(request),
          entityType: 'invoice',
          entityId: created.id,
        });
        return created;
      });
      return reply.code(201).send(toInvoiceDto(invoice, now));
    },
  });

  r.route({
    method: 'GET',
    url: '/v1/invoices/:invoiceId',
    preHandler: [requirePermission('invoices.read')],
    schema: {
      tags: ['invoices'],
      params: invoiceIdParamsSchema,
      response: { 200: invoiceDtoSchema },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const invoice = await app.prisma.invoice.findFirst({
        where: { id: request.params.invoiceId, organizationId },
        include: invoiceInclude,
      });
      if (!invoice) throw errors.notFound('Invoice');
      return reply.send(toInvoiceDto(invoice, new Date()));
    },
  });

  r.route({
    method: 'PATCH',
    url: '/v1/invoices/:invoiceId',
    preHandler: [requirePermission('invoices.manage')],
    schema: {
      tags: ['invoices'],
      params: invoiceIdParamsSchema,
      body: updateInvoiceBodySchema,
      response: { 200: invoiceDtoSchema },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const existing = await app.prisma.invoice.findFirst({
        where: { id: request.params.invoiceId, organizationId },
      });
      if (!existing) throw errors.notFound('Invoice');
      // Immutability: a finalized invoice can never be edited. Corrections go
      // through credit notes.
      if (existing.status !== 'DRAFT') {
        throw errors.conflict(
          'invoice_not_draft',
          'Finalized invoices are immutable; use a credit note',
        );
      }
      const body = request.body;
      if (body.customerId) await assertCustomer(app, organizationId, body.customerId);
      const doc = body.lineItems ? buildDocument(organizationId, body.lineItems) : null;

      const updated = await app.prisma.$transaction(async (tx) => {
        // Re-check DRAFT on the locked row so an edit racing a finalize cannot
        // mutate an invoice that just became immutable.
        await lockInvoiceForUpdate(tx, existing.id);
        const locked = await tx.invoice.findFirst({
          where: { id: existing.id, organizationId },
          select: { status: true },
        });
        if (!locked) throw errors.notFound('Invoice');
        if (locked.status !== 'DRAFT') {
          throw errors.conflict(
            'invoice_not_draft',
            'Finalized invoices are immutable; use a credit note',
          );
        }
        if (doc) await tx.invoiceLineItem.deleteMany({ where: { invoiceId: existing.id } });
        const result = await tx.invoice.update({
          where: { id: existing.id },
          data: {
            ...(body.customerId !== undefined ? { customerId: body.customerId } : {}),
            ...(body.currency !== undefined ? { currency: body.currency } : {}),
            ...(body.issueDate !== undefined ? { issueDate: new Date(body.issueDate) } : {}),
            ...(body.dueDate !== undefined ? { dueDate: new Date(body.dueDate) } : {}),
            ...(body.customerNotes !== undefined ? { customerNotes: body.customerNotes } : {}),
            ...(body.internalNotes !== undefined ? { internalNotes: body.internalNotes } : {}),
            ...(doc ? { ...doc.header, lineItems: { create: doc.lines } } : {}),
          },
          include: invoiceInclude,
        });
        await recordAudit(tx, {
          action: 'invoice.updated',
          organizationId,
          ...auditContext(request),
          entityType: 'invoice',
          entityId: existing.id,
          metadata: { fields: Object.keys(body) },
        });
        return result;
      });
      return reply.send(toInvoiceDto(updated, new Date()));
    },
  });

  r.route({
    method: 'DELETE',
    url: '/v1/invoices/:invoiceId',
    preHandler: [requirePermission('invoices.manage')],
    schema: { tags: ['invoices'], params: invoiceIdParamsSchema },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const existing = await app.prisma.invoice.findFirst({
        where: { id: request.params.invoiceId, organizationId },
      });
      if (!existing) throw errors.notFound('Invoice');
      await app.prisma.$transaction(async (tx) => {
        await lockInvoiceForUpdate(tx, existing.id);
        const locked = await tx.invoice.findFirst({
          where: { id: existing.id, organizationId },
          select: { status: true },
        });
        if (!locked) throw errors.notFound('Invoice');
        // Only drafts may be deleted; finalized invoices are cancelled, never removed.
        if (locked.status !== 'DRAFT') {
          throw errors.conflict(
            'invoice_not_draft',
            'Finalized invoices cannot be deleted; cancel instead',
          );
        }
        await tx.invoice.delete({ where: { id: existing.id } });
        await recordAudit(tx, {
          action: 'invoice.updated',
          organizationId,
          ...auditContext(request),
          entityType: 'invoice',
          entityId: existing.id,
          metadata: { deleted: true },
        });
      });
      return reply.code(204).send();
    },
  });

  // Finalize: assign a concurrency-safe number, freeze the invoice, generate PDF.
  r.route({
    method: 'POST',
    url: '/v1/invoices/:invoiceId/finalize',
    preHandler: [requirePermission('invoices.manage')],
    schema: {
      tags: ['invoices'],
      params: invoiceIdParamsSchema,
      response: { 200: invoiceDtoSchema },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);

      const invoice = await app.prisma.$transaction(async (tx) => {
        // Lock + re-check DRAFT inside the tx so two concurrent finalizes cannot
        // both proceed (which would burn a number and double-emit the event).
        await lockInvoiceForUpdate(tx, request.params.invoiceId);
        const existing = await tx.invoice.findFirst({
          where: { id: request.params.invoiceId, organizationId },
          include: { lineItems: true },
        });
        if (!existing) throw errors.notFound('Invoice');
        if (existing.status !== 'DRAFT') {
          throw errors.conflict('already_finalized', 'This invoice is already finalized');
        }
        if (existing.lineItems.length === 0) {
          throw errors.badRequest('empty_invoice', 'Cannot finalize an invoice with no line items');
        }
        const number = await allocateNumber(tx, organizationId, 'INVOICE');
        const result = await tx.invoice.update({
          where: { id: existing.id },
          data: { status: 'OPEN', number, finalizedAt: new Date() },
          include: invoiceInclude,
        });
        await recordAudit(tx, {
          action: 'invoice.finalized',
          organizationId,
          ...auditContext(request),
          entityType: 'invoice',
          entityId: existing.id,
          metadata: { number },
        });
        await recordActivity(tx, {
          organizationId,
          actorUserId: request.currentUser?.id ?? null,
          type: 'invoice.finalized',
          ref: { customerId: existing.customerId },
          metadata: { number, totalMinor: Number(result.totalMinor) },
        });
        // Accounting-draft hook: Phase 5 consumes this to generate journal entries.
        await enqueueOutbox(tx, 'invoice.finalized', {
          organizationId,
          invoiceId: existing.id,
          number,
          totalMinor: Number(result.totalMinor),
          taxMinor: Number(result.taxMinor),
          currency: result.currency,
        });
        return result;
      });

      const org = await app.prisma.organization.findUniqueOrThrow({
        where: { id: organizationId },
      });
      await generateAndStorePdf(app, invoice, org.name);
      const fresh = await app.prisma.invoice.findUniqueOrThrow({
        where: { id: invoice.id },
        include: invoiceInclude,
      });
      return reply.send(toInvoiceDto(fresh, new Date()));
    },
  });

  // Send: email the invoice (with PDF) after explicit user action.
  r.route({
    method: 'POST',
    url: '/v1/invoices/:invoiceId/send',
    preHandler: [requirePermission('invoices.manage')],
    schema: {
      tags: ['invoices'],
      params: invoiceIdParamsSchema,
      body: sendInvoiceBodySchema,
      response: { 200: invoiceDtoSchema },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const invoice = await app.prisma.invoice.findFirst({
        where: { id: request.params.invoiceId, organizationId },
        include: { ...invoiceInclude, customer: true },
      });
      if (!invoice) throw errors.notFound('Invoice');
      // Only issued + outstanding invoices are sendable — not draft, paid,
      // cancelled or fully credited (which would resurrect a closed document).
      if (!SENDABLE_STATUSES.has(invoice.status)) {
        throw errors.conflict('not_sendable', `A ${invoice.status} invoice cannot be sent`);
      }
      const recipient = request.body.to ?? invoice.customer.email;
      if (!recipient) {
        throw errors.badRequest('no_recipient', 'The customer has no email; provide a recipient');
      }
      // Sending only advances OPEN → SENT; a partially-paid/overdue invoice keeps
      // its payment status (which must not be clobbered back to SENT).
      const nextStatus = invoice.status === 'OPEN' ? 'SENT' : invoice.status;
      const amountDue =
        Number(invoice.totalMinor - invoice.amountPaidMinor - invoice.creditedMinor) / 100;

      const updated = await app.prisma.$transaction(async (tx) => {
        const result = await tx.invoice.update({
          where: { id: invoice.id },
          data: { status: nextStatus, sentAt: invoice.sentAt ?? new Date() },
          include: invoiceInclude,
        });
        await enqueueEmail(tx, {
          to: recipient,
          kind: 'invoice',
          organizationId,
          subject: `Invoice ${invoice.number}`,
          text: [
            `Please find invoice ${invoice.number} attached.`,
            '',
            `Amount due: ${amountDue.toFixed(2)} ${invoice.currency}`,
            `Due date: ${invoice.dueDate.toISOString().slice(0, 10)}`,
          ].join('\n'),
          ...(invoice.pdfStorageKey
            ? {
                attachment: {
                  storageKey: invoice.pdfStorageKey,
                  fileName: `${invoice.number}.pdf`,
                  contentType: 'application/pdf',
                },
              }
            : {}),
        });
        await recordAudit(tx, {
          action: 'invoice.sent',
          organizationId,
          ...auditContext(request),
          entityType: 'invoice',
          entityId: invoice.id,
          metadata: { recipient },
        });
        await recordActivity(tx, {
          organizationId,
          actorUserId: request.currentUser?.id ?? null,
          type: 'invoice.sent',
          ref: { customerId: invoice.customerId },
        });
        await enqueueOutbox(tx, 'invoice.sent', { organizationId, invoiceId: invoice.id });
        return result;
      });
      return reply.send(toInvoiceDto(updated, new Date()));
    },
  });

  r.route({
    method: 'POST',
    url: '/v1/invoices/:invoiceId/cancel',
    preHandler: [requirePermission('invoices.manage')],
    schema: {
      tags: ['invoices'],
      params: invoiceIdParamsSchema,
      response: { 200: invoiceDtoSchema },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const updated = await app.prisma.$transaction(async (tx) => {
        await lockInvoiceForUpdate(tx, request.params.invoiceId);
        const existing = await tx.invoice.findFirst({
          where: { id: request.params.invoiceId, organizationId },
        });
        if (!existing) throw errors.notFound('Invoice');
        if (existing.status === 'DRAFT') {
          throw errors.conflict('is_draft', 'Delete drafts instead of cancelling');
        }
        if (['PAID', 'CANCELLED', 'CREDITED'].includes(existing.status)) {
          throw errors.conflict(
            'cannot_cancel',
            `A ${existing.status} invoice cannot be cancelled`,
          );
        }
        if (existing.amountPaidMinor > 0n) {
          throw errors.conflict('has_payments', 'Refund and remove payments before cancelling');
        }
        const result = await tx.invoice.update({
          where: { id: existing.id },
          data: { status: 'CANCELLED', cancelledAt: new Date() },
          include: invoiceInclude,
        });
        await recordAudit(tx, {
          action: 'invoice.cancelled',
          organizationId,
          ...auditContext(request),
          entityType: 'invoice',
          entityId: existing.id,
        });
        await recordActivity(tx, {
          organizationId,
          actorUserId: request.currentUser?.id ?? null,
          type: 'invoice.cancelled',
          ref: { customerId: existing.customerId },
        });
        return result;
      });
      return reply.send(toInvoiceDto(updated, new Date()));
    },
  });

  r.route({
    method: 'GET',
    url: '/v1/invoices/:invoiceId/pdf-url',
    preHandler: [requirePermission('invoices.read')],
    schema: {
      tags: ['invoices'],
      params: invoiceIdParamsSchema,
      response: { 200: z.object({ url: z.string().url(), expiresInSeconds: z.number().int() }) },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const invoice = await app.prisma.invoice.findFirst({
        where: { id: request.params.invoiceId, organizationId },
        select: { number: true, pdfStorageKey: true },
      });
      if (!invoice) throw errors.notFound('Invoice');
      if (!invoice.pdfStorageKey) {
        throw errors.conflict('no_pdf', 'This invoice has no PDF yet; finalize it first');
      }
      const signed = await app.storage.getDownloadUrl(
        invoice.pdfStorageKey,
        `${invoice.number ?? 'invoice'}.pdf`,
      );
      return reply.send(signed);
    },
  });

  r.route({
    method: 'GET',
    url: '/v1/invoices/:invoiceId/activity',
    preHandler: [requirePermission('invoices.read')],
    schema: {
      tags: ['invoices'],
      params: invoiceIdParamsSchema,
      querystring: paginationQuerySchema,
      response: { 200: paginatedSchema(activityDtoSchema) },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const invoice = await app.prisma.invoice.findFirst({
        where: { id: request.params.invoiceId, organizationId },
        select: { customerId: true, createdAt: true },
      });
      if (!invoice) throw errors.notFound('Invoice');
      // Invoice activity is recorded against the customer timeline; scope to
      // this customer's billing events since the invoice was created.
      const { skip, take } = toSkipTake(request.query);
      const where: Prisma.ActivityWhereInput = {
        organizationId,
        customerId: invoice.customerId,
        type: {
          in: [
            'invoice.finalized',
            'invoice.sent',
            'invoice.cancelled',
            'payment.registered',
            'invoice.credited',
            'quote.converted',
          ],
        },
      };
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
