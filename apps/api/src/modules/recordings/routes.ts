import {
  ALLOWED_AUDIO_TYPES,
  MAX_AUDIO_BYTES,
  attachmentDownloadDtoSchema,
  createCallLogBodySchema,
  invoiceDtoSchema,
  paginatedSchema,
  recordingDtoSchema,
  recordingIdParamsSchema,
  recordingListQuerySchema,
  recordingToInvoiceBodySchema,
  recordingToTaskBodySchema,
  taskDtoSchema,
  updateRecordingBodySchema,
  uploadVoiceNoteQuerySchema,
} from '@businessos/types';
import type { Prisma } from '@businessos/db';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { errors } from '../../lib/errors.js';
import { toInvoiceDto } from '../../lib/mappers-billing.js';
import { toTaskDto } from '../../lib/mappers-domain.js';
import { orgContext, requirePermission } from '../../plugins/auth.js';
import { auditContext, recordAudit } from '../audit/service.js';
import { recordActivity } from '../activity/service.js';
import { buildDocument } from '../billing/lines.js';
import { enqueueOutbox } from '../outbox/service.js';
import { toRecordingDto } from './mappers.js';
import { assertLinks, transcriptSnippet } from './service.js';

const ALLOWED = new Set<string>(ALLOWED_AUDIO_TYPES);
const INVOICE_DUE_DAYS = 30;

const EXT_BY_TYPE: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/mp4': 'm4a',
  'audio/m4a': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/aac': 'aac',
  'audio/flac': 'flac',
};

function downloadFilename(title: string, contentType: string | null): string {
  const base = title.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100) || 'recording';
  const ext = contentType ? (EXT_BY_TYPE[contentType] ?? 'audio') : 'audio';
  return `${base}.${ext}`;
}

const segmentInclude = {
  segments: { orderBy: { sortOrder: 'asc' } },
} as const satisfies Prisma.RecordingInclude;

