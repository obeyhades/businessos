import { z } from 'zod';
import { attachmentDownloadDtoSchema } from './attachments.js';
import { timestampSchema, uuidSchema } from './common.js';

export { attachmentDownloadDtoSchema };

export const dataExportStatusSchema = z.enum(['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED']);
export type DataExportStatusDto = z.infer<typeof dataExportStatusSchema>;

/** A GDPR data-portability export job. `ready` is true once a download exists. */
export const dataExportJobDtoSchema = z.object({
  id: uuidSchema,
  status: dataExportStatusSchema,
  ready: z.boolean(),
  sizeBytes: z.number().int().nullable(),
  error: z.string().nullable(),
  expiresAt: timestampSchema.nullable(),
  completedAt: timestampSchema.nullable(),
  requestedById: uuidSchema.nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type DataExportJobDto = z.infer<typeof dataExportJobDtoSchema>;

export const dataExportJobIdParamsSchema = z.object({ jobId: uuidSchema });
export type DataExportJobIdParams = z.infer<typeof dataExportJobIdParamsSchema>;

/** Retention windows in days; null on a field means "retain indefinitely". */
const retentionDaysField = z.number().int().min(1).max(3650).nullable();

export const retentionPolicyDtoSchema = z.object({
  recordingsDays: retentionDaysField,
  auditLogsDays: retentionDaysField,
  activitiesDays: retentionDaysField,
  webhookDeliveriesDays: retentionDaysField,
  updatedAt: timestampSchema.nullable(),
});
export type RetentionPolicyDto = z.infer<typeof retentionPolicyDtoSchema>;

/** PUT replaces the whole policy; omitted fields default to null (keep forever). */
export const updateRetentionPolicyBodySchema = z.object({
  recordingsDays: retentionDaysField.default(null),
  auditLogsDays: retentionDaysField.default(null),
  activitiesDays: retentionDaysField.default(null),
  webhookDeliveriesDays: retentionDaysField.default(null),
});
export type UpdateRetentionPolicyBody = z.infer<typeof updateRetentionPolicyBodySchema>;

/**
 * Irreversible organization erasure (GDPR right-to-be-forgotten). The caller
 * must re-type the org slug to confirm — a guard against fat-finger / CSRF-style
 * destruction, mirroring the "type the repo name to delete" pattern.
 */
export const eraseOrganizationBodySchema = z.object({
  confirmSlug: z.string().min(1),
});
export type EraseOrganizationBody = z.infer<typeof eraseOrganizationBodySchema>;

export const eraseOrganizationResultSchema = z.object({
  erasedOrganizationId: uuidSchema,
  slug: z.string(),
});
export type EraseOrganizationResult = z.infer<typeof eraseOrganizationResultSchema>;
