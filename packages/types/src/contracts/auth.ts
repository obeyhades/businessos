import { z } from 'zod';
import { ORGANIZATION_ROLES } from '../roles.js';
import {
  currencySchema,
  emailSchema,
  localeSchema,
  passwordSchema,
  timestampSchema,
  uuidSchema,
} from './common.js';

export const userDtoSchema = z.object({
  id: uuidSchema,
  email: emailSchema,
  name: z.string(),
  locale: localeSchema,
  isPlatformAdmin: z.boolean(),
  createdAt: timestampSchema,
});
export type UserDto = z.infer<typeof userDtoSchema>;

export const organizationDtoSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  slug: z.string(),
  locale: localeSchema,
  currency: currencySchema,
  createdAt: timestampSchema,
});
export type OrganizationDto = z.infer<typeof organizationDtoSchema>;

export const membershipDtoSchema = z.object({
  organization: organizationDtoSchema,
  role: z.enum(ORGANIZATION_ROLES),
});
export type MembershipDto = z.infer<typeof membershipDtoSchema>;

export const sessionDtoSchema = z.object({
  user: userDtoSchema,
  memberships: z.array(membershipDtoSchema),
  activeOrganizationId: uuidSchema.nullable(),
});
export type SessionDto = z.infer<typeof sessionDtoSchema>;

export const registerBodySchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: z.string().trim().min(1).max(200),
  locale: localeSchema.default('en'),
});
export type RegisterBody = z.infer<typeof registerBodySchema>;

export const loginBodySchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
});
export type LoginBody = z.infer<typeof loginBodySchema>;

export const forgotPasswordBodySchema = z.object({
  email: emailSchema,
});
export type ForgotPasswordBody = z.infer<typeof forgotPasswordBodySchema>;

export const resetPasswordBodySchema = z.object({
  token: z.string().min(20).max(200),
  password: passwordSchema,
});
export type ResetPasswordBody = z.infer<typeof resetPasswordBodySchema>;
