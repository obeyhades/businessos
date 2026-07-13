import {
  createFiscalPeriodBodySchema,
  createFiscalYearBodySchema,
  fiscalPeriodDtoSchema,
  fiscalPeriodIdParamsSchema,
  fiscalYearDtoSchema,
  fiscalYearIdParamsSchema,
  updateFiscalPeriodStatusBodySchema,
} from '@businessos/types';
import type { AuditAction } from '@businessos/types';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { errors } from '../../lib/errors.js';
import { orgContext, requirePermission } from '../../plugins/auth.js';
import { auditContext, recordAudit } from '../audit/service.js';
import { toFiscalPeriodDto, toFiscalYearDto } from './mappers.js';
import { parseIsoDate } from './service.js';

/** Generates non-overlapping monthly periods spanning [start, end] inclusive. */
function monthlyPeriods(startIso: string, endIso: string): Array<{
  name: string;
  startDate: Date;
  endDate: Date;
}> {
  const start = parseIsoDate(startIso);
  const end = parseIsoDate(endIso);
  const periods: Array<{ name: string; startDate: Date; endDate: Date }> = [];
  let cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  while (cursor <= end) {
    const y = cursor.getUTCFullYear();
    const m = cursor.getUTCMonth();
    const monthStart = new Date(Date.UTC(y, m, 1));
    const monthEnd = new Date(Date.UTC(y, m + 1, 0)); // day 0 of next month = last day
    periods.push({
      name: `${y}-${String(m + 1).padStart(2, '0')}`,
      startDate: monthStart < start ? start : monthStart,
      endDate: monthEnd > end ? end : monthEnd,
    });
    cursor = new Date(Date.UTC(y, m + 1, 1));
  }
  return periods;
}

const STATUS_AUDIT: Record<string, AuditAction> = {
  LOCKED: 'fiscal_period.locked',
  OPEN: 'fiscal_period.unlocked',
  CLOSED: 'fiscal_period.closed',
};

export function registerFiscalRoutes(app: FastifyInstance): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.route({
    method: 'GET',
    url: '/v1/accounting/fiscal-years',
    preHandler: [requirePermission('accounting.read')],
    schema: { tags: ['accounting'], response: { 200: z.array(fiscalYearDtoSchema) } },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const years = await app.prisma.fiscalYear.findMany({
        where: { organizationId },
        include: { periods: { orderBy: { startDate: 'asc' } } },
        orderBy: { startDate: 'desc' },
      });
      return reply.send(years.map(toFiscalYearDto));
    },
  });

  r.route({
    method: 'POST',
    url: '/v1/accounting/fiscal-years',
    preHandler: [requirePermission('accounting.manage')],
    schema: {
      tags: ['accounting'],
      body: createFiscalYearBodySchema,
      response: { 201: fiscalYearDtoSchema },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const body = request.body;
      const periods = body.generateMonthlyPeriods
        ? monthlyPeriods(body.startDate, body.endDate)
        : [];
      const year = await app.prisma.$transaction(async (tx) => {
        const created = await tx.fiscalYear.create({
          data: {
            organizationId,
            name: body.name,
            startDate: parseIsoDate(body.startDate),
            endDate: parseIsoDate(body.endDate),
            periods: {
              create: periods.map((p) => ({
                organizationId,
                name: p.name,
                startDate: p.startDate,
                endDate: p.endDate,
              })),
            },
          },
          include: { periods: { orderBy: { startDate: 'asc' } } },
        });
        await recordAudit(tx, {
          action: 'fiscal_year.created',
          organizationId,
          ...auditContext(request),
          entityType: 'fiscal_year',
          entityId: created.id,
          metadata: { name: created.name, periods: periods.length },
        });
        return created;
      });
      return reply.code(201).send(toFiscalYearDto(year));
    },
  });

  r.route({
    method: 'GET',
    url: '/v1/accounting/fiscal-years/:fiscalYearId',
    preHandler: [requirePermission('accounting.read')],
    schema: {
      tags: ['accounting'],
      params: fiscalYearIdParamsSchema,
      response: { 200: fiscalYearDtoSchema },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const year = await app.prisma.fiscalYear.findFirst({
        where: { id: request.params.fiscalYearId, organizationId },
        include: { periods: { orderBy: { startDate: 'asc' } } },
      });
      if (!year) throw errors.notFound('Fiscal year');
      return reply.send(toFiscalYearDto(year));
    },
  });

  r.route({
    method: 'POST',
    url: '/v1/accounting/fiscal-years/:fiscalYearId/periods',
    preHandler: [requirePermission('accounting.manage')],
    schema: {
      tags: ['accounting'],
      params: fiscalYearIdParamsSchema,
      body: createFiscalPeriodBodySchema,
      response: { 201: fiscalPeriodDtoSchema },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const year = await app.prisma.fiscalYear.findFirst({
        where: { id: request.params.fiscalYearId, organizationId },
      });
      if (!year) throw errors.notFound('Fiscal year');
      const startDate = parseIsoDate(request.body.startDate);
      const endDate = parseIsoDate(request.body.endDate);
      // Periods must not overlap, or a voucher date could resolve to two of them.
      const overlap = await app.prisma.fiscalPeriod.findFirst({
        where: {
          organizationId,
          startDate: { lte: endDate },
          endDate: { gte: startDate },
        },
        select: { id: true },
      });
      if (overlap) {
        throw errors.conflict('period_overlap', 'The period overlaps an existing fiscal period');
      }
      const period = await app.prisma.$transaction(async (tx) => {
        const created = await tx.fiscalPeriod.create({
          data: {
            organizationId,
            fiscalYearId: year.id,
            name: request.body.name,
            startDate,
            endDate,
          },
        });
        await recordAudit(tx, {
          action: 'fiscal_period.created',
          organizationId,
          ...auditContext(request),
          entityType: 'fiscal_period',
          entityId: created.id,
          metadata: { name: created.name },
        });
        return created;
      });
      return reply.code(201).send(toFiscalPeriodDto(period));
    },
  });

  r.route({
    method: 'PATCH',
    url: '/v1/accounting/periods/:periodId/status',
    preHandler: [requirePermission('accounting.manage')],
    schema: {
      tags: ['accounting'],
      params: fiscalPeriodIdParamsSchema,
      body: updateFiscalPeriodStatusBodySchema,
      response: { 200: fiscalPeriodDtoSchema },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const existing = await app.prisma.fiscalPeriod.findFirst({
        where: { id: request.params.periodId, organizationId },
      });
      if (!existing) throw errors.notFound('Fiscal period');
      const { status } = request.body;
      const period = await app.prisma.$transaction(async (tx) => {
        const result = await tx.fiscalPeriod.update({
          where: { id: existing.id },
          data: { status },
        });
        await recordAudit(tx, {
          action: STATUS_AUDIT[status] ?? 'fiscal_period.created',
          organizationId,
          ...auditContext(request),
          entityType: 'fiscal_period',
          entityId: existing.id,
          metadata: { from: existing.status, to: status },
        });
        return result;
      });
      return reply.send(toFiscalPeriodDto(period));
    },
  });
}
