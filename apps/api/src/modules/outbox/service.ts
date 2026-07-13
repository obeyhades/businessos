import type { Prisma, PrismaClient } from '@businessos/db';
import type { DomainEventType, EmailSendPayload } from '@businessos/types';

type DbClient = PrismaClient | Prisma.TransactionClient;

/**
 * Transactional outbox writer (ADR-0005). Always call with the SAME
 * transaction client as the domain change; the worker relays rows to
 * RabbitMQ and marks them published.
 */
export async function enqueueOutbox(
  db: DbClient,
  type: DomainEventType,
  payload: Record<string, unknown>,
): Promise<void> {
  await db.outboxMessage.create({
    data: { type, payload: payload as Prisma.InputJsonValue },
  });
}

export async function enqueueEmail(db: DbClient, email: EmailSendPayload): Promise<void> {
  await enqueueOutbox(db, 'email.send', email);
}
