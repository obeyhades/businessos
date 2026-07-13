import { z } from 'zod';
import { emailSchema, timestampSchema, uuidSchema } from './common.js';

export const CUSTOMER_STATUSES = ['LEAD', 'ACTIVE', 'ARCHIVED'] as const;
export const customerStatusSchema = z.enum(CUSTOMER_STATUSES);
export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number];

export const customerDtoSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  orgNumber: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  addressLine1: z.string().nullable(),
  addressLine2: z.string().nullable(),
  postalCode: z.string().nullable(),
  city: z.string().nullable(),
  country: z.string().nullable(),
  notes: z.string().nullable(),
  status: customerStatusSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type CustomerDto = z.infer<typeof customerDtoSchema>;

// Accepts empty string from a cleared form field and stores null.
const nullableTrimmed = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v.length === 0 ? null : v))
    .nullable()
    .optional();

export const createCustomerBodySchema = z.object({
  name: z.string().trim().min(1).max(200),
  orgNumber: nullableTrimmed(64),
  email: z.union([emailSchema, z.literal('')]).optional(),
  phone: nullableTrimmed(64),
  addressLine1: nullableTrimmed(200),
  addressLine2: nullableTrimmed(200),
  postalCode: nullableTrimmed(32),
  city: nullableTrimmed(120),
  country: nullableTrimmed(120),
  notes: nullableTrimmed(5000),
  status: customerStatusSchema.default('ACTIVE'),
});
export type CreateCustomerBody = z.infer<typeof createCustomerBodySchema>;

export const updateCustomerBodySchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    orgNumber: nullableTrimmed(64),
    email: z.union([emailSchema, z.literal('')]).optional(),
    phone: nullableTrimmed(64),
    addressLine1: nullableTrimmed(200),
    addressLine2: nullableTrimmed(200),
    postalCode: nullableTrimmed(32),
    city: nullableTrimmed(120),
    country: nullableTrimmed(120),
    notes: nullableTrimmed(5000),
    status: customerStatusSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'Nothing to update' });
export type UpdateCustomerBody = z.infer<typeof updateCustomerBodySchema>;

export const customerListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  status: customerStatusSchema.optional(),
  search: z.string().trim().max(200).optional(),
});
export type CustomerListQuery = z.infer<typeof customerListQuerySchema>;

export const customerIdParamsSchema = z.object({ customerId: uuidSchema });
export type CustomerIdParams = z.infer<typeof customerIdParamsSchema>;
