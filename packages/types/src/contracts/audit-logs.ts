import { z } from 'zod';
import { AUDIT_ACTIONS } from '../audit.js';
import { timestampSchema, uuidSchema } from './common.js';

export const auditLogDtoSchema = z.object({
  id: uuidSchema,
  action: z.enum(AUDIT_ACTIONS),
  entityType: z.string().nullable(),
  entityId: z.string().nullable(),
  metadata: z.record(z.unknown()).nullable(),
  ip: z.string().nullable(),
  createdAt: timestampSchema,
  actor: z.object({ id: uuidSchema, name: z.string() }).nullable(),
});
export type AuditLogDto = z.infer<typeof auditLogDtoSchema>;
