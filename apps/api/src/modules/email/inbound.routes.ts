import {
  inboundEmailBodySchema,
  inboundResultDtoSchema,
  type InboundEmailBody,
} from '@businessos/types';
import { Prisma } from '@businessos/db';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { timingSafeEqual } from 'node:crypto';
import { errors } from '../../lib/errors.js';
import { auditContext, recordAudit } from '../audit/service.js';
import { recordActivity } from '../activity/service.js';
import { enqueueOutbox } from '../outbox/service.js';
import {
  findCustomerByAddress,
  makeSnippet,
  normalizeSubject,
  recomputeThread,
} from './service.js';

function secretMatches(provided: string | undefined, expected: string): boolean {
  const a = Buffer.from(provided ?? '');
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

/**
 * Inbound-email ingestion — the provider integration seam. A mail provider's
 * inbound-parse webhook POSTs a parsed message here with a shared secret. This
 * is NOT session-authenticated (no cookie ⇒ the CSRF hook is skipped) and never
 * trusts the caller for tenancy: the org is derived from the destination
 * mailbox. Idempotent by RFC Message-ID (partial-unique backstop); threads by
 * References/In-Reply-To only (never by subject, to avoid false merges).
 */
export function registerEmailInboundRoutes(app: FastifyInstance): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.route({
    method: 'POST',
    url: '/v1/email/inbound',
    // No requirePermission — authenticated by the shared secret below.
    schema: {
      tags: ['email'],
      body: inboundEmailBodySchema,
      response: { 200: inboundResultDtoSchema },
    },
    handler: async (request: FastifyRequest, reply) => {
      const provided = request.headers['x-inbound-secret'];
      if (
        !secretMatches(
          Array.isArray(provided) ? provided[0] : provided,
          app.config.INBOUND_EMAIL_SECRET,
        )
      ) {
        throw errors.unauthorized();
      }
      const body = request.body as InboundEmailBody;

      // Route to the destination mailbox → derive the tenant.
      const account = await app.prisma.emailAccount.findFirst({
        where: { address: { equals: body.to, mode: 'insensitive' }, isActive: true },
        select: { id: true, organizationId: true, address: true },
      });
      if (!account) {
        return reply.send({ status: 'unknown_account', threadId: null, messageId: null });
      }
      const organizationId = account.organizationId;

      if (body.messageId) {
        const dup = await app.prisma.emailMessage.findFirst({
          where: { organizationId, messageId: body.messageId },
          select: { id: true, threadId: true },
        });
        if (dup)
          return reply.send({ status: 'duplicate', threadId: dup.threadId, messageId: dup.id });
      }

      // Thread strictly by RFC reference chain within this mailbox.
      const refIds = [body.inReplyTo, ...body.references].filter((x): x is string => !!x);
      let threadId: string | null = null;
      if (refIds.length > 0) {
        const parent = await app.prisma.emailMessage.findFirst({
          where: { organizationId, accountId: account.id, messageId: { in: refIds } },
          orderBy: { createdAt: 'desc' },
          select: { threadId: true },
        });
        threadId = parent?.threadId ?? null;
      }

      const receivedAt = body.receivedAt ? new Date(body.receivedAt) : new Date();
      try {
        const result = await app.prisma.$transaction(async (tx) => {
          if (!threadId) {
            const thread = await tx.emailThread.create({
              data: {
                organizationId,
                accountId: account.id,
                subject: normalizeSubject(body.subject),
                folder: 'INBOX',
                unread: true,
                messageCount: 0,
                lastMessageAt: receivedAt,
                snippet: makeSnippet(body.text),
              },
            });
            threadId = thread.id;
          }
          const message = await tx.emailMessage.create({
            data: {
              organizationId,
              threadId,
              accountId: account.id,
              direction: 'INBOUND',
              status: 'RECEIVED',
              fromAddress: body.from,
              fromName: body.fromName ?? null,
              toAddresses: [account.address],
              ccAddresses: body.cc,
              subject: body.subject,
              bodyText: body.text,
              bodyHtml: body.html ?? null,
              messageId: body.messageId ?? null,
              inReplyTo: body.inReplyTo ?? null,
              references: body.references,
              isRead: false,
              receivedAt,
            },
          });
          await recomputeThread(tx, threadId);

          // Auto-link the thread to a matching customer (once) + timeline it.
          const thread = await tx.emailThread.findUniqueOrThrow({
            where: { id: threadId },
            select: { customerId: true },
          });
          let linkedCustomerId = thread.customerId;
          if (!linkedCustomerId) {
            linkedCustomerId = await findCustomerByAddress(tx, organizationId, body.from);
            if (linkedCustomerId) {
              await tx.emailThread.update({
                where: { id: threadId },
                data: { customerId: linkedCustomerId },
              });
            }
          }
          if (linkedCustomerId) {
            await recordActivity(tx, {
              organizationId,
              actorUserId: null,
              type: 'email.received',
              ref: {
                customerId: linkedCustomerId,
                projectId: null,
                taskId: null,
                employeeId: null,
              },
              metadata: { subject: body.subject, from: body.from },
            });
          }

          await recordAudit(tx, {
            action: 'email.received',
            organizationId,
            ...auditContext(request),
            entityType: 'email_message',
            entityId: message.id,
            metadata: { threadId, from: body.from },
          });
          await enqueueOutbox(tx, 'email.received', {
            organizationId,
            messageId: message.id,
            threadId,
          });
          return { threadId, messageId: message.id };
        });
        return reply.send({
          status: 'created',
          threadId: result.threadId,
          messageId: result.messageId,
        });
      } catch (err) {
        if (isUniqueViolation(err) && body.messageId) {
          const dup = await app.prisma.emailMessage.findFirst({
            where: { organizationId, messageId: body.messageId },
            select: { id: true, threadId: true },
          });
          return reply.send({
            status: 'duplicate',
            threadId: dup?.threadId ?? null,
            messageId: dup?.id ?? null,
          });
        }
        throw err;
      }
    },
  });
}
