import type { DataExportJob, PrismaClient, RetentionPolicy } from '@businessos/db';
import type { DataExportJobDto, RetentionPolicyDto } from '@businessos/types';

export function toDataExportJobDto(job: DataExportJob): DataExportJobDto {
  return {
    id: job.id,
    status: job.status,
    ready: job.status === 'COMPLETED' && job.storageKey !== null,
    sizeBytes: job.sizeBytes,
    error: job.error,
    expiresAt: job.expiresAt?.toISOString() ?? null,
    completedAt: job.completedAt?.toISOString() ?? null,
    requestedById: job.requestedById,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
  };
}

export function toRetentionPolicyDto(policy: RetentionPolicy | null): RetentionPolicyDto {
  return {
    recordingsDays: policy?.recordingsDays ?? null,
    auditLogsDays: policy?.auditLogsDays ?? null,
    activitiesDays: policy?.activitiesDays ?? null,
    webhookDeliveriesDays: policy?.webhookDeliveriesDays ?? null,
    updatedAt: policy?.updatedAt?.toISOString() ?? null,
  };
}

/**
 * Every object-storage key owned by an org, gathered before erasure so the
 * blobs can be purged after the DB rows cascade-delete. Missing any class here
 * would orphan objects in storage, so keep it in step with the schema's
 * storage_key columns.
 */
export async function collectOrgStorageKeys(
  prisma: PrismaClient,
  organizationId: string,
): Promise<string[]> {
  const [attachments, employeeDocs, invoices, voucherAtts, emailAtts, recordings, exports] =
    await prisma.$transaction([
      prisma.fileAttachment.findMany({ where: { organizationId }, select: { storageKey: true } }),
      prisma.employeeDocument.findMany({ where: { organizationId }, select: { storageKey: true } }),
      prisma.invoice.findMany({
        where: { organizationId, pdfStorageKey: { not: null } },
        select: { pdfStorageKey: true },
      }),
      prisma.voucherAttachment.findMany({
        where: { organizationId },
        select: { storageKey: true },
      }),
      prisma.emailAttachment.findMany({ where: { organizationId }, select: { storageKey: true } }),
      prisma.recording.findMany({
        where: { organizationId, storageKey: { not: null } },
        select: { storageKey: true },
      }),
      prisma.dataExportJob.findMany({
        where: { organizationId, storageKey: { not: null } },
        select: { storageKey: true },
      }),
    ]);

  const keys = [
    ...attachments.map((a) => a.storageKey),
    ...employeeDocs.map((d) => d.storageKey),
    ...invoices.map((i) => i.pdfStorageKey),
    ...voucherAtts.map((v) => v.storageKey),
    ...emailAtts.map((e) => e.storageKey),
    ...recordings.map((r) => r.storageKey),
    ...exports.map((e) => e.storageKey),
  ].filter((k): k is string => k !== null);
  return [...new Set(keys)];
}
