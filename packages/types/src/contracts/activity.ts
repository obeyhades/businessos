import { z } from 'zod';
import { ACTIVITY_TYPES } from '../activity.js';
import { timestampSchema, uuidSchema } from './common.js';

export const activityDtoSchema = z.object({
  id: uuidSchema,
  type: z.enum(ACTIVITY_TYPES),
  actor: z.object({ id: uuidSchema, name: z.string() }).nullable(),
  customerId: uuidSchema.nullable(),
  projectId: uuidSchema.nullable(),
  taskId: uuidSchema.nullable(),
  metadata: z.record(z.unknown()).nullable(),
  createdAt: timestampSchema,
});
export type ActivityDto = z.infer<typeof activityDtoSchema>;
