import { z } from 'zod';
import { ASSIGNABLE_ROLES } from '../roles.js';
import { emailSchema, timestampSchema, uuidSchema } from './common.js';

export const invitationDtoSchema = z.object({
  id: uuidSchema,
  email: emailSchema,
  role: z.enum(ASSIGNABLE_ROLES),
  expiresAt: timestampSchema,
  createdAt: timestampSchema,
  invitedBy: z.object({ id: uuidSchema, name: z.string() }).nullable(),
});
export type InvitationDto = z.infer<typeof invitationDtoSchema>;

export const createInvitationBodySchema = z.object({
  email: emailSchema,
  role: z.enum(ASSIGNABLE_ROLES),
});
export type CreateInvitationBody = z.infer<typeof createInvitationBodySchema>;

export const invitationIdParamsSchema = z.object({
  invitationId: uuidSchema,
});
export type InvitationIdParams = z.infer<typeof invitationIdParamsSchema>;

export const invitationTokenParamsSchema = z.object({
  token: z.string().min(20).max(200),
});
export type InvitationTokenParams = z.infer<typeof invitationTokenParamsSchema>;

/** Public preview shown on the accept-invitation page before login/registration. */
export const invitationPreviewDtoSchema = z.object({
  organizationName: z.string(),
  email: emailSchema,
  role: z.enum(ASSIGNABLE_ROLES),
  expiresAt: timestampSchema,
});
export type InvitationPreviewDto = z.infer<typeof invitationPreviewDtoSchema>;
