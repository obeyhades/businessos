import {
  createVoucherBodySchema,
  paginatedSchema,
  reconcileVoucherBodySchema,
  reverseVoucherBodySchema,
  updateVoucherBodySchema,
  voucherDtoSchema,
  voucherIdParamsSchema,
  voucherListQuerySchema,
} from '@businessos/types';
import { type Prisma as PrismaTypes } from '@businessos/db';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { errors } from '../../lib/errors.js';
import { toSkipTake, toPaginated } from '../../lib/pagination.js';
import { orgContext, requirePermission } from '../../plugins/auth.js';
import { auditContext, recordAudit } from '../audit/service.js';
import { enqueueOutbox } from '../outbox/service.js';
import { allocateNumber } from '../billing/numbering.js';
import { lockVoucherForUpdate } from '../billing/locks.js';
import { toVoucherDto } from './mappers.js';
import {
  assertPostablePeriod,
  buildVoucherLines,
  parseIsoDate,
  resolvePeriodForDate,
  voucherInclude,
} from './service.js';

export function registerVoucherRoutes(app: FastifyInstance): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.route({
    method: 'GET',
    url: '/v1/accounting/vouchers',
    preHandler: [requirePermission('accounting.read')],
    schema: {
      tags: ['accounting'],
      querystring: voucherListQuerySchema,
      response: { 200: paginatedSchema(voucherDtoSchema) },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const { skip, take } = toSkipTake(request.query);
      const q = request.query;
      const where: PrismaTypes.VoucherWhereInput = {
        organizationId,
        ...(q.status ? { status: q.status } : {}),
        ...(q.source ? { source: q.source } : {}),
        ...(q.reconciled ? { reconciledAt: q.reconciled === 'true' ? { not: null } : null } : {}),
        ...(q.from || q.to
          ? {
              date: {
                ...(q.from ? { gte: parseIsoDate(q.from) } : {}),
                ...(q.to ? { lte: parseIsoDate(q.to) } : {}),
              },
            }
          : {}),
        ...(q.accountId ? { lines: { some: { accountId: q.accountId } } } : {}),
      };
      const [rows, total] = await Promise.all([
        app.prisma.voucher.findMany({
          where,
          include: voucherInclude,
          orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
          skip,
          take,
        }),
        app.prisma.voucher.count({ where }),
      ]);
      return reply.send(toPaginated(rows.map(toVoucherDto), total, request.query));
    },
  });

  r.route({
    method: 'POST',
    url: '/v1/accounting/vouchers',
    preHandler: [requirePermission('accounting.manage')],
    schema: {
      tags: ['accounting'],
      body: createVoucherBodySchema,
      response: { 201: voucherDtoSchema },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const body = request.body;
      const date = parseIsoDate(body.date);
      const voucher = await app.prisma.$transaction(async (tx) => {
        const { lines, totalDebitMinor, totalCreditMinor } = await buildVoucherLines(
          tx,
          organizationId,
          body.lines,
        );
        const period = await resolvePeriodForDate(tx, organizationId, date);
        const created = await tx.voucher.create({
          data: {
            organizationId,
            date,
            description: body.description,
            status: 'DRAFT',
            source: 'MANUAL',
            fiscalPeriodId: period?.id ?? null,
            totalDebitMinor,
            totalCreditMinor,
            createdById: request.currentUser?.id ?? null,
            lines: { create: lines.map((l) => ({ organizationId, ...l })) },
          },
          include: voucherInclude,
        });
        await recordAudit(tx, {
          action: 'voucher.created',
          organizationId,
          ...auditContext(request),
          entityType: 'voucher',
          entityId: created.id,
          metadata: { lines: lines.length },
        });
        return created;
      });
      return reply.code(201).send(toVoucherDto(voucher));
    },
  });

  r.route({
    method: 'GET',
    url: '/v1/accounting/vouchers/:voucherId',
    preHandler: [requirePermission('accounting.read')],
    schema: {
      tags: ['accounting'],
      params: voucherIdParamsSchema,
      response: { 200: voucherDtoSchema },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const voucher = await app.prisma.voucher.findFirst({
        where: { id: request.params.voucherId, organizationId },
        include: voucherInclude,
      });
      if (!voucher) throw errors.notFound('Voucher');
      return reply.send(toVoucherDto(voucher));
    },
  });

  r.route({
    method: 'PATCH',
    url: '/v1/accounting/vouchers/:voucherId',
    preHandler: [requirePermission('accounting.manage')],
    schema: {
      tags: ['accounting'],
      params: voucherIdParamsSchema,
      body: updateVoucherBodySchema,
      response: { 200: voucherDtoSchema },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const body = request.body;
      const voucher = await app.prisma.$transaction(async (tx) => {
        await lockVoucherForUpdate(tx, request.params.voucherId);
        const existing = await tx.voucher.findFirst({
          where: { id: request.params.voucherId, organizationId },
        });
        if (!existing) throw errors.notFound('Voucher');
        // Posted/reversed vouchers are immutable — correct them via a reversal.
        if (existing.status !== 'DRAFT') {
          throw errors.conflict('voucher_immutable', 'Only draft vouchers can be edited');
        }

        const data: PrismaTypes.VoucherUpdateInput = {};
        if (body.description !== undefined) data.description = body.description;
        let date = existing.date;
        if (body.date !== undefined) {
          date = parseIsoDate(body.date);
          data.date = date;
        }
        if (body.lines !== undefined) {
          const { lines, totalDebitMinor, totalCreditMinor } = await buildVoucherLines(
            tx,
            organizationId,
            body.lines,
          );
          data.totalDebitMinor = totalDebitMinor;
          data.totalCreditMinor = totalCreditMinor;
          data.lines = {
            deleteMany: {},
            create: lines.map((l) => ({ organizationId, ...l })),
          };
        }
        // Keep the informational period in sync with the (possibly new) date.
        if (body.date !== undefined) {
          const period = await resolvePeriodForDate(tx, organizationId, date);
          data.fiscalPeriod = period ? { connect: { id: period.id } } : { disconnect: true };
        }

        const updated = await tx.voucher.update({
          where: { id: existing.id },
          data,
          include: voucherInclude,
        });
        await recordAudit(tx, {
          action: 'voucher.updated',
          organizationId,
          ...auditContext(request),
          entityType: 'voucher',
          entityId: existing.id,
          metadata: { fields: Object.keys(body) },
        });
        return updated;
      });
      return reply.send(toVoucherDto(voucher));
    },
  });

  r.route({
    method: 'DELETE',
    url: '/v1/accounting/vouchers/:voucherId',
    preHandler: [requirePermission('accounting.manage')],
    schema: { tags: ['accounting'], params: voucherIdParamsSchema },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      await app.prisma.$transaction(async (tx) => {
        await lockVoucherForUpdate(tx, request.params.voucherId);
        const existing = await tx.voucher.findFirst({
          where: { id: request.params.voucherId, organizationId },
        });
        if (!existing) throw errors.notFound('Voucher');
        if (existing.status !== 'DRAFT') {
          throw errors.conflict('voucher_immutable', 'Only draft vouchers can be deleted');
        }
        await tx.voucher.delete({ where: { id: existing.id } });
        await recordAudit(tx, {
          action: 'voucher.deleted',
          organizationId,
          ...auditContext(request),
          entityType: 'voucher',
          entityId: existing.id,
          metadata: {},
        });
      });
      return reply.code(204).send();
    },
  });

  // --- Post: draft → posted (balanced, open period, numbered, immutable) ------
  r.route({
    method: 'POST',
    url: '/v1/accounting/vouchers/:voucherId/post',
    preHandler: [requirePermission('accounting.post')],
    schema: {
      tags: ['accounting'],
      params: voucherIdParamsSchema,
      response: { 200: voucherDtoSchema },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const voucher = await app.prisma.$transaction(async (tx) => {
        // Lock first so two concurrent posts of one draft serialize — otherwise
        // both pass the DRAFT guard, allocate two numbers, and double-emit.
        await lockVoucherForUpdate(tx, request.params.voucherId);
        const existing = await tx.voucher.findFirst({
          where: { id: request.params.voucherId, organizationId },
          include: { lines: true },
        });
        if (!existing) throw errors.notFound('Voucher');
        if (existing.status !== 'DRAFT') {
          throw errors.conflict('already_posted', `Voucher is ${existing.status}, not a draft`);
        }
        // Recompute totals from the persisted lines (never trust stored totals).
        let debit = 0n;
        let credit = 0n;
        for (const l of existing.lines) {
          debit += l.debitMinor;
          credit += l.creditMinor;
        }
        if (existing.lines.length < 2) {
          throw errors.badRequest('too_few_lines', 'A voucher needs at least two lines');
        }
        if (debit !== credit) {
          throw errors.badRequest(
            'unbalanced',
            `Debit (${debit}) and credit (${credit}) must be equal before posting`,
          );
        }
        if (debit === 0n) {
          throw errors.badRequest('zero_voucher', 'A voucher must have a non-zero amount');
        }

        const periodId = await assertPostablePeriod(tx, organizationId, existing.date);
        const number = await allocateNumber(tx, organizationId, 'VOUCHER');
        const posted = await tx.voucher.update({
          where: { id: existing.id },
          data: {
            status: 'POSTED',
            number,
            fiscalPeriodId: periodId,
            totalDebitMinor: debit,
            totalCreditMinor: credit,
            postedAt: new Date(),
            postedById: request.currentUser?.id ?? null,
          },
          include: voucherInclude,
        });
        await recordAudit(tx, {
          action: 'voucher.posted',
          organizationId,
          ...auditContext(request),
          entityType: 'voucher',
          entityId: existing.id,
          metadata: { number, totalDebitMinor: Number(debit) },
        });
        await enqueueOutbox(tx, 'voucher.posted', {
          organizationId,
          voucherId: existing.id,
          number,
          totalDebitMinor: Number(debit),
        });
        return posted;
      });
      return reply.send(toVoucherDto(voucher));
    },
  });

  // --- Reverse: create an offsetting posted voucher ---------------------------
  r.route({
    method: 'POST',
    url: '/v1/accounting/vouchers/:voucherId/reverse',
    preHandler: [requirePermission('accounting.post')],
    schema: {
      tags: ['accounting'],
      params: voucherIdParamsSchema,
      body: reverseVoucherBodySchema,
      response: { 201: voucherDtoSchema },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      // Normalize to date-only UTC midnight (matches @db.Date and period
      // resolution); a raw new Date() carries a time-of-day that fails to match
      // a period whose end date is the reversal day.
      const reversalDate = request.body.date
        ? parseIsoDate(request.body.date)
        : parseIsoDate(new Date().toISOString().slice(0, 10));
      const reversal = await app.prisma.$transaction(async (tx) => {
        await lockVoucherForUpdate(tx, request.params.voucherId);
        const original = await tx.voucher.findFirst({
          where: { id: request.params.voucherId, organizationId },
          include: { lines: true, reversedBy: { select: { id: true } } },
        });
        if (!original) throw errors.notFound('Voucher');
        if (original.status !== 'POSTED') {
          throw errors.conflict('not_reversible', 'Only a posted voucher can be reversed');
        }
        if (original.reversedBy) {
          throw errors.conflict('already_reversed', 'This voucher has already been reversed');
        }

        const periodId = await assertPostablePeriod(tx, organizationId, reversalDate);
        const number = await allocateNumber(tx, organizationId, 'VOUCHER');
        const description =
          request.body.description ?? `Reversal of ${original.number ?? 'voucher'}`;
        // Swap debit/credit on every line so the pair nets to zero.
        const created = await tx.voucher.create({
          data: {
            organizationId,
            number,
            date: reversalDate,
            description,
            status: 'POSTED',
            source: original.source,
            fiscalPeriodId: periodId,
            reversesVoucherId: original.id,
            totalDebitMinor: original.totalCreditMinor,
            totalCreditMinor: original.totalDebitMinor,
            postedAt: new Date(),
            postedById: request.currentUser?.id ?? null,
            lines: {
              create: original.lines.map((l) => ({
                organizationId,
                accountId: l.accountId,
                description: l.description,
                debitMinor: l.creditMinor,
                creditMinor: l.debitMinor,
                sortOrder: l.sortOrder,
              })),
            },
          },
          include: voucherInclude,
        });
        await tx.voucher.update({ where: { id: original.id }, data: { status: 'REVERSED' } });
        await recordAudit(tx, {
          action: 'voucher.reversed',
          organizationId,
          ...auditContext(request),
          entityType: 'voucher',
          entityId: original.id,
          metadata: { reversalId: created.id, reversalNumber: number },
        });
        await enqueueOutbox(tx, 'voucher.reversed', {
          organizationId,
          voucherId: original.id,
          reversalVoucherId: created.id,
        });
        return created;
      });
      return reply.code(201).send(toVoucherDto(reversal));
    },
  });

  // --- Reconcile: flag a posted voucher as reconciled -------------------------
  r.route({
    method: 'POST',
    url: '/v1/accounting/vouchers/:voucherId/reconcile',
    preHandler: [requirePermission('accounting.manage')],
    schema: {
      tags: ['accounting'],
      params: voucherIdParamsSchema,
      body: reconcileVoucherBodySchema,
      response: { 200: voucherDtoSchema },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const existing = await app.prisma.voucher.findFirst({
        where: { id: request.params.voucherId, organizationId },
        select: { id: true, status: true },
      });
      if (!existing) throw errors.notFound('Voucher');
      if (existing.status === 'DRAFT') {
        throw errors.conflict('not_posted', 'Only posted vouchers can be reconciled');
      }
      const voucher = await app.prisma.$transaction(async (tx) => {
        const updated = await tx.voucher.update({
          where: { id: existing.id },
          data: { reconciledAt: request.body.reconciled ? new Date() : null },
          include: voucherInclude,
        });
        await recordAudit(tx, {
          action: request.body.reconciled ? 'voucher.reconciled' : 'voucher.unreconciled',
          organizationId,
          ...auditContext(request),
          entityType: 'voucher',
          entityId: existing.id,
          metadata: {},
        });
        return updated;
      });
      return reply.send(toVoucherDto(voucher));
    },
  });
}
