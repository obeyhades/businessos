import type { Prisma, PrismaClient } from '@businessos/db';
import type { ActivityType, EntityKind } from '@businessos/types';
import { errors } from '../../lib/errors.js';

type DbClient = PrismaClient | Prisma.TransactionClient;

/**
 * The parent an activity/comment/attachment hangs off, plus the denormalized
 * customer/project chain so a customer timeline is a single indexed query.
 */
export interface EntityRef {
  customerId: string | null;
  projectId: string | null;
  taskId: string | null;
}

/**
 * Resolves an (kind, id) reference within an organization and returns its
 * ownership chain. Throws 404 if the entity is not in this org — this is the
 * tenant-isolation gate for every polymorphic write.
 */
export async function resolveEntityRef(
  db: DbClient,
  organizationId: string,
  kind: EntityKind,
  id: string,
): Promise<EntityRef> {
  if (kind === 'customer') {
    const customer = await db.customer.findFirst({
      where: { id, organizationId },
      select: { id: true },
    });
    if (!customer) throw errors.notFound('Customer');
    return { customerId: id, projectId: null, taskId: null };
  }
  if (kind === 'project') {
    const project = await db.project.findFirst({
      where: { id, organizationId },
      select: { id: true, customerId: true },
    });
    if (!project) throw errors.notFound('Project');
    return { customerId: project.customerId, projectId: id, taskId: null };
  }
  const task = await db.task.findFirst({
    where: { id, organizationId },
    select: {
      id: true,
      customerId: true,
      projectId: true,
      project: { select: { customerId: true } },
    },
  });
  if (!task) throw errors.notFound('Task');
  return {
    customerId: task.customerId ?? task.project?.customerId ?? null,
    projectId: task.projectId,
    taskId: id,
  };
}

export interface ActivityInput {
  organizationId: string;
  actorUserId: string | null;
  type: ActivityType;
  ref: Partial<EntityRef>;
  metadata?: Record<string, unknown>;
}

/**
 * Appends a user-facing timeline entry. Always call inside the same
 * transaction as the change it describes.
 */
export async function recordActivity(db: DbClient, input: ActivityInput): Promise<void> {
  await db.activity.create({
    data: {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      type: input.type,
      customerId: input.ref.customerId ?? null,
      projectId: input.ref.projectId ?? null,
      taskId: input.ref.taskId ?? null,
      metadata: (input.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });
}
