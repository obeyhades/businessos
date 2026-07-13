import { z } from 'zod';
import { localeSchema, passwordSchema } from './common.js';

export const updateProfileBodySchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    locale: localeSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'Nothing to update' });
export type UpdateProfileBody = z.infer<typeof updateProfileBodySchema>;

export const changePasswordBodySchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
});
export type ChangePasswordBody = z.infer<typeof changePasswordBodySchema>;
