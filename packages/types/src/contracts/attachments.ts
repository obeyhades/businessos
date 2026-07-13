import { z } from 'zod';
import { timestampSchema, uuidSchema } from './common.js';
import { entityKindSchema } from './comments.js';

/** Upload limits enforced server-side (never trust a client-declared size). */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export const ALLOWED_ATTACHMENT_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/zip',
] as const;

export const attachmentDtoSchema = z.object({
  id: uuidSchema,
  fileName: z.string(),
  contentType: z.string(),
  size: z.number().int(),
  uploadedBy: z.object({ id: uuidSchema, name: z.string() }).nullable(),
  createdAt: timestampSchema,
});
export type AttachmentDto = z.infer<typeof attachmentDtoSchema>;

export const attachmentDownloadDtoSchema = z.object({
  url: z.string().url(),
  expiresInSeconds: z.number().int(),
});
export type AttachmentDownloadDto = z.infer<typeof attachmentDownloadDtoSchema>;

export const attachmentParentParamsSchema = z.object({
  entityKind: entityKindSchema,
  entityId: uuidSchema,
});
export type AttachmentParentParams = z.infer<typeof attachmentParentParamsSchema>;

export const attachmentIdParamsSchema = z.object({
  entityKind: entityKindSchema,
  entityId: uuidSchema,
  attachmentId: uuidSchema,
});
export type AttachmentIdParams = z.infer<typeof attachmentIdParamsSchema>;
