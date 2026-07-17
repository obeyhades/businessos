import type { Prisma, PrismaClient } from '@businessos/db';
import { errors } from '../../lib/errors.js';

type DbClient = PrismaClient | Prisma.TransactionClient;

export interface RecordingLinks {
  customerId?: string | null;
  projectId?: string | null;
  taskId?: string | null;
}

/**
 * Validates that any provided customer/project/task link exists in this org.
 * `undefined` means "leave unchanged", `null` means "unlink" — neither is
 * checked; only a concrete id is verified. This is the tenant-isolation gate
 * for links so a recording can never point at another org's records.
 */
export async function assertLinks(
  db: DbClient,
  organizationId: string,
  links: RecordingLinks,
): Promise<void> {
  if (links.customerId) {
    const found = await db.customer.findFirst({
      where: { id: links.customerId, organizationId },
      select: { id: true },
    });
    if (!found) throw errors.badRequest('unknown_customer', 'Customer not found in this organization');
  }
  if (links.projectId) {
    const found = await db.project.findFirst({
      where: { id: links.projectId, organizationId },
      select: { id: true },
    });
    if (!found) throw errors.badRequest('unknown_project', 'Project not found in this organization');
  }
  if (links.taskId) {
    const found = await db.task.findFirst({
      where: { id: links.taskId, organizationId },
      select: { id: true },
    });
    if (!found) throw errors.badRequest('unknown_task', 'Task not found in this organization');
  }
}

/** A short, single-line preview of transcript text for task/invoice defaults. */
export function transcriptSnippet(text: string | null, max = 2000): string | null {
  if (!text) return null;
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > 0 ? collapsed.slice(0, max) : null;
}
