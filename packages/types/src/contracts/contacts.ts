import { z } from 'zod';
import { emailSchema, timestampSchema, uuidSchema } from './common.js';

export const contactDtoSchema = z.object({
  id: uuidSchema,
  customerId: uuidSchema,
  name: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  title: z.string().nullable(),
  isPrimary: z.boolean(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type ContactDto = z.infer<typeof contactDtoSchema>;

const nullableTrimmed = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v.length === 0 ? null : v))
    .nullable()
    .optional();

export const createContactBodySchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.union([emailSchema, z.literal('')]).optional(),
  phone: nullableTrimmed(64),
  title: nullableTrimmed(120),
  isPrimary: z.boolean().default(false),
});
export type CreateContactBody = z.infer<typeof createContactBodySchema>;

export const updateContactBodySchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    email: z.union([emailSchema, z.literal('')]).optional(),
    phone: nullableTrimmed(64),
    title: nullableTrimmed(120),
    isPrimary: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'Nothing to update' });
export type UpdateContactBody = z.infer<typeof updateContactBodySchema>;

export const contactIdParamsSchema = z.object({
  customerId: uuidSchema,
  contactId: uuidSchema,
});
export type ContactIdParams = z.infer<typeof contactIdParamsSchema>;
