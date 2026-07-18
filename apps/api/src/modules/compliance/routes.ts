import {
  attachmentDownloadDtoSchema,
  dataExportJobDtoSchema,
  dataExportJobIdParamsSchema,
  eraseOrganizationBodySchema,
  eraseOrganizationResultSchema,
  retentionPolicyDtoSchema,
  updateRetentionPolicyBodySchema,
} from '@businessos/types';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { errors } from '../../lib/errors.js';
import { orgContext, requirePermission } from '../../plugins/auth.js';
import { auditContext, recordAudit } from '../audit/service.js';
import { enqueueOutbox } from '../outbox/service.js';
import { collectOrgStorageKeys, toDataExportJobDto, toRetentionPolicyDto } from './service.js';

export function registerComplianceRoutes(app: FastifyInstance): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // --- Request a data-portability export -------------------------------------
  r.route({
    method: 'POST',
    url: '/v1/organization/export',
    preHandler: [requirePermission('org.update')],
    schema: { tags: ['compliance'], response: { 202: dataExportJobDtoSchema } },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const job = await app.prisma.$transaction(async (tx) => {
        const created = await tx.dataExportJob.create({
          data: { organizationId, requestedById: request.currentUser?.id ?? null, status: 'PENDING' },
        });
        await recordAudit(tx, {
          action: 'organization.export_requested',
          organizationId,
          ...auditContext(request),
          entityType: 'data_export_job',
          entityId: created.id,
        });
        await enqueueOutbox(tx, 'organization.export_requested', {
          organizationId,
          jobId: created.id,
        });
        return created;
      });
      return reply.code(202).send(toDataExportJobDto(job));
    },
  });

  // --- List / get export jobs ------------------------------------------------
  r.route({
    method: 'GET',
    url: '/v1/organization/exports',
    preHandler: [requirePermission('org.update')],
    schema: { tags: ['compliance'], response: { 200: z.array(dataExportJobDtoSchema) } },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const rows = await app.prisma.dataExportJob.findMany({
        where: { organizationId },
        orderBy: { createdAt: 'desc' },
        take: 20,
      });
      return reply.send(rows.map(toDataExportJobDto));
    },
  });

  r.route({
    method: 'GET',
    url: '/v1/organization/exports/:jobId',
    preHandler: [requirePermission('org.update')],
    schema: {
      tags: ['compliance'],
      params: dataExportJobIdParamsSchema,
      response: { 200: dataExportJobDtoSchema },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const job = await app.prisma.dataExportJob.findFirst({
        where: { id: request.params.jobId, organizationId },
      });
      if (!job) throw errors.notFound('Export job');
      return reply.send(toDataExportJobDto(job));
    },
  });

  // --- Download a completed export -------------------------------------------
  r.route({
    method: 'GET',
    url: '/v1/organization/exports/:jobId/download',
    preHandler: [requirePermission('org.update')],
    schema: {
      tags: ['compliance'],
      params: dataExportJobIdParamsSchema,
      response: { 200: attachmentDownloadDtoSchema },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const job = await app.prisma.dataExportJob.findFirst({
        where: { id: request.params.jobId, organizationId },
      });
      if (!job) throw errors.notFound('Export job');
      if (job.status !== 'COMPLETED' || !job.storageKey) {
        throw errors.badRequest('export_not_ready', 'This export is not ready to download');
      }
      if (job.expiresAt && job.expiresAt.getTime() < Date.now()) {
        throw errors.badRequest('export_expired', 'This export has expired; request a new one');
      }
      const signed = await app.storage.getDownloadUrl(
        job.storageKey,
        `businessos-export-${job.id}.json`,
      );
      await recordAudit(app.prisma, {
        action: 'organization.export_downloaded',
        organizationId,
        ...auditContext(request),
        entityType: 'data_export_job',
        entityId: job.id,
      });
      return reply.send(signed);
    },
  });

  // --- Retention policy ------------------------------------------------------
  r.route({
    method: 'GET',
    url: '/v1/organization/retention',
    preHandler: [requirePermission('org.read')],
    schema: { tags: ['compliance'], response: { 200: retentionPolicyDtoSchema } },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const policy = await app.prisma.retentionPolicy.findUnique({ where: { organizationId } });
      return reply.send(toRetentionPolicyDto(policy));
    },
  });

  r.route({
    method: 'PUT',
    url: '/v1/organization/retention',
    preHandler: [requirePermission('org.update')],
    schema: {
      tags: ['compliance'],
      body: updateRetentionPolicyBodySchema,
      response: { 200: retentionPolicyDtoSchema },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const body = request.body;
      const policy = await app.prisma.$transaction(async (tx) => {
        const upserted = await tx.retentionPolicy.upsert({
          where: { organizationId },
          create: { organizationId, ...body },
          update: { ...body },
        });
        await recordAudit(tx, {
          action: 'retention_policy.updated',
          organizationId,
          ...auditContext(request),
          entityType: 'retention_policy',
          entityId: organizationId,
          metadata: { ...body },
        });
        return upserted;
      });
      return reply.send(toRetentionPolicyDto(policy));
    },
  });

  // --- Erase the organization (GDPR right-to-be-forgotten) -------------------
  r.route({
    method: 'DELETE',
    url: '/v1/organization',
    // org.delete is OWNER-only in the permission matrix.
    preHandler: [requirePermission('org.delete')],
    schema: {
      tags: ['compliance'],
      body: eraseOrganizationBodySchema,
      response: { 200: eraseOrganizationResultSchema },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const org = await app.prisma.organization.findUnique({
        where: { id: organizationId },
        select: { id: true, slug: true },
      });
      if (!org) throw errors.notFound('Organization');
      if (request.body.confirmSlug !== org.slug) {
        throw errors.badRequest(
          'confirmation_mismatch',
          'The confirmation does not match the organization slug',
        );
      }

      // Gather storage keys BEFORE the cascade delete removes their rows.
      const storageKeys = await collectOrgStorageKeys(app.prisma, org.id);

      // Deleting the org cascades to every org-scoped table (all 33 FKs are
      // onDelete: Cascade). GDPR erasure = complete removal, so the org's own
      // audit log goes with it; we record the erasure operationally in the app
      // log instead (org id + actor, no personal data).
      await app.prisma.organization.delete({ where: { id: org.id } });
      request.log.warn(
        { organizationId: org.id, slug: org.slug, actorUserId: request.currentUser?.id },
        'organization erased (GDPR)',
      );

      // Best-effort object purge; storage failures don't undo the DB erasure.
      await Promise.all(
        storageKeys.map((key) =>
          app.storage.delete(key).catch((err) => {
            request.log.warn({ err, key }, 'failed to purge storage object during erasure');
          }),
        ),
      );

      return reply.send({ erasedOrganizationId: org.id, slug: org.slug });
    },
  });
}
