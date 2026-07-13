import {
  ALLOWED_ATTACHMENT_TYPES,
  attachmentDownloadDtoSchema,
  attachmentDtoSchema,
  MAX_ATTACHMENT_BYTES,
  uuidSchema,
  type EntityKind,
} from '@businessos/types';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { errors } from '../../lib/errors.js';
import { toAttachmentDto } from '../../lib/mappers-domain.js';
import { orgContext, requirePermission } from '../../plugins/auth.js';
import { auditContext, recordAudit } from '../audit/service.js';
import { recordActivity, resolveEntityRef } from '../activity/service.js';

interface KindConfig {
  kind: EntityKind;
  path: 'customers' | 'projects' | 'tasks';
  read: 'customers.read' | 'projects.read' | 'tasks.read';
  manage: 'customers.manage' | 'projects.manage' | 'tasks.manage';
  fk: 'customerId' | 'projectId' | 'taskId';
}

const KINDS: KindConfig[] = [
  {
    kind: 'customer',
    path: 'customers',
    read: 'customers.read',
    manage: 'customers.manage',
    fk: 'customerId',
  },
  {
    kind: 'project',
    path: 'projects',
    read: 'projects.read',
    manage: 'projects.manage',
    fk: 'projectId',
  },
  { kind: 'task', path: 'tasks', read: 'tasks.read', manage: 'tasks.manage', fk: 'taskId' },
];

const parentParams = z.object({ entityId: uuidSchema });
const attachmentParams = z.object({ entityId: uuidSchema, attachmentId: uuidSchema });

const ALLOWED = new Set<string>(ALLOWED_ATTACHMENT_TYPES);

export function registerAttachmentRoutes(app: FastifyInstance): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  for (const cfg of KINDS) {
    r.route({
      method: 'GET',
      url: `/v1/${cfg.path}/:entityId/attachments`,
      preHandler: [requirePermission(cfg.read)],
      schema: {
        tags: ['attachments'],
        params: parentParams,
        response: { 200: z.array(attachmentDtoSchema) },
      },
      handler: async (request, reply) => {
        const { organizationId } = orgContext(request);
        await resolveEntityRef(app.prisma, organizationId, cfg.kind, request.params.entityId);
        const rows = await app.prisma.fileAttachment.findMany({
          where: { organizationId, [cfg.fk]: request.params.entityId },
          include: { uploadedBy: true },
          orderBy: { createdAt: 'desc' },
        });
        return reply.send(rows.map(toAttachmentDto));
      },
    });

    // Multipart upload streamed through the API. Size and content type are
    // validated server-side; the client-declared size is never trusted.
    r.route({
      method: 'POST',
      url: `/v1/${cfg.path}/:entityId/attachments`,
      preHandler: [requirePermission(cfg.manage)],
      schema: {
        tags: ['attachments'],
        params: parentParams,
        response: { 201: attachmentDtoSchema },
      },
      handler: async (request, reply) => {
        const { organizationId } = orgContext(request);
        const ref = await resolveEntityRef(
          app.prisma,
          organizationId,
          cfg.kind,
          request.params.entityId,
        );

        const file = await request.file();
        if (!file) throw errors.badRequest('no_file', 'No file was uploaded');
        if (!ALLOWED.has(file.mimetype)) {
          throw errors.badRequest('unsupported_type', `File type ${file.mimetype} is not allowed`);
        }

        const buffer = await file.toBuffer();
        // @fastify/multipart flags truncation when the byte limit is exceeded.
        if (file.file.truncated || buffer.byteLength > MAX_ATTACHMENT_BYTES) {
          throw errors.badRequest('file_too_large', 'File exceeds the maximum allowed size');
        }

        const key = app.storage.buildKey(organizationId, file.filename);
        await app.storage.put(key, buffer, file.mimetype);

        try {
          const attachment = await app.prisma.$transaction(async (tx) => {
            const created = await tx.fileAttachment.create({
              data: {
                organizationId,
                uploadedById: request.currentUser?.id ?? null,
                fileName: file.filename.slice(0, 255),
                contentType: file.mimetype,
                size: buffer.byteLength,
                storageKey: key,
                [cfg.fk]: request.params.entityId,
              },
              include: { uploadedBy: true },
            });
            await recordAudit(tx, {
              action: 'attachment.uploaded',
              organizationId,
              ...auditContext(request),
              entityType: `${cfg.kind}_attachment`,
              entityId: created.id,
              metadata: { fileName: created.fileName, size: created.size },
            });
            await recordActivity(tx, {
              organizationId,
              actorUserId: request.currentUser?.id ?? null,
              type: 'attachment.added',
              ref,
              metadata: { fileName: created.fileName },
            });
            return created;
          });
          return reply.code(201).send(toAttachmentDto(attachment));
        } catch (error) {
          // Roll back the stored object if the metadata write failed.
          await app.storage.delete(key).catch(() => undefined);
          throw error;
        }
      },
    });

    r.route({
      method: 'GET',
      url: `/v1/${cfg.path}/:entityId/attachments/:attachmentId/download-url`,
      preHandler: [requirePermission(cfg.read)],
      schema: {
        tags: ['attachments'],
        params: attachmentParams,
        response: { 200: attachmentDownloadDtoSchema },
      },
      handler: async (request, reply) => {
        const { organizationId } = orgContext(request);
        const attachment = await app.prisma.fileAttachment.findFirst({
          where: {
            id: request.params.attachmentId,
            organizationId,
            [cfg.fk]: request.params.entityId,
          },
        });
        if (!attachment) throw errors.notFound('Attachment');
        const signed = await app.storage.getDownloadUrl(attachment.storageKey, attachment.fileName);
        return reply.send(signed);
      },
    });

    r.route({
      method: 'DELETE',
      url: `/v1/${cfg.path}/:entityId/attachments/:attachmentId`,
      preHandler: [requirePermission(cfg.manage)],
      schema: { tags: ['attachments'], params: attachmentParams },
      handler: async (request, reply) => {
        const { organizationId } = orgContext(request);
        const attachment = await app.prisma.fileAttachment.findFirst({
          where: {
            id: request.params.attachmentId,
            organizationId,
            [cfg.fk]: request.params.entityId,
          },
        });
        if (!attachment) throw errors.notFound('Attachment');

        await app.prisma.$transaction(async (tx) => {
          await tx.fileAttachment.delete({ where: { id: attachment.id } });
          await recordAudit(tx, {
            action: 'attachment.deleted',
            organizationId,
            ...auditContext(request),
            entityType: `${cfg.kind}_attachment`,
            entityId: attachment.id,
            metadata: { fileName: attachment.fileName },
          });
        });
        // Best-effort object cleanup after the row is gone.
        await app.storage.delete(attachment.storageKey).catch((err) => {
          request.log.warn({ err, key: attachment.storageKey }, 'failed to delete storage object');
        });
        return reply.code(204).send();
      },
    });
  }
}
