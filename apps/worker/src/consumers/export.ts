import { EXPORT_QUEUE, outboxEnvelopeSchema } from '@businessos/types';
import { Prisma, type PrismaClient } from '@businessos/db';
import type { ObjectStorage } from '@businessos/storage';
import type { Logger } from 'pino';
import type { AmqpConfirmChannel } from '../amqp.js';

const CONSUMER_NAME = 'organization.export';
const EXPORT_TTL_DAYS = 7;

interface ExportConsumerDeps {
  prisma: PrismaClient;
  channel: AmqpConfirmChannel;
  storage: ObjectStorage;
  logger: Logger;
}

/** JSON.stringify can't serialize BigInt (money minor units) — render as string. */
function jsonReplacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value;
}

/**
 * Gathers all org-scoped data into a single portable object. Secrets are never
 * included (webhook secrets, password hashes, session tokens live outside this).
 */
async function buildOrgExport(
  prisma: PrismaClient,
  organizationId: string,
): Promise<Record<string, unknown>> {
  const where = { where: { organizationId } };
  const [
    organization,
    members,
    customers,
    contacts,
    projects,
    tasks,
    comments,
    activities,
    employees,
    employeeNotes,
    certifications,
    absenceRequests,
    employeeDocuments,
    products,
    quotes,
    invoices,
    payments,
    creditNotes,
    accounts,
    vouchers,
    calendars,
    calendarEvents,
    emailAccounts,
    emailThreads,
    emailMessages,
    recordings,
    webhookEndpoints,
    auditLogs,
  ] = await prisma.$transaction([
    prisma.organization.findUnique({ where: { id: organizationId } }),
    prisma.organizationMember.findMany({
      where: { organizationId },
      include: { user: { select: { id: true, email: true, name: true } } },
    }),
    prisma.customer.findMany(where),
    prisma.customerContact.findMany(where),
    prisma.project.findMany(where),
    prisma.task.findMany(where),
    prisma.comment.findMany(where),
    prisma.activity.findMany(where),
    prisma.employee.findMany(where),
    prisma.employeeNote.findMany(where),
    prisma.certification.findMany(where),
    prisma.absenceRequest.findMany(where),
    prisma.employeeDocument.findMany(where),
    prisma.product.findMany(where),
    prisma.quote.findMany({ where: { organizationId }, include: { lineItems: true } }),
    prisma.invoice.findMany({ where: { organizationId }, include: { lineItems: true } }),
    prisma.payment.findMany(where),
    prisma.creditNote.findMany({ where: { organizationId }, include: { lineItems: true } }),
    prisma.account.findMany(where),
    prisma.voucher.findMany({ where: { organizationId }, include: { lines: true } }),
    prisma.calendar.findMany(where),
    prisma.calendarEvent.findMany({ where: { organizationId }, include: { attendees: true } }),
    prisma.emailAccount.findMany(where),
    prisma.emailThread.findMany(where),
    prisma.emailMessage.findMany(where),
    prisma.recording.findMany({ where: { organizationId }, include: { segments: true } }),
    prisma.webhookEndpoint.findMany({
      where: { organizationId },
      select: {
        id: true,
        url: true,
        description: true,
        eventTypes: true,
        enabled: true,
        createdAt: true,
      },
    }),
    prisma.auditLog.findMany(where),
  ]);

  return {
    schemaVersion: 1,
    organization,
    members,
    customers,
    contacts,
    projects,
    tasks,
    comments,
    activities,
    employees,
    employeeNotes,
    certifications,
    absenceRequests,
    employeeDocuments,
    products,
    quotes,
    invoices,
    payments,
    creditNotes,
    accounts,
    vouchers,
    calendars,
    calendarEvents,
    emailAccounts,
    emailThreads,
    emailMessages,
    recordings,
    webhookEndpoints,
    auditLogs,
  };
}

async function generateExport(
  deps: Omit<ExportConsumerDeps, 'channel'>,
  organizationId: string,
  jobId: string,
): Promise<'generated' | 'skipped'> {
  const { prisma, storage } = deps;
  const job = await prisma.dataExportJob.findFirst({ where: { id: jobId, organizationId } });
  if (!job || job.status === 'COMPLETED') return 'skipped';

  await prisma.dataExportJob.update({ where: { id: job.id }, data: { status: 'PROCESSING' } });
  try {
    const bundle = await buildOrgExport(prisma, organizationId);
    const body = Buffer.from(JSON.stringify(bundle, jsonReplacer, 2), 'utf8');
    const key = `org/${organizationId}/exports/${job.id}.json`;
    await storage.put(key, body, 'application/json');
    await prisma.dataExportJob.update({
      where: { id: job.id },
      data: {
        status: 'COMPLETED',
        storageKey: key,
        sizeBytes: body.byteLength,
        completedAt: new Date(),
        expiresAt: new Date(Date.now() + EXPORT_TTL_DAYS * 24 * 60 * 60 * 1000),
        error: null,
      },
    });
    return 'generated';
  } catch (err) {
    await prisma.dataExportJob
      .update({
        where: { id: job.id },
        data: {
          status: 'FAILED',
          error: err instanceof Error ? err.message.slice(0, 500) : String(err),
        },
      })
      .catch(() => undefined);
    throw err;
  }
}

/**
 * organization.export consumer. Builds a GDPR data-portability archive for a
 * requested job and stores it. Idempotent via the processed-message ledger; a
 * hard failure marks the job FAILED, records a failed_jobs row, and acks.
 */
export async function startExportConsumer(deps: ExportConsumerDeps): Promise<void> {
  const { prisma, channel, logger } = deps;

  await channel.prefetch(2);
  await channel.consume(EXPORT_QUEUE, (message) => {
    if (!message) return;
    void (async () => {
      const rawContent = message.content.toString();
      let envelopeId: string | undefined;
      try {
        const envelope = outboxEnvelopeSchema.parse(JSON.parse(rawContent));
        envelopeId = envelope.id;

        const already = await prisma.processedMessage.findUnique({
          where: { messageId_consumer: { messageId: envelope.id, consumer: CONSUMER_NAME } },
        });
        if (already) {
          channel.ack(message);
          return;
        }

        if (envelope.type === 'organization.export_requested') {
          const payload = envelope.payload as { organizationId?: string; jobId?: string };
          if (payload.organizationId && payload.jobId) {
            await generateExport(
              { prisma, storage: deps.storage, logger },
              payload.organizationId,
              payload.jobId,
            );
          }
        }

        await prisma.processedMessage
          .create({ data: { messageId: envelope.id, consumer: CONSUMER_NAME } })
          .catch((err) => {
            if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) {
              throw err;
            }
          });
        channel.ack(message);
      } catch (error) {
        logger.error({ err: error, messageId: envelopeId }, 'export generation failed');
        await prisma.failedJob
          .create({
            data: {
              queue: EXPORT_QUEUE,
              messageType: 'organization.export',
              payload: { raw: rawContent } as Prisma.InputJsonValue,
              error: error instanceof Error ? error.message.slice(0, 2000) : String(error),
              attempts: 1,
            },
          })
          .catch((dbError) => logger.error({ err: dbError }, 'failed to record failed job'));
        channel.ack(message);
      }
    })();
  });

  logger.info({ queue: EXPORT_QUEUE }, 'export consumer started');
}
