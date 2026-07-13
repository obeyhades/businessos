import { z } from 'zod';
import { ASSIGNABLE_ROLES, ORGANIZATION_ROLES } from '../roles.js';
import { emailSchema, timestampSchema, uuidSchema } from './common.js';

export const memberDtoSchema = z.object({
  id: uuidSchema,
  role: z.enum(ORGANIZATION_ROLES),
  createdAt: timestampSchema,
  user: z.object({
    id: uuidSchema,
    name: z.string(),
    email: emailSchema,
  }),
});
export type MemberDto = z.infer<typeof memberDtoSchema>;

export const updateMemberRoleBodySchema = z.object({
  role: z.enum(ASSIGNABLE_ROLES),
});
export type UpdateMemberRoleBody = z.infer<typeof updateMemberRoleBodySchema>;

export const memberIdParamsSchema = z.object({
  memberId: uuidSchema,
});
export type MemberIdParams = z.infer<typeof memberIdParamsSchema>;
