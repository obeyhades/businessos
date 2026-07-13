import type { Prisma, PrismaClient } from '@businessos/db';
import type { AuditAction } from '@businessos/types';
import type { FastifyRequest } from 'fastify';

type DbClient = PrismaClient | Prisma.TransactionClient;

export interface AuditEntry {
  action: AuditAction;
  organizationId?: string | null;
  actorUserId?: string | null;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
}

/**
 * Append-only audit trail. Pass the transaction client when the audited
 * action happens inside a transaction so the audit entry cannot outlive a
 * rolled-back change.
 */
export async function recordAudit(db: DbClient, entry: AuditEntry): Promise<void> {
  await db.auditLog.create({
    data: {
      action: entry.action,
      organizationId: entry.organizationId ?? null,
      actorUserId: entry.actorUserId ?? null,
      entityType: entry.entityType ?? null,
      entityId: entry.entityId ?? null,
      metadata: (entry.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
      ip: entry.ip ?? null,
      userAgent: entry.userAgent ?? null,
    },
  });
}

/** Extracts actor/ip/user-agent from the request for audit entries. */
export function auditContext(request: FastifyRequest): {
  actorUserId: string | null;
  ip: string;
  userAgent: string | undefined;
} {
  return {
    actorUserId: request.currentUser?.id ?? null,
    ip: request.ip,
    userAgent: request.headers['user-agent']?.slice(0, 512),
  };
}