export function registerRecordingRoutes(app: FastifyInstance): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // --- List (search, filter, paginate) ---------------------------------------
  r.route({
    method: 'GET',
    url: '/v1/recordings',
    preHandler: [requirePermission('recordings.read')],
    schema: {
      tags: ['recordings'],
      querystring: recordingListQuerySchema,
      response: { 200: paginatedSchema(recordingDtoSchema) },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const { source, status, customerId, search, page, pageSize } = request.query;

      const where: Prisma.RecordingWhereInput = {
        organizationId,
        ...(source ? { source } : {}),
        ...(status ? { status } : {}),
        ...(customerId ? { customerId } : {}),
        ...(search
          ? {
              OR: [
                { title: { contains: search, mode: 'insensitive' } },
                { transcriptText: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      };

      const [rows, totalItems] = await app.prisma.$transaction([
        app.prisma.recording.findMany({
          where,
          orderBy: { occurredAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        app.prisma.recording.count({ where }),
      ]);

      return reply.send({
        // Segments are omitted from list rows; the detail endpoint carries them.
        items: rows.map((row) => toRecordingDto(row)),
        page,
        pageSize,
        totalItems,
        totalPages: Math.max(1, Math.ceil(totalItems / pageSize)),
      });
    },
  });

  // --- Upload a voice note (multipart audio) ---------------------------------
  r.route({
    method: 'POST',
    url: '/v1/recordings/voice-notes',
    preHandler: [requirePermission('recordings.manage')],
    schema: {
      tags: ['recordings'],
      querystring: uploadVoiceNoteQuerySchema,
      response: { 201: recordingDtoSchema },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const q = request.query;

      // Voice notes may be larger than generic attachments, so raise the
      // per-request byte ceiling above the app-wide multipart default.
      const file = await request.file({ limits: { fileSize: MAX_AUDIO_BYTES } });
      if (!file) throw errors.badRequest('no_file', 'No audio file was uploaded');
      if (!ALLOWED.has(file.mimetype)) {
        throw errors.badRequest('unsupported_type', `Audio type ${file.mimetype} is not allowed`);
      }

      const buffer = await file.toBuffer();
      if (file.file.truncated || buffer.byteLength > MAX_AUDIO_BYTES) {
        throw errors.badRequest('file_too_large', 'Audio exceeds the maximum allowed size');
      }

      await assertLinks(app.prisma, organizationId, q);

      const key = app.storage.buildKey(organizationId, file.filename || 'voice-note');
      await app.storage.put(key, buffer, file.mimetype);

      try {
        const recording = await app.prisma.$transaction(async (tx) => {
          const created = await tx.recording.create({
            data: {
              organizationId,
              source: 'VOICE_NOTE',
              title: q.title,
              storageKey: key,
              contentType: file.mimetype,
              durationSeconds: q.durationSeconds ?? null,
              sizeBytes: buffer.byteLength,
              // UPLOADED + PENDING == queued for transcription; the worker moves
              // it to TRANSCRIBING then TRANSCRIBED/COMPLETED (or FAILED/FAILED).
              status: 'UPLOADED',
              transcriptStatus: 'PENDING',
              occurredAt: q.occurredAt ? new Date(q.occurredAt) : new Date(),
              customerId: q.customerId ?? null,
              projectId: q.projectId ?? null,
              taskId: q.taskId ?? null,
              createdById: request.currentUser?.id ?? null,
            },
          });
          await recordAudit(tx, {
            action: 'recording.created',
            organizationId,
            ...auditContext(request),
            entityType: 'recording',
            entityId: created.id,
            metadata: { source: 'VOICE_NOTE', sizeBytes: created.sizeBytes },
          });
          if (created.customerId || created.projectId || created.taskId) {
            await recordActivity(tx, {
              organizationId,
              actorUserId: request.currentUser?.id ?? null,
              type: 'recording.added',
              ref: {
                customerId: created.customerId,
                projectId: created.projectId,
                taskId: created.taskId,
              },
              metadata: { title: created.title },
            });
          }
          // Same transaction as the row: the outbox relay only publishes after
          // the recording exists, so the transcription worker never races it.
          await enqueueOutbox(tx, 'recording.uploaded', {
            recordingId: created.id,
            organizationId,
            storageKey: key,
          });
          return created;
        });
        return reply.code(201).send(toRecordingDto(recording));
      } catch (error) {
        await app.storage.delete(key).catch(() => undefined);
        throw error;
      }
    },
  });

  // --- Log a call (no audio) -------------------------------------------------
  r.route({
    method: 'POST',
    url: '/v1/recordings/call-logs',
    preHandler: [requirePermission('recordings.manage')],
    schema: {
      tags: ['recordings'],
      body: createCallLogBodySchema,
      response: { 201: recordingDtoSchema },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const body = request.body;
      await assertLinks(app.prisma, organizationId, body);

      const recording = await app.prisma.$transaction(async (tx) => {
        const created = await tx.recording.create({
          data: {
            organizationId,
            source: 'CALL',
            title: body.title,
            direction: body.direction,
            fromNumber: body.fromNumber ?? null,
            toNumber: body.toNumber ?? null,
            durationSeconds: body.durationSeconds ?? null,
            // A call log carries no audio, so there is nothing to transcribe.
            status: 'UPLOADED',
            transcriptStatus: 'NONE',
            transcriptText: body.notes ?? null,
            occurredAt: body.occurredAt ? new Date(body.occurredAt) : new Date(),
            customerId: body.customerId ?? null,
            projectId: body.projectId ?? null,
            taskId: body.taskId ?? null,
            createdById: request.currentUser?.id ?? null,
          },
        });
        await recordAudit(tx, {
          action: 'recording.created',
          organizationId,
          ...auditContext(request),
          entityType: 'recording',
          entityId: created.id,
          metadata: { source: 'CALL', direction: created.direction },
        });
        if (created.customerId || created.projectId || created.taskId) {
          await recordActivity(tx, {
            organizationId,
            actorUserId: request.currentUser?.id ?? null,
            type: 'recording.added',
            ref: {
              customerId: created.customerId,
              projectId: created.projectId,
              taskId: created.taskId,
            },
            metadata: { title: created.title, direction: created.direction },
          });
        }
        return created;
      });
      return reply.code(201).send(toRecordingDto(recording));
    },
  });

  // --- Detail (with transcript segments) -------------------------------------
  r.route({
    method: 'GET',
    url: '/v1/recordings/:recordingId',
    preHandler: [requirePermission('recordings.read')],
    schema: {
      tags: ['recordings'],
      params: recordingIdParamsSchema,
      response: { 200: recordingDtoSchema },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const recording = await app.prisma.recording.findFirst({
        where: { id: request.params.recordingId, organizationId },
        include: segmentInclude,
      });
      if (!recording) throw errors.notFound('Recording');
      return reply.send(toRecordingDto(recording, recording.segments));
    },
  });

  // --- Update metadata / links -----------------------------------------------
  r.route({
    method: 'PATCH',
    url: '/v1/recordings/:recordingId',
    preHandler: [requirePermission('recordings.manage')],
    schema: {
      tags: ['recordings'],
      params: recordingIdParamsSchema,
      body: updateRecordingBodySchema,
      response: { 200: recordingDtoSchema },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const body = request.body;
      const existing = await app.prisma.recording.findFirst({
        where: { id: request.params.recordingId, organizationId },
        select: { id: true },
      });
      if (!existing) throw errors.notFound('Recording');
      await assertLinks(app.prisma, organizationId, body);

      const recording = await app.prisma.$transaction(async (tx) => {
        const updated = await tx.recording.update({
          where: { id: existing.id },
          data: {
            ...(body.title !== undefined ? { title: body.title } : {}),
            ...(body.occurredAt !== undefined ? { occurredAt: new Date(body.occurredAt) } : {}),
            ...(body.customerId !== undefined ? { customerId: body.customerId } : {}),
            ...(body.projectId !== undefined ? { projectId: body.projectId } : {}),
            ...(body.taskId !== undefined ? { taskId: body.taskId } : {}),
          },
          include: segmentInclude,
        });
        await recordAudit(tx, {
          action: 'recording.updated',
          organizationId,
          ...auditContext(request),
          entityType: 'recording',
          entityId: updated.id,
        });
        return updated;
      });
      return reply.send(toRecordingDto(recording, recording.segments));
    },
  });

  // --- Delete ----------------------------------------------------------------
  r.route({
    method: 'DELETE',
    url: '/v1/recordings/:recordingId',
    preHandler: [requirePermission('recordings.manage')],
    schema: { tags: ['recordings'], params: recordingIdParamsSchema },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const recording = await app.prisma.recording.findFirst({
        where: { id: request.params.recordingId, organizationId },
        select: { id: true, storageKey: true, title: true },
      });
      if (!recording) throw errors.notFound('Recording');

      await app.prisma.$transaction(async (tx) => {
        // Segments cascade with the recording row (FK onDelete: Cascade).
        await tx.recording.delete({ where: { id: recording.id } });
        await recordAudit(tx, {
          action: 'recording.deleted',
          organizationId,
          ...auditContext(request),
          entityType: 'recording',
          entityId: recording.id,
          metadata: { title: recording.title },
        });
      });
      if (recording.storageKey) {
        await app.storage.delete(recording.storageKey).catch((err) => {
          request.log.warn({ err, key: recording.storageKey }, 'failed to delete audio object');
        });
      }
      return reply.code(204).send();
    },
  });

  // --- Audio download (short-lived signed URL) -------------------------------
  r.route({
    method: 'GET',
    url: '/v1/recordings/:recordingId/audio',
    preHandler: [requirePermission('recordings.read')],
    schema: {
      tags: ['recordings'],
      params: recordingIdParamsSchema,
      response: { 200: attachmentDownloadDtoSchema },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const recording = await app.prisma.recording.findFirst({
        where: { id: request.params.recordingId, organizationId },
        select: { storageKey: true, title: true, contentType: true },
      });
      if (!recording) throw errors.notFound('Recording');
      if (!recording.storageKey) {
        throw errors.badRequest('no_audio', 'This recording has no audio to download');
      }
      const signed = await app.storage.getDownloadUrl(
        recording.storageKey,
        downloadFilename(recording.title, recording.contentType),
      );
      return reply.send(signed);
    },
  });

  // --- Re-run transcription --------------------------------------------------
  r.route({
    method: 'POST',
    url: '/v1/recordings/:recordingId/retranscribe',
    preHandler: [requirePermission('recordings.manage')],
    schema: {
      tags: ['recordings'],
      params: recordingIdParamsSchema,
      response: { 200: recordingDtoSchema },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const existing = await app.prisma.recording.findFirst({
        where: { id: request.params.recordingId, organizationId },
        select: { id: true, storageKey: true },
      });
      if (!existing) throw errors.notFound('Recording');
      if (!existing.storageKey) {
        throw errors.badRequest('no_audio', 'This recording has no audio to transcribe');
      }

      const recording = await app.prisma.$transaction(async (tx) => {
        const updated = await tx.recording.update({
          where: { id: existing.id },
          // Back to the queued state; the worker will re-run and rewrite
          // segments. A fresh outbox row means a new envelope id, so the
          // consumer's idempotency ledger does not suppress the re-run.
          data: { status: 'UPLOADED', transcriptStatus: 'PENDING', transcriptError: null },
          include: segmentInclude,
        });
        await recordAudit(tx, {
          action: 'recording.retranscribe_requested',
          organizationId,
          ...auditContext(request),
          entityType: 'recording',
          entityId: updated.id,
        });
        await enqueueOutbox(tx, 'recording.uploaded', {
          recordingId: updated.id,
          organizationId,
          storageKey: existing.storageKey,
        });
        return updated;
      });
      return reply.send(toRecordingDto(recording, recording.segments));
    },
  });

  // --- Convert to a task -----------------------------------------------------
  r.route({
    method: 'POST',
    url: '/v1/recordings/:recordingId/task',
    // Creating a task from a recording needs BOTH rights, so neither module's
    // permission alone grants an escalation into the other.
    preHandler: [requirePermission('recordings.manage'), requirePermission('tasks.manage')],
    schema: {
      tags: ['recordings'],
      params: recordingIdParamsSchema,
      body: recordingToTaskBodySchema,
      response: { 201: taskDtoSchema },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const body = request.body;
      const recording = await app.prisma.recording.findFirst({
        where: { id: request.params.recordingId, organizationId },
      });
      if (!recording) throw errors.notFound('Recording');
      // Converting sets recording.taskId to the produced task. If a task link
      // already exists, refuse rather than silently clobber it (mirrors the
      // quote→invoice already_converted guard). Unlink first to re-convert.
      if (recording.taskId) {
        throw errors.conflict(
          'already_linked_to_task',
          'This recording is already linked to a task; unlink it before creating a new one',
        );
      }

      if (body.assigneeId) {
        const member = await app.prisma.organizationMember.findFirst({
          where: { organizationId, userId: body.assigneeId },
          select: { id: true },
        });
        if (!member) {
          throw errors.badRequest('unknown_assignee', 'Assignee is not a member of this organization');
        }
      }

      const task = await app.prisma.$transaction(async (tx) => {
        const created = await tx.task.create({
          data: {
            organizationId,
            title: body.title ?? recording.title.slice(0, 300),
            description: transcriptSnippet(recording.transcriptText),
            customerId: recording.customerId,
            projectId: recording.projectId,
            assigneeId: body.assigneeId ?? null,
            dueDate: body.dueDate ? new Date(body.dueDate) : null,
            createdById: request.currentUser?.id ?? null,
          },
          include: {
            customer: { select: { id: true, name: true } },
            project: { select: { id: true, name: true } },
            employee: { select: { id: true, firstName: true, lastName: true } },
            assignee: { select: { id: true, name: true } },
          },
        });
        // Link the recording to the task it produced.
        await tx.recording.update({ where: { id: recording.id }, data: { taskId: created.id } });
        await recordAudit(tx, {
          action: 'recording.converted_to_task',
          organizationId,
          ...auditContext(request),
          entityType: 'task',
          entityId: created.id,
          metadata: { recordingId: recording.id },
        });
        if (created.customerId || created.projectId) {
          await recordActivity(tx, {
            organizationId,
            actorUserId: request.currentUser?.id ?? null,
            type: 'task.created',
            ref: {
              customerId: created.customerId,
              projectId: created.projectId,
              taskId: created.id,
            },
            metadata: { title: created.title, fromRecording: true },
          });
        }
        return created;
      });
      return reply.code(201).send(toTaskDto(task));
    },
  });

  // --- Convert to a DRAFT invoice --------------------------------------------
  r.route({
    method: 'POST',
    url: '/v1/recordings/:recordingId/invoice',
    preHandler: [requirePermission('recordings.manage'), requirePermission('invoices.manage')],
    schema: {
      tags: ['recordings'],
      params: recordingIdParamsSchema,
      body: recordingToInvoiceBodySchema,
      response: { 201: invoiceDtoSchema },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const body = request.body;
      const recording = await app.prisma.recording.findFirst({
        where: { id: request.params.recordingId, organizationId },
      });
      if (!recording) throw errors.notFound('Recording');
      if (!recording.customerId) {
        throw errors.badRequest(
          'no_customer',
          'Link a customer to this recording before creating an invoice',
        );
      }

      const now = new Date();
      const dueDate = new Date(now.getTime() + INVOICE_DUE_DAYS * 24 * 60 * 60 * 1000);
      const description =
        body.description ?? transcriptSnippet(recording.transcriptText, 500) ?? recording.title;
      const doc = buildDocument(organizationId, [
        {
          productId: null,
          description: description.slice(0, 500),
          quantity: body.quantity,
          unitPriceMinor: body.unitPriceMinor,
          discountPercent: 0,
          taxRatePercent: body.taxRatePercent,
        },
      ]);

      const invoice = await app.prisma.$transaction(async (tx) => {
        const created = await tx.invoice.create({
          data: {
            organizationId,
            customerId: recording.customerId!,
            status: 'DRAFT',
            currency: 'SEK',
            issueDate: now,
            dueDate,
            ...doc.header,
            createdById: request.currentUser?.id ?? null,
            lineItems: { create: doc.lines },
          },
          include: { customer: { select: { id: true, name: true } }, lineItems: true },
        });
        await recordAudit(tx, {
          action: 'recording.converted_to_invoice',
          organizationId,
          ...auditContext(request),
          entityType: 'invoice',
          entityId: created.id,
          metadata: { recordingId: recording.id },
        });
        await recordActivity(tx, {
          organizationId,
          actorUserId: request.currentUser?.id ?? null,
          type: 'invoice.created',
          ref: { customerId: created.customerId },
          metadata: { fromRecording: true },
        });
        return created;
      });
      return reply.code(201).send(toInvoiceDto(invoice, now));
    },
  });
}
