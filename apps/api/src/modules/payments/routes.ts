import {
  createPaymentBodySchema,
  invoiceIdParamsSchema,
  paymentDtoSchema,
  paymentIdParamsSchema,
} from '@businessos/types';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { errors } from '../../lib/errors.js';
import { toPaymentDto } from '../../lib/mappers-billing.js';
import { orgContext, requirePermission } from '../../plugins/auth.js';
import { auditContext, recordAudit } from '../audit/service.js';
import { recordActivity } from '../activity/service.js';
import { enqueueOutbox } from '../outbox/service.js';
import { nextInvoiceStatus } from '../invoices/status.js';
import { lockInvoiceForUpdate } from '../billing/locks.js';

const PAYABLE_STATUSES = new Set(['OPEN', 'SENT', 'PARTIALLY_PAID', 'OVERDUE']);

export function registerPaymentRoutes(app: FastifyInstance): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.route({
    method: 'GET',
    url: '/v1/invoices/:invoiceId/payments',
    preHandler: [requirePermission('invoices.read')],
    schema: {
      tags: ['payments'],
      params: invoiceIdParamsSchema,
      response: { 200: z.array(paymentDtoSchema) },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const invoice = await app.prisma.invoice.findFirst({
        where: { id: request.params.invoiceId, organizationId },
        select: { id: true },
      });
      if (!invoice) throw errors.notFound('Invoice');
      const payments = await app.prisma.payment.findMany({
        where: { organizationId, invoiceId: invoice.id },
        include: { createdBy: true },
        orderBy: { paidOn: 'desc' },
      });
      return reply.send(payments.map(toPaymentDto));
    },
  });

  r.route({
    method: 'POST',
    url: '/v1/invoices/:invoiceId/payments',
    preHandler: [requirePermission('invoices.manage')],
    schema: {
      tags: ['payments'],
      params: invoiceIdParamsSchema,
      body: createPaymentBodySchema,
      response: { 201: paymentDtoSchema },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const amount = BigInt(request.body.amountMinor);

      const payment = await app.prisma.$transaction(async (tx) => {
        // Lock the invoice, then validate + apply on its fresh state so
        // concurrent payments serialize (no lost updates, no overpayment slip).
        await lockInvoiceForUpdate(tx, request.params.invoiceId);
        const invoice = await tx.invoice.findFirst({
          where: { id: request.params.invoiceId, organizationId },
        });
        if (!invoice) throw errors.notFound('Invoice');
        if (!PAYABLE_STATUSES.has(invoice.status)) {
          throw errors.conflict(
            'not_payable',
            `A ${invoice.status} invoice cannot receive payments`,
          );
        }
        const amountDue = invoice.totalMinor - invoice.amountPaidMinor - invoice.creditedMinor;
        if (amount > amountDue) {
          throw errors.badRequest('overpayment', 'Payment exceeds the amount due');
        }

        const created = await tx.payment.create({
          data: {
            organizationId,
            invoiceId: invoice.id,
            amountMinor: amount,
            method: request.body.method,
            reference: request.body.reference ?? null,
            paidOn: new Date(request.body.paidOn),
            note: request.body.note ?? null,
            createdById: request.currentUser?.id ?? null,
          },
          include: { createdBy: true },
        });
        const newPaid = invoice.amountPaidMinor + amount;
        const { status, paidAt } = nextInvoiceStatus(invoice, newPaid, invoice.creditedMinor);
        await tx.invoice.update({
          where: { id: invoice.id },
          data: { amountPaidMinor: newPaid, status, paidAt: paidAt ?? invoice.paidAt },
        });
        await recordAudit(tx, {
          action: 'payment.registered',
          organizationId,
          ...auditContext(request),
          entityType: 'payment',
          entityId: created.id,
          metadata: { invoiceId: invoice.id, amountMinor: Number(amount) },
        });
        await recordActivity(tx, {
          organizationId,
          actorUserId: request.currentUser?.id ?? null,
          type: 'payment.registered',
          ref: { customerId: invoice.customerId },
          metadata: { invoiceId: invoice.id, amountMinor: Number(amount) },
        });
        await enqueueOutbox(tx, 'payment.registered', {
          organizationId,
          invoiceId: invoice.id,
          paymentId: created.id,
          amountMinor: Number(amount),
        });
        return created;
      });
      return reply.code(201).send(toPaymentDto(payment));
    },
  });

  r.route({
    method: 'DELETE',
    url: '/v1/invoices/:invoiceId/payments/:paymentId',
    preHandler: [requirePermission('invoices.manage')],
    schema: { tags: ['payments'], params: paymentIdParamsSchema },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      await app.prisma.$transaction(async (tx) => {
        await lockInvoiceForUpdate(tx, request.params.invoiceId);
        const payment = await tx.payment.findFirst({
          where: {
            id: request.params.paymentId,
            organizationId,
            invoiceId: request.params.invoiceId,
          },
        });
        if (!payment) throw errors.notFound('Payment');
        const invoice = await tx.invoice.findUniqueOrThrow({ where: { id: payment.invoiceId } });

        await tx.payment.delete({ where: { id: payment.id } });
        const newPaid = invoice.amountPaidMinor - payment.amountMinor;
        const { status, paidAt } = nextInvoiceStatus(invoice, newPaid, invoice.creditedMinor);
        await tx.invoice.update({
          where: { id: invoice.id },
          data: { amountPaidMinor: newPaid, status, paidAt },
        });
        await recordAudit(tx, {
          action: 'payment.deleted',
          organizationId,
          ...auditContext(request),
          entityType: 'payment',
          entityId: payment.id,
          metadata: { invoiceId: invoice.id, amountMinor: Number(payment.amountMinor) },
        });
      });
      return reply.code(204).send();
    },
  });
}
