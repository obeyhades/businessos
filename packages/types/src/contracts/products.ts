import { z } from 'zod';
import { timestampSchema, uuidSchema } from './common.js';
import { currencySchema, nonNegativeMoneyMinorSchema, percentSchema } from './billing-common.js';

export const productDtoSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  description: z.string().nullable(),
  sku: z.string().nullable(),
  unit: z.string(),
  unitPriceMinor: z.number().int(),
  currency: currencySchema,
  taxRatePercent: z.number(),
  isActive: z.boolean(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type ProductDto = z.infer<typeof productDtoSchema>;

const nullableTrimmed = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v.length === 0 ? null : v))
    .nullable()
    .optional();

export const createProductBodySchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: nullableTrimmed(2000),
  sku: nullableTrimmed(64),
  unit: z.string().trim().min(1).max(32).default('piece'),
  unitPriceMinor: nonNegativeMoneyMinorSchema.default(0),
  currency: currencySchema.default('SEK'),
  taxRatePercent: percentSchema.default(25),
  isActive: z.boolean().default(true),
});
export type CreateProductBody = z.infer<typeof createProductBodySchema>;

export const updateProductBodySchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    description: nullableTrimmed(2000),
    sku: nullableTrimmed(64),
    unit: z.string().trim().min(1).max(32).optional(),
    unitPriceMinor: nonNegativeMoneyMinorSchema.optional(),
    currency: currencySchema.optional(),
    taxRatePercent: percentSchema.optional(),
    isActive: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'Nothing to update' });
export type UpdateProductBody = z.infer<typeof updateProductBodySchema>;

export const productListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  active: z.enum(['true', 'false']).optional(),
  search: z.string().trim().max(200).optional(),
});
export type ProductListQuery = z.infer<typeof productListQuerySchema>;

export const productIdParamsSchema = z.object({ productId: uuidSchema });
export type ProductIdParams = z.infer<typeof productIdParamsSchema>;
