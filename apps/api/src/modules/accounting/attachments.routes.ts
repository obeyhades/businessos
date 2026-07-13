import {
  ALLOWED_ATTACHMENT_TYPES,
  attachmentDownloadDtoSchema,
  MAX_ATTACHMENT_BYTES,
  voucherAttachmentDtoSchema,
  voucherAttachmentIdParamsSchema,
  voucherIdParamsSchema,
} from '@businessos/types';
import type { VoucherAttachment } from '@businessos/db';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { errors } from '../../lib/errors.js';
import { orgContext, requirePermission } from '../../plugins/auth.js';
import { auditContext, recordAudit } from '../audit/service.js';

const ALLOWED = new Set<string>(ALLOWED_ATTACHMENT_TYPES);

function toDto(a: VoucherAttachment & { uploadedBy: { name: string } | null }) {
  return {
    id: a.id,
    voucherId: a.voucherId,
    fileName: a.fileName,
    contentType: a.contentType,
    size: a.size,
    uploadedByName: a.uploadedBy?.name ?? null,
    createdAt: a.createdAt.toISOString(),
  };
}

async function assertVoucher(app: FastifyInstance, organizationId: string, voucherId: string) {
  const voucher = await app.prisma.voucher.findFirst({
    where: { id: voucherId, organizationId },
    select: { id: true },
  });
  if (!voucher) throw errors.notFound('Voucher');
}

export function registerVoucherAttachmentRoutes(app: FastifyInstance): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.route({
    method: 'GET',
    url: '/v1/accounting/vouchers/:voucherId/attachments',
    preHandler: [requirePermission('accounting.read')],
    schema: {
      tags: ['accounting'],
      params: voucherIdParamsSchema,
      response: { 200: z.array(voucherAttachmentDtoSchema) },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      await assertVoucher(app, organizationId, request.params.voucherId);
      const rows = await app.prisma.voucherAttachment.findMany({
        where: { organizationId, voucherId: request.params.voucherId },
        include: { uploadedBy: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
      });
      return reply.send(rows.map(toDto));
    },
  });

  r.route({
    method: 'POST',
    url: '/v1/accounting/vouchers/:voucherId/attachments',
    preHandler: [requirePermission('accounting.manage')],
    schema: {
      tags: ['accounting'],
      params: voucherIdParamsSchema,
      response: { 201: voucherAttachmentDtoSchema },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      await assertVoucher(app, organizationId, request.params.voucherId);

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
        const attachment = await app.prisma.$transaction(async (tx) => {
          const created = await tx.voucherAttachment.create({
            data: {
              organizationId,
              voucherId: request.params.voucherId,
              uploadedById: request.currentUser?.id ?? null,
              fileName: file.filename.slice(0, 255),
              contentType: file.mimetype,
              size: buffer.byteLength,
              storageKey: key,
            },
            include: { uploadedBy: { select: { name: true } } },
          });
          await recordAudit(tx, {
            action: 'voucher_attachment.uploaded',
            organizationId,
            ...auditContext(request),
            entityType: 'voucher_attachment',
            entityId: created.id,
            metadata: { voucherId: request.params.voucherId, fileName: created.fileName },
          });
          return created;
        });
        return reply.code(201).send(toDto(attachment));
      } catch (error) {
        await app.storage.delete(key).catch(() => undefined);
        throw error;
      }
    },
  });

  r.route({
    method: 'GET',
    url: '/v1/accounting/vouchers/:voucherId/attachments/:attachmentId/download-url',
    preHandler: [requirePermission('accounting.read')],
    schema: {
      tags: ['accounting'],
      params: voucherAttachmentIdParamsSchema,
      response: { 200: attachmentDownloadDtoSchema },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const attachment = await app.prisma.voucherAttachment.findFirst({
        where: {
          id: request.params.attachmentId,
          organizationId,
          voucherId: request.params.voucherId,
        },
      });
      if (!attachment) throw errors.notFound('Attachment');
      const signed = await app.storage.getDownloadUrl(attachment.storageKey, attachment.fileName);
      return reply.send(signed);
    },
  });

  r.route({
    method: 'DELETE',
    url: '/v1/accounting/vouchers/:voucherId/attachments/:attachmentId',
    preHandler: [requirePermission('accounting.manage')],
    schema: { tags: ['accounting'], params: voucherAttachmentIdParamsSchema },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const attachment = await app.prisma.voucherAttachment.findFirst({
        where: {
          id: request.params.attachmentId,
          organizationId,
          voucherId: request.params.voucherId,
        },
      });
      if (!attachment) throw errors.notFound('Attachment');
      await app.prisma.$transaction(async (tx) => {
        await tx.voucherAttachment.delete({ where: { id: attachment.id } });
        await recordAudit(tx, {
          action: 'voucher_attachment.deleted',
          organizationId,
          ...auditContext(request),
          entityType: 'voucher_attachment',
          entityId: attachment.id,
          metadata: { fileName: attachment.fileName },
        });
      });
      await app.storage.delete(attachment.storageKey).catch((err) => {
        request.log.warn({ err, key: attachment.storageKey }, 'failed to delete storage object');
      });
      return reply.code(204).send();
    },
  });
}
