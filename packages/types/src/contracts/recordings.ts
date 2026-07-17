import { z } from 'zod';
import { timestampSchema, uuidSchema } from './common.js';
import { attachmentDownloadDtoSchema } from './attachments.js';
import { isoDateTimeSchema } from './calendar.js';

export { attachmentDownloadDtoSchema };

/** Audio uploads: common voice-note formats, up to 50 MB. */
export const MAX_AUDIO_BYTES = 50 * 1024 * 1024;
export const ALLOWED_AUDIO_TYPES = [
  'audio/webm',
  'audio/ogg',
  'audio/mpeg',
  'audio/mp3',
  'audio/mp4',
  'audio/m4a',
  'audio/x-m4a',
  'audio/wav',
  'audio/x-wav',
  'audio/aac',
  'audio/flac',
] as const;

export const recordingSourceSchema = z.enum(['VOICE_NOTE', 'CALL']);
export type RecordingSource = z.infer<typeof recordingSourceSchema>;

export const recordingStatusSchema = z.enum(['UPLOADED', 'TRANSCRIBING', 'TRANSCRIBED', 'FAILED']);
export type RecordingStatus = z.infer<typeof recordingStatusSchema>;

export const callDirectionSchema = z.enum(['INBOUND', 'OUTBOUND']);
export type CallDirection = z.infer<typeof callDirectionSchema>;

export const transcriptStatusSchema = z.enum(['NONE', 'PENDING', 'COMPLETED', 'FAILED']);
export type TranscriptStatus = z.infer<typeof transcriptStatusSchema>;

export const transcriptSegmentDtoSchema = z.object({
  id: uuidSchema,
  startMs: z.number().int(),
  endMs: z.number().int(),
  speaker: z.string().nullable(),
  text: z.string(),
  sortOrder: z.number().int(),
});
export type TranscriptSegmentDto = z.infer<typeof transcriptSegmentDtoSchema>;

export const recordingDtoSchema = z.object({
  id: uuidSchema,
  source: recordingSourceSchema,
  title: z.string(),
  hasAudio: z.boolean(),
  contentType: z.string().nullable(),
  durationSeconds: z.number().int().nullable(),
  sizeBytes: z.number().int().nullable(),
  status: recordingStatusSchema,
  direction: callDirectionSchema.nullable(),
  fromNumber: z.string().nullable(),
  toNumber: z.string().nullable(),
  occurredAt: timestampSchema,
  transcriptStatus: transcriptStatusSchema,
  transcriptText: z.string().nullable(),
  transcriptLanguage: z.string().nullable(),
  transcriptError: z.string().nullable(),
  customerId: uuidSchema.nullable(),
  projectId: uuidSchema.nullable(),
  taskId: uuidSchema.nullable(),
  createdById: uuidSchema.nullable(),
  segments: z.array(transcriptSegmentDtoSchema),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type RecordingDto = z.infer<typeof recordingDtoSchema>;

const linkFields = {
  customerId: uuidSchema.optional(),
  projectId: uuidSchema.optional(),
  taskId: uuidSchema.optional(),
};

/** Voice-note upload metadata (multipart file + these query params). */
export const uploadVoiceNoteQuerySchema = z.object({
  title: z.string().trim().min(1).max(300),
  durationSeconds: z.coerce.number().int().min(0).max(86_400).optional(),
  occurredAt: isoDateTimeSchema.optional(),
  ...linkFields,
});
export type UploadVoiceNoteQuery = z.infer<typeof uploadVoiceNoteQuerySchema>;

/** A call log (no audio required). */
export const createCallLogBodySchema = z.object({
  title: z.string().trim().min(1).max(300),
  direction: callDirectionSchema,
  fromNumber: z.string().trim().max(40).optional(),
  toNumber: z.string().trim().max(40).optional(),
  durationSeconds: z.number().int().min(0).max(86_400).optional(),
  occurredAt: isoDateTimeSchema.optional(),
  notes: z.string().trim().max(10_000).optional(),
  ...linkFields,
});
export type CreateCallLogBody = z.infer<typeof createCallLogBodySchema>;

export const updateRecordingBodySchema = z
  .object({
    title: z.string().trim().min(1).max(300).optional(),
    occurredAt: isoDateTimeSchema.optional(),
    customerId: uuidSchema.nullable().optional(),
    projectId: uuidSchema.nullable().optional(),
    taskId: uuidSchema.nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });
export type UpdateRecordingBody = z.infer<typeof updateRecordingBodySchema>;

export const recordingListQuerySchema = z.object({
  source: recordingSourceSchema.optional(),
  status: recordingStatusSchema.optional(),
  customerId: uuidSchema.optional(),
  search: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type RecordingListQuery = z.infer<typeof recordingListQuerySchema>;

export const recordingIdParamsSchema = z.object({ recordingId: uuidSchema });
export type RecordingIdParams = z.infer<typeof recordingIdParamsSchema>;

/** Convert a recording into a task (defaults derive from the transcript). */
export const recordingToTaskBodySchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  assigneeId: uuidSchema.optional(),
  dueDate: isoDateTimeSchema.optional(),
});
export type RecordingToTaskBody = z.infer<typeof recordingToTaskBodySchema>;

/** Convert a recording into a DRAFT invoice line (requires a linked customer). */
export const recordingToInvoiceBodySchema = z.object({
  description: z.string().trim().min(1).max(500).optional(),
  unitPriceMinor: z.number().int().min(0).max(1_000_000_000_000).default(0),
  quantity: z.number().min(0).max(1_000_000).default(1),
  taxRatePercent: z.number().min(0).max(100).default(25),
});
export type RecordingToInvoiceBody = z.infer<typeof recordingToInvoiceBodySchema>;
