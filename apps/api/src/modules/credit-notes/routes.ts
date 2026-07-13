import {
  createCreditNoteBodySchema,
  creditNoteDtoSchema,
  invoiceIdParamsSchema,
  type CreditNoteLineInput,
} from '@businessos/types';
import { Prisma } from '@businessos/db';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { errors } from '../../lib/errors.js';
import { toCreditNoteDto } from '../../lib/mappers-billing.js';
import { computeDocument, type LineInput } from '../../lib/money.js';
import { orgContext, requirePermission } from '../../plugins/auth.js';
import { auditContext, recordAudit } from '../audit/service.js';
import { recordActivity } from '../activity/service.js';
import { allocateNumber } from '../billing/numbering.js';
import { lockInvoiceForUpdate } from '../billing/locks.js';
import { nextInvoiceStatus } from '../invoices/status.js';

const creditNoteInclude = { lineItems: true } as const;
// Credit notes correct an ISSUED invoice; a cancelled/draft invoice cannot be credited.
const CREDITABLE_STATUSES = new Set([
  'OPEN',
  'SENT',
  'PARTIALLY_PAID',
  'PAID',
  'OVERDUE',
  'CREDITED',
]);

export function registerCreditNoteRoutes(app: FastifyInstance): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.route({
    method: 'GET',
    url: '/v1/invoices/:invoiceId/credit-notes',
    preHandler: [requirePermission('invoices.read')],
    schema: {
      tags: ['credit-notes'],
      params: invoiceIdParamsSchema,
      response: { 200: z.array(creditNoteDtoSchema) },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const invoice = await app.prisma.invoice.findFirst({
        where: { id: request.params.invoiceId, organizationId },
        select: { id: true },
      });
      if (!invoice) throw errors.notFound('Invoice');
      const creditNotes = await app.prisma.creditNote.findMany({
        where: { organizationId, invoiceId: invoice.id },
        include: creditNoteInclude,
        orderBy: { createdAt: 'desc' },
      });
      return reply.send(creditNotes.map(toCreditNoteDto));
    },
  });

  r.route({
    method: 'POST',
    url: '/v1/invoices/:invoiceId/credit-notes',
    preHandler: [requirePermission('invoices.manage')],
    schema: {
      tags: ['credit-notes'],
      params: invoiceIdParamsSchema,
      body: createCreditNoteBodySchema,
      response: { 201: creditNoteDtoSchema },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const now = new Date();
      const issueDate = request.body.issueDate ? new Date(request.body.issueDate) : now;

      const creditNote = await app.prisma.$transaction(async (tx) => {
        // Lock the invoice, then validate + credit on its fresh state so
        // concurrent credit notes cannot jointly exceed the invoice total.
        await lockInvoiceForUpdate(tx, request.params.invoiceId);
        const invoice = await tx.invoice.findFirst({
          where: { id: request.params.invoiceId, organizationId },
          include: { lineItems: true },
        });
        if (!invoice) throw errors.notFound('Invoice');
        if (invoice.status === 'DRAFT') {
          throw errors.conflict('invoice_not_finalized', 'Only finalized invoices can be credited');
        }
        if (!CREDITABLE_STATUSES.has(invoice.status)) {
          throw errors.conflict('not_creditable', `A ${invoice.status} invoice cannot be credited`);
        }

        // Full credit (no lines) mirrors the invoice's net line amounts.
        const lineInputs: CreditNoteLineInput[] =
          request.body.lineItems ??
          invoice.lineItems.map((line) => ({
            description: line.description,
            quantity: 1,
            unitPriceMinor: Number(line.lineNetMinor),
            taxRatePercent: Number(line.taxRatePercent),
          }));
        const moneyInputs: LineInput[] = lineInputs.map((line) => ({
          quantity: line.quantity,
          unitPriceMinor: line.unitPriceMinor,
          discountPercent: 0,
          taxRatePercent: line.taxRatePercent,
        }));
        const { lines, totals } = computeDocument(moneyInputs);

        const newCredited = invoice.creditedMinor + BigInt(totals.totalMinor);
        if (newCredited > invoice.totalMinor) {
          throw errors.badRequest('over_credit', 'Total credited would exceed the invoice total');
        }

        const number = await allocateNumber(tx, organizationId, 'CREDIT_NOTE');
        const created = await tx.creditNote.create({
          data: {
            organizationId,
            invoiceId: invoice.id,
            number,
            status: 'ISSUED',
            currency: invoice.currency,
            issueDate,
            reason: request.body.reason ?? null,
            subtotalMinor: BigInt(totals.subtotalMinor),
            taxMinor: BigInt(totals.taxMinor),
            totalMinor: BigInt(totals.totalMinor),
            taxLines: totals.taxLines as unknown as Prisma.InputJsonValue,
            issuedAt: now,
            createdById: request.currentUser?.id ?? null,
            lineItems: {
              create: lineInputs.map((line, i) => ({
                organizationId,
                description: line.description,
                quantity: new Prisma.Decimal(line.quantity),
                unitPriceMinor: BigInt(line.unitPriceMinor),
                taxRatePercent: new Prisma.Decimal(line.taxRatePercent),
                lineNetMinor: BigInt(lines[i]!.lineNetMinor),
                lineTaxMinor: BigInt(lines[i]!.lineTaxMinor),
                lineTotalMinor: BigInt(lines[i]!.lineTotalMinor),
                sortOrder: i,
              })),
            },
          },
          include: creditNoteInclude,
        });

        const { status, paidAt } = nextInvoiceStatus(invoice, invoice.amountPaidMinor, newCredited);
        await tx.invoice.update({
          where: { id: invoice.id },
          data: { creditedMinor: newCredited, status, paidAt: paidAt ?? invoice.paidAt },
        });

        await recordAudit(tx, {
          action: 'credit_note.issued',
          organizationId,
          ...auditContext(request),
          entityType: 'credit_note',
          entityId: created.id,
          metadata: { invoiceId: invoice.id, number, totalMinor: totals.totalMinor },
        });
        await recordActivity(tx, {
          organizationId,
          actorUserId: request.currentUser?.id ?? null,
          type: 'invoice.credited',
          ref: { customerId: invoice.customerId },
          metadata: {
            invoiceId: invoice.id,
            creditNoteNumber: number,
            totalMinor: totals.totalMinor,
          },
        });
        return created;
      });
      return reply.code(201).send(toCreditNoteDto(creditNote));
    },
  });
}
