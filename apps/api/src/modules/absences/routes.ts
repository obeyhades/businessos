import {
  absenceIdParamsSchema,
  absenceListQuerySchema,
  absenceRequestDtoSchema,
  createAbsenceRequestBodySchema,
  employeeAbsenceParamsSchema,
  paginatedSchema,
  reviewAbsenceBodySchema,
} from '@businessos/types';
import type { Prisma } from '@businessos/db';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { errors } from '../../lib/errors.js';
import { toAbsenceRequestDto } from '../../lib/mappers-personnel.js';
import { toPaginated, toSkipTake } from '../../lib/pagination.js';
import { orgContext, requirePermission } from '../../plugins/auth.js';
import { auditContext, recordAudit } from '../audit/service.js';
import { recordActivity } from '../activity/service.js';

const absenceInclude = {
  employee: { select: { id: true, firstName: true, lastName: true } },
  reviewedBy: { select: { id: true, name: true } },
} as const;

export function registerAbsenceRoutes(app: FastifyInstance): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.route({
    method: 'GET',
    url: '/v1/absence-requests',
    preHandler: [requirePermission('personnel.read')],
    schema: {
      tags: ['absences'],
      querystring: absenceListQuerySchema,
      response: { 200: paginatedSchema(absenceRequestDtoSchema) },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const query = request.query;
      const { skip, take } = toSkipTake(query);
      const where: Prisma.AbsenceRequestWhereInput = {
        organizationId,
        ...(query.status ? { status: query.status } : {}),
        ...(query.employeeId ? { employeeId: query.employeeId } : {}),
      };
      const [rows, total] = await Promise.all([
        app.prisma.absenceRequest.findMany({
          where,
          include: absenceInclude,
          orderBy: [{ status: 'asc' }, { startDate: 'desc' }],
          skip,
          take,
        }),
        app.prisma.absenceRequest.count({ where }),
      ]);
      return reply.send(toPaginated(rows.map(toAbsenceRequestDto), total, query));
    },
  });

  r.route({
    method: 'GET',
    url: '/v1/employees/:employeeId/absence-requests',
    preHandler: [requirePermission('personnel.read')],
    schema: {
      tags: ['absences'],
      params: employeeAbsenceParamsSchema,
      response: { 200: z.array(absenceRequestDtoSchema) },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const employee = await app.prisma.employee.findFirst({
        where: { id: request.params.employeeId, organizationId },
        select: { id: true },
      });
      if (!employee) throw errors.notFound('Employee');
      const rows = await app.prisma.absenceRequest.findMany({
        where: { organizationId, employeeId: employee.id },
        include: absenceInclude,
        orderBy: { startDate: 'desc' },
      });
      return reply.send(rows.map(toAbsenceRequestDto));
    },
  });

  r.route({
    method: 'POST',
    url: '/v1/employees/:employeeId/absence-requests',
    preHandler: [requirePermission('personnel.manage')],
    schema: {
      tags: ['absences'],
      params: employeeAbsenceParamsSchema,
      body: createAbsenceRequestBodySchema,
      response: { 201: absenceRequestDtoSchema },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const employee = await app.prisma.employee.findFirst({
        where: { id: request.params.employeeId, organizationId },
        select: { id: true },
      });
      if (!employee) throw errors.notFound('Employee');
      const body = request.body;

      const absence = await app.prisma.$transaction(async (tx) => {
        const created = await tx.absenceRequest.create({
          data: {
            organizationId,
            employeeId: employee.id,
            type: body.type,
            status: 'PENDING',
            startDate: new Date(body.startDate),
            endDate: new Date(body.endDate),
            reason: body.reason ?? null,
            createdById: request.currentUser?.id ?? null,
          },
          include: absenceInclude,
        });
        await recordAudit(tx, {
          action: 'absence.requested',
          organizationId,
          ...auditContext(request),
          entityType: 'absence_request',
          entityId: created.id,
          metadata: { employeeId: employee.id, type: body.type },
        });
        await recordActivity(tx, {
          organizationId,
          actorUserId: request.currentUser?.id ?? null,
          type: 'absence.requested',
          ref: { employeeId: employee.id },
          metadata: { type: body.type },
        });
        return created;
      });
      return reply.code(201).send(toAbsenceRequestDto(absence));
    },
  });

  r.route({
    method: 'POST',
    url: '/v1/absence-requests/:absenceId/review',
    preHandler: [requirePermission('personnel.manage')],
    schema: {
      tags: ['absences'],
      params: absenceIdParamsSchema,
      body: reviewAbsenceBodySchema,
      response: { 200: absenceRequestDtoSchema },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const existing = await app.prisma.absenceRequest.findFirst({
        where: { id: request.params.absenceId, organizationId },
      });
      if (!existing) throw errors.notFound('Absence request');
      if (existing.status !== 'PENDING') {
        throw errors.conflict('not_pending', 'Only pending requests can be reviewed');
      }
      const decision = request.body.decision;

      const updated = await app.prisma.$transaction(async (tx) => {
        const result = await tx.absenceRequest.update({
          where: { id: existing.id },
          data: {
            status: decision,
            reviewedById: request.currentUser?.id ?? null,
            reviewedAt: new Date(),
            reviewNote: request.body.reviewNote ?? null,
          },
          include: absenceInclude,
        });
        await recordAudit(tx, {
          action: decision === 'APPROVED' ? 'absence.approved' : 'absence.rejected',
          organizationId,
          ...auditContext(request),
          entityType: 'absence_request',
          entityId: existing.id,
        });
        await recordActivity(tx, {
          organizationId,
          actorUserId: request.currentUser?.id ?? null,
          type: decision === 'APPROVED' ? 'absence.approved' : 'absence.rejected',
          ref: { employeeId: existing.employeeId },
        });
        return result;
      });
      return reply.send(toAbsenceRequestDto(updated));
    },
  });

  r.route({
    method: 'POST',
    url: '/v1/absence-requests/:absenceId/cancel',
    preHandler: [requirePermission('personnel.manage')],
    schema: {
      tags: ['absences'],
      params: absenceIdParamsSchema,
      response: { 200: absenceRequestDtoSchema },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const existing = await app.prisma.absenceRequest.findFirst({
        where: { id: request.params.absenceId, organizationId },
      });
      if (!existing) throw errors.notFound('Absence request');
      if (existing.status === 'CANCELLED') {
        throw errors.conflict('already_cancelled', 'This request is already cancelled');
      }
      const updated = await app.prisma.$transaction(async (tx) => {
        const result = await tx.absenceRequest.update({
          where: { id: existing.id },
          data: { status: 'CANCELLED' },
          include: absenceInclude,
        });
        await recordAudit(tx, {
          action: 'absence.cancelled',
          organizationId,
          ...auditContext(request),
          entityType: 'absence_request',
          entityId: existing.id,
        });
        return result;
      });
      return reply.send(toAbsenceRequestDto(updated));
    },
  });
}
