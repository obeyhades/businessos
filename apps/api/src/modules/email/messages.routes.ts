import {
  createMessageBodySchema,
  emailMessageDtoSchema,
  emailThreadDetailDtoSchema,
  messageIdParamsSchema,
  updateMessageBodySchema,
} from '@businessos/types';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { errors } from '../../lib/errors.js';
import { orgContext, requirePermission } from '../../plugins/auth.js';
import { auditContext, recordAudit } from '../audit/service.js';
import { recordActivity } from '../activity/service.js';
import { enqueueOutbox } from '../outbox/service.js';
import { threadDetailInclude, toEmailMessageDto, toEmailThreadDetailDto } from './mappers.js';
import {
  canSeeAccount,
  generateRfcMessageId,
  makeSnippet,
  normalizeSubject,
  recomputeThread,
} from './service.js';

const messageInclude = { attachments: true } as const;

export function registerEmailMessageRoutes(app: FastifyInstance): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // --- Compose or reply (creates a DRAFT) ------------------------------------
  r.route({
    method: 'POST',
    url: '/v1/email/messages',
    preHandler: [requirePermission('email.send')],
    schema: {
      tags: ['email'],
      body: createMessageBodySchema,
      response: { 201: emailMessageDtoSchema },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const userId = request.currentUser?.id;
      const body = request.body;

      const account = await app.prisma.emailAccount.findFirst({
        where: { id: body.accountId, organizationId },
      });
      if (!account)
        throw errors.badRequest('unknown_account', 'Mailbox not found in this organization');
      if (!canSeeAccount(account, userId)) throw errors.notFound('Mailbox');
      if (!account.isActive) throw errors.badRequest('inactive_account', 'Mailbox is inactive');

      const message = await app.prisma.$transaction(async (tx) => {
        let threadId = body.threadId ?? null;
        let inReplyTo: string | null = null;
        let references: string[] = [];

        if (threadId) {
          const thread = await tx.emailThread.findFirst({
            where: { id: threadId, organizationId, accountId: account.id },
            select: { id: true },
          });
          if (!thread)
            throw errors.badRequest('unknown_thread', 'Thread not found for this mailbox');
          // Thread the reply onto the most recent message with a Message-ID.
          const parent = await tx.emailMessage.findFirst({
            where: { threadId, messageId: { not: null } },
            orderBy: { createdAt: 'desc' },
            select: { messageId: true, references: true },
          });
          if (parent?.messageId) {
            inReplyTo = parent.messageId;
            references = [...parent.references, parent.messageId];
          }
        } else {
          const created = await tx.emailThread.create({
            data: {
              organizationId,
              accountId: account.id,
              subject: normalizeSubject(body.subject),
              folder: 'INBOX',
              unread: false,
              messageCount: 0,
              lastMessageAt: new Date(),
              snippet: makeSnippet(body.bodyText),
            },
          });
          threadId = created.id;
        }

        const draft = await tx.emailMessage.create({
          data: {
            organizationId,
            threadId,
            accountId: account.id,
            direction: 'OUTBOUND',
            status: 'DRAFT',
            fromAddress: account.address,
            fromName: account.displayName,
            toAddresses: body.to,
            ccAddresses: body.cc,
            subject: body.subject,
            bodyText: body.bodyText,
            bodyHtml: body.bodyHtml ?? null,
            inReplyTo,
            references,
            isRead: true,
            createdById: userId ?? null,
          },
          include: messageInclude,
        });
        await recomputeThread(tx, threadId);
        await recordAudit(tx, {
          action: 'email.composed',
          organizationId,
          ...auditContext(request),
          entityType: 'email_message',
          entityId: draft.id,
          metadata: { threadId, reply: !!body.threadId },
        });
        return draft;
      });
      return reply.code(201).send(toEmailMessageDto(message));
    },
  });

  // --- Edit a draft -----------------------------------------------------------
  r.route({
    method: 'PATCH',
    url: '/v1/email/messages/:messageId',
    preHandler: [requirePermission('email.send')],
    schema: {
      tags: ['email'],
      params: messageIdParamsSchema,
      body: updateMessageBodySchema,
      response: { 200: emailMessageDtoSchema },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const body = request.body;
      const existing = await app.prisma.emailMessage.findFirst({
        where: { id: request.params.messageId, organizationId },
        select: { id: true, status: true, threadId: true },
      });
      if (!existing) throw errors.notFound('Message');
      if (existing.status !== 'DRAFT') {
        throw errors.conflict('not_a_draft', 'Only draft messages can be edited');
      }
      const message = await app.prisma.$transaction(async (tx) => {
        const updated = await tx.emailMessage.update({
          where: { id: existing.id },
          data: {
            ...(body.to !== undefined ? { toAddresses: body.to } : {}),
            ...(body.cc !== undefined ? { ccAddresses: body.cc } : {}),
            ...(body.subject !== undefined ? { subject: body.subject } : {}),
            ...(body.bodyText !== undefined ? { bodyText: body.bodyText } : {}),
            ...(body.bodyHtml !== undefined ? { bodyHtml: body.bodyHtml } : {}),
          },
          include: messageInclude,
        });
        await recomputeThread(tx, existing.threadId);
        return updated;
      });
      return reply.send(toEmailMessageDto(message));
    },
  });

  // --- Delete a draft ---------------------------------------------------------
  r.route({
    method: 'DELETE',
    url: '/v1/email/messages/:messageId',
    preHandler: [requirePermission('email.send')],
    schema: { tags: ['email'], params: messageIdParamsSchema },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const existing = await app.prisma.emailMessage.findFirst({
        where: { id: request.params.messageId, organizationId },
        select: { id: true, status: true, threadId: true },
      });
      if (!existing) throw errors.notFound('Message');
      if (existing.status !== 'DRAFT') {
        throw errors.conflict('not_a_draft', 'Only draft messages can be deleted');
      }
      await app.prisma.$transaction(async (tx) => {
        await tx.emailMessage.delete({ where: { id: existing.id } });
        const remaining = await tx.emailMessage.count({ where: { threadId: existing.threadId } });
        if (remaining === 0) {
          await tx.emailThread.delete({ where: { id: existing.threadId } });
        } else {
          await recomputeThread(tx, existing.threadId);
        }
      });
      return reply.code(204).send();
    },
  });

  // --- Send a draft (queues via the worker email pipeline) --------------------
  r.route({
    method: 'POST',
    url: '/v1/email/messages/:messageId/send',
    preHandler: [requirePermission('email.send')],
    schema: {
      tags: ['email'],
      params: messageIdParamsSchema,
      response: { 200: emailThreadDetailDtoSchema },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const draft = await app.prisma.emailMessage.findFirst({
        where: { id: request.params.messageId, organizationId },
        select: {
          id: true,
          status: true,
          threadId: true,
          fromAddress: true,
          toAddresses: true,
          ccAddresses: true,
          subject: true,
          bodyText: true,
          bodyHtml: true,
        },
      });
      if (!draft) throw errors.notFound('Message');
      if (draft.status !== 'DRAFT') {
        throw errors.conflict('already_sent', `Message is ${draft.status}, not a draft`);
      }
      if (draft.toAddresses.length === 0) {
        throw errors.badRequest('no_recipient', 'Add at least one recipient before sending');
      }

      const rfcId = generateRfcMessageId(draft.fromAddress);
      const detail = await app.prisma.$transaction(async (tx) => {
        await tx.emailMessage.update({
          where: { id: draft.id },
          data: { status: 'QUEUED', messageId: rfcId, sentAt: new Date() },
        });
        await recomputeThread(tx, draft.threadId);
        const thread = await tx.emailThread.findUniqueOrThrow({
          where: { id: draft.threadId },
          select: { customerId: true, projectId: true, taskId: true },
        });
        await recordAudit(tx, {
          action: 'email.sent',
          organizationId,
          ...auditContext(request),
          entityType: 'email_message',
          entityId: draft.id,
          metadata: { threadId: draft.threadId },
        });
        if (thread.customerId || thread.projectId || thread.taskId) {
          await recordActivity(tx, {
            organizationId,
            actorUserId: request.currentUser?.id ?? null,
            type: 'email.sent',
            ref: {
              customerId: thread.customerId,
              projectId: thread.projectId,
              taskId: thread.taskId,
              employeeId: null,
            },
            metadata: { subject: draft.subject },
          });
        }
        // Hand off to the shared email pipeline; the worker marks it SENT/FAILED.
        await enqueueOutbox(tx, 'email.send', {
          to: draft.toAddresses.join(', '),
          cc: draft.ccAddresses,
          subject: draft.subject,
          text: draft.bodyText || '(no content)',
          html: draft.bodyHtml ?? undefined,
          kind: 'email',
          organizationId,
          emailMessageId: draft.id,
        });
        await enqueueOutbox(tx, 'email.sent', {
          organizationId,
          messageId: draft.id,
          threadId: draft.threadId,
        });
        return tx.emailThread.findUniqueOrThrow({
          where: { id: draft.threadId },
          include: threadDetailInclude,
        });
      });
      return reply.send(toEmailThreadDetailDto(detail));
    },
  });
}
