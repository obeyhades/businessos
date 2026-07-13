import {
  ALLOWED_ATTACHMENT_TYPES,
  attachmentDownloadDtoSchema,
  employeeDocumentCategorySchema,
  employeeDocumentDtoSchema,
  employeeDocumentIdParamsSchema,
  employeeIdParamsSchema,
  hasPermission,
  MAX_ATTACHMENT_BYTES,
  type OrganizationRole,
} from '@businessos/types';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { errors } from '../../lib/errors.js';
import { toEmployeeDocumentDto } from '../../lib/mappers-personnel.js';
import { orgContext, requirePermission } from '../../plugins/auth.js';
import { auditContext, recordAudit } from '../audit/service.js';
import { recordActivity } from '../activity/service.js';

const ALLOWED = new Set<string>(ALLOWED_ATTACHMENT_TYPES);
const uploadQuerySchema = z.object({
  category: employeeDocumentCategorySchema.default('OTHER'),
  sensitive: z.coerce.boolean().default(false),
});

function canReadSensitive(request: FastifyRequest): boolean {
  const role = request.membership?.role;
  return role ? hasPermission(role as OrganizationRole, 'personnel.read_sensitive') : false;
}

async function assertEmployee(app: FastifyInstance, organizationId: string, employeeId: string) {
  const employee = await app.prisma.employee.findFirst({
    where: { id: employeeId, organizationId },
    select: { id: true },
  });
  if (!employee) throw errors.notFound('Employee');
}

export function registerEmployeeDocumentRoutes(app: FastifyInstance): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.route({
    method: 'GET',
    url: '/v1/employees/:employeeId/documents',
    preHandler: [requirePermission('personnel.read')],
    schema: {
      tags: ['employee-documents'],
      params: employeeIdParamsSchema,
      response: { 200: z.array(employeeDocumentDtoSchema) },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      await assertEmployee(app, organizationId, request.params.employeeId);
      const docs = await app.prisma.employeeDocument.findMany({
        where: {
          organizationId,
          employeeId: request.params.employeeId,
          // Sensitive documents are hidden from directory-only viewers.
          ...(canReadSensitive(request) ? {} : { isSensitive: false }),
        },
        include: { uploadedBy: true },
        orderBy: { createdAt: 'desc' },
      });
      return reply.send(docs.map(toEmployeeDocumentDto));
    },
  });

  r.route({
    method: 'POST',
    url: '/v1/employees/:employeeId/documents',
    preHandler: [requirePermission('personnel.manage')],
    schema: {
      tags: ['employee-documents'],
      params: employeeIdParamsSchema,
      querystring: uploadQuerySchema,
      response: { 201: employeeDocumentDtoSchema },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      await assertEmployee(app, organizationId, request.params.employeeId);
      // Marking a document sensitive requires sensitive-level access.
      if (request.query.sensitive && !canReadSensitive(request)) {
        throw errors.forbidden('You do not have permission to store sensitive documents');
      }

      const file = await request.file();
      if (!file) throw errors.badRequest('no_file', 'No file was uploaded');
      if (!ALLOWED.has(file.mimetype)) {
        throw errors.badRequest('unsupported_type', `File type ${file.mimetype} is not allowed`);
      }
      const buffer = await file.toBuffer();
      if (file.file.truncated || buffer.byteLength > MAX_ATTACHMENT_BYTES) {
        throw errors.badRequest('file_too_large', 'File exceeds the maximum allowed size');
      }

      const key = app.storage.buildKey(organizationId, file.filename);
      await app.storage.put(key, buffer, file.mimetype);
      try {
        const doc = await app.prisma.$transaction(async (tx) => {
          const created = await tx.employeeDocument.create({
            data: {
              organizationId,
              employeeId: request.params.employeeId,
              uploadedById: request.currentUser?.id ?? null,
              fileName: file.filename.slice(0, 255),
              contentType: file.mimetype,
              size: buffer.byteLength,
              storageKey: key,
              category: request.query.category,
              isSensitive: request.query.sensitive,
            },
            include: { uploadedBy: true },
          });
          await recordAudit(tx, {
            action: 'employee_document.uploaded',
            organizationId,
            ...auditContext(request),
            entityType: 'employee_document',
            entityId: created.id,
            metadata: {
              employeeId: request.params.employeeId,
              fileName: created.fileName,
              sensitive: created.isSensitive,
            },
          });
          await recordActivity(tx, {
            organizationId,
            actorUserId: request.currentUser?.id ?? null,
            type: 'document.added',
            ref: { employeeId: request.params.employeeId },
            metadata: { fileName: created.fileName },
          });
          return created;
        });
        return reply.code(201).send(toEmployeeDocumentDto(doc));
      } catch (error) {
        await app.storage.delete(key).catch(() => undefined);
        throw error;
      }
    },
  });

  r.route({
    method: 'GET',
    url: '/v1/employees/:employeeId/documents/:documentId/download-url',
    preHandler: [requirePermission('personnel.read')],
    schema: {
      tags: ['employee-documents'],
      params: employeeDocumentIdParamsSchema,
      response: { 200: attachmentDownloadDtoSchema },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const doc = await app.prisma.employeeDocument.findFirst({
        where: {
          id: request.params.documentId,
          organizationId,
          employeeId: request.params.employeeId,
        },
      });
      if (!doc) throw errors.notFound('Document');
      if (doc.isSensitive && !canReadSensitive(request)) {
        // Do not reveal that a sensitive document exists.
        throw errors.notFound('Document');
      }
      const signed = await app.storage.getDownloadUrl(doc.storageKey, doc.fileName);
      return reply.send(signed);
    },
  });

  r.route({
    method: 'DELETE',
    url: '/v1/employees/:employeeId/documents/:documentId',
    preHandler: [requirePermission('personnel.manage')],
    schema: { tags: ['employee-documents'], params: employeeDocumentIdParamsSchema },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const doc = await app.prisma.employeeDocument.findFirst({
        where: {
          id: request.params.documentId,
          organizationId,
          employeeId: request.params.employeeId,
        },
      });
      if (!doc) throw errors.notFound('Document');
      await app.prisma.$transaction(async (tx) => {
        await tx.employeeDocument.delete({ where: { id: doc.id } });
        await recordAudit(tx, {
          action: 'employee_document.deleted',
          organizationId,
          ...auditContext(request),
          entityType: 'employee_document',
          entityId: doc.id,
          metadata: { fileName: doc.fileName },
        });
      });
      await app.storage.delete(doc.storageKey).catch((err) => {
        request.log.warn({ err, key: doc.storageKey }, 'failed to delete storage object');
      });
      return reply.code(204).send();
    },
  });
}
