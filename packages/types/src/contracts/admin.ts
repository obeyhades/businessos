import { z } from 'zod';
import { timestampSchema, uuidSchema } from './common.js';

/**
 * Dead-lettered background jobs. Platform-operator scope (not tenant data):
 * requires the isPlatformAdmin flag, never just an organization role.
 */
export const failedJobDtoSchema = z.object({
  id: uuidSchema,
  queue: z.string(),
  messageType: z.string(),
  error: z.string(),
  attempts: z.number().int(),
  payload: z.unknown(),
  failedAt: timestampSchema,
  retriedAt: timestampSchema.nullable(),
});
export type FailedJobDto = z.infer<typeof failedJobDtoSchema>;

export const failedJobIdParamsSchema = z.object({
  failedJobId: uuidSchema,
});
export type FailedJobIdParams = z.infer<typeof failedJobIdParamsSchema>;
