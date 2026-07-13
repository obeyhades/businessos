import { z } from 'zod';
import { timestampSchema, uuidSchema } from './common.js';
import { isoDateSchema } from './billing-common.js';

export const PAYMENT_METHODS = ['CASH', 'BANK_TRANSFER', 'CARD', 'SWISH', 'OTHER'] as const;
export const paymentMethodSchema = z.enum(PAYMENT_METHODS);
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const paymentDtoSchema = z.object({
  id: uuidSchema,
  amountMinor: z.number().int(),
  method: paymentMethodSchema,
  reference: z.string().nullable(),
  paidOn: z.string(),
  note: z.string().nullable(),
  createdBy: z.object({ id: uuidSchema, name: z.string() }).nullable(),
  createdAt: timestampSchema,
});
export type PaymentDto = z.infer<typeof paymentDtoSchema>;

export const createPaymentBodySchema = z.object({
  // Positive minor units. Overpayment beyond the amount due is rejected.
  amountMinor: z.number().int().min(1).max(1_000_000_000_000),
  method: paymentMethodSchema.default('BANK_TRANSFER'),
  reference: z
    .string()
    .trim()
    .max(200)
    .transform((v) => (v.length === 0 ? null : v))
    .nullable()
    .optional(),
  paidOn: isoDateSchema,
  note: z
    .string()
    .trim()
    .max(2000)
    .transform((v) => (v.length === 0 ? null : v))
    .nullable()
    .optional(),
});
export type CreatePaymentBody = z.infer<typeof createPaymentBodySchema>;

export const paymentIdParamsSchema = z.object({
  invoiceId: uuidSchema,
  paymentId: uuidSchema,
});
export type PaymentIdParams = z.infer<typeof paymentIdParamsSchema>;
