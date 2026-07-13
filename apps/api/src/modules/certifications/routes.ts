import {
  certificationDtoSchema,
  certificationIdParamsSchema,
  createCertificationBodySchema,
  employeeIdParamsSchema,
  expiringCertificationDtoSchema,
  expiringCertificationsQuerySchema,
  updateCertificationBodySchema,
} from '@businessos/types';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { errors } from '../../lib/errors.js';
import { toCertificationDto } from '../../lib/mappers-personnel.js';
import { orgContext, requirePermission } from '../../plugins/auth.js';
import { auditContext, recordAudit } from '../audit/service.js';
import { recordActivity } from '../activity/service.js';

async function assertEmployee(app: FastifyInstance, organizationId: string, employeeId: string) {
  const employee = await app.prisma.employee.findFirst({
    where: { id: employeeId, organizationId },
    select: { id: true },
  });
  if (!employee) throw errors.notFound('Employee');
}

function toDate(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined;
  return value ? new Date(value) : null;
}

export function registerCertificationRoutes(app: FastifyInstance): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.route({
    method: 'GET',
    url: '/v1/employees/:employeeId/certifications',
    preHandler: [requirePermission('personnel.read')],
    schema: {
      tags: ['certifications'],
      params: employeeIdParamsSchema,
      response: { 200: z.array(certificationDtoSchema) },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      await assertEmployee(app, organizationId, request.params.employeeId);
      const certs = await app.prisma.certification.findMany({
        where: { organizationId, employeeId: request.params.employeeId },
        orderBy: [{ expiresAt: { sort: 'asc', nulls: 'last' } }, { name: 'asc' }],
      });
      return reply.send(certs.map(toCertificationDto));
    },
  });

  r.route({
    method: 'POST',
    url: '/v1/employees/:employeeId/certifications',
    preHandler: [requirePermission('personnel.manage')],
    schema: {
      tags: ['certifications'],
      params: employeeIdParamsSchema,
      body: createCertificationBodySchema,
      response: { 201: certificationDtoSchema },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      await assertEmployee(app, organizationId, request.params.employeeId);
      const body = request.body;
      const cert = await app.prisma.$transaction(async (tx) => {
        const created = await tx.certification.create({
          data: {
            organizationId,
            employeeId: request.params.employeeId,
            name: body.name,
            issuer: body.issuer ?? null,
            issuedDate: toDate(body.issuedDate) ?? null,
            expiresAt: toDate(body.expiresAt) ?? null,
            notes: body.notes ?? null,
          },
        });
        await recordAudit(tx, {
          action: 'certification.created',
          organizationId,
          ...auditContext(request),
          entityType: 'certification',
          entityId: created.id,
          metadata: { employeeId: request.params.employeeId, name: created.name },
        });
        await recordActivity(tx, {
          organizationId,
          actorUserId: request.currentUser?.id ?? null,
          type: 'certification.added',
          ref: { employeeId: request.params.employeeId },
          metadata: { name: created.name },
        });
        return created;
      });
      return reply.code(201).send(toCertificationDto(cert));
    },
  });

  r.route({
    method: 'PATCH',
    url: '/v1/employees/:employeeId/certifications/:certificationId',
    preHandler: [requirePermission('personnel.manage')],
    schema: {
      tags: ['certifications'],
      params: certificationIdParamsSchema,
      body: updateCertificationBodySchema,
      response: { 200: certificationDtoSchema },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const existing = await app.prisma.certification.findFirst({
        where: {
          id: request.params.certificationId,
          organizationId,
          employeeId: request.params.employeeId,
        },
      });
      if (!existing) throw errors.notFound('Certification');
      const body = request.body;
      const updated = await app.prisma.$transaction(async (tx) => {
        const result = await tx.certification.update({
          where: { id: existing.id },
          data: {
            ...(body.name !== undefined ? { name: body.name } : {}),
            ...(body.issuer !== undefined ? { issuer: body.issuer } : {}),
            ...(body.issuedDate !== undefined ? { issuedDate: toDate(body.issuedDate) } : {}),
            ...(body.expiresAt !== undefined ? { expiresAt: toDate(body.expiresAt) } : {}),
            ...(body.notes !== undefined ? { notes: body.notes } : {}),
          },
        });
        await recordAudit(tx, {
          action: 'certification.updated',
          organizationId,
          ...auditContext(request),
          entityType: 'certification',
          entityId: existing.id,
          metadata: { fields: Object.keys(body) },
        });
        return result;
      });
      return reply.send(toCertificationDto(updated));
    },
  });

  r.route({
    method: 'DELETE',
    url: '/v1/employees/:employeeId/certifications/:certificationId',
    preHandler: [requirePermission('personnel.manage')],
    schema: { tags: ['certifications'], params: certificationIdParamsSchema },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const existing = await app.prisma.certification.findFirst({
        where: {
          id: request.params.certificationId,
          organizationId,
          employeeId: request.params.employeeId,
        },
      });
      if (!existing) throw errors.notFound('Certification');
      await app.prisma.$transaction(async (tx) => {
        await tx.certification.delete({ where: { id: existing.id } });
        await recordAudit(tx, {
          action: 'certification.deleted',
          organizationId,
          ...auditContext(request),
          entityType: 'certification',
          entityId: existing.id,
        });
      });
      return reply.code(204).send();
    },
  });

  // Dashboard: certifications expiring within N days (or already expired).
  r.route({
    method: 'GET',
    url: '/v1/certifications/expiring',
    preHandler: [requirePermission('personnel.read')],
    schema: {
      tags: ['certifications'],
      querystring: expiringCertificationsQuerySchema,
      response: { 200: z.array(expiringCertificationDtoSchema) },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const cutoff = new Date();
      cutoff.setUTCDate(cutoff.getUTCDate() + request.query.withinDays);
      const certs = await app.prisma.certification.findMany({
        where: { organizationId, expiresAt: { not: null, lte: cutoff } },
        include: { employee: { select: { id: true, firstName: true, lastName: true } } },
        orderBy: { expiresAt: 'asc' },
        take: 100,
      });
      return reply.send(
        certs.map((cert) => ({
          ...toCertificationDto(cert),
          employee: {
            id: cert.employee.id,
            name: `${cert.employee.firstName} ${cert.employee.lastName}`.trim(),
          },
        })),
      );
    },
  });
}
