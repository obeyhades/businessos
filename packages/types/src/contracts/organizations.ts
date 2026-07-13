import { z } from 'zod';
import { currencySchema, localeSchema, uuidSchema } from './common.js';

export const createOrganizationBodySchema = z.object({
  name: z.string().trim().min(2).max(200),
  locale: localeSchema.default('en'),
  currency: currencySchema.default('SEK'),
});
export type CreateOrganizationBody = z.infer<typeof createOrganizationBodySchema>;

export const updateOrganizationBodySchema = z
  .object({
    name: z.string().trim().min(2).max(200).optional(),
    locale: localeSchema.optional(),
    currency: currencySchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'Nothing to update' });
export type UpdateOrganizationBody = z.infer<typeof updateOrganizationBodySchema>;

export const switchOrganizationBodySchema = z.object({
  organizationId: uuidSchema,
});
export type SwitchOrganizationBody = z.infer<typeof switchOrganizationBodySchema>;
