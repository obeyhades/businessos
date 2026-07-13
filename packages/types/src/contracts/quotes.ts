import { z } from 'zod';
import { timestampSchema, uuidSchema } from './common.js';
import {
  currencySchema,
  isoDateSchema,
  lineItemDtoSchema,
  lineItemInputSchema,
  taxLineSchema,
} from './billing-common.js';

export const QUOTE_STATUSES = ['DRAFT', 'SENT', 'ACCEPTED', 'DECLINED', 'EXPIRED'] as const;
export const quoteStatusSchema = z.enum(QUOTE_STATUSES);
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

const miniRef = z.object({ id: uuidSchema, name: z.string() });

export const quoteDtoSchema = z.object({
  id: uuidSchema,
  number: z.string().nullable(),
  status: quoteStatusSchema,
  currency: currencySchema,
  issueDate: z.string(),
  validUntil: z.string().nullable(),
  customer: miniRef,
  customerNotes: z.string().nullable(),
  internalNotes: z.string().nullable(),
  subtotalMinor: z.number().int(),
  discountMinor: z.number().int(),
  taxMinor: z.number().int(),
  totalMinor: z.number().int(),
  taxLines: z.array(taxLineSchema),
  lineItems: z.array(lineItemDtoSchema),
  acceptedAt: timestampSchema.nullable(),
  convertedInvoiceId: uuidSchema.nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type QuoteDto = z.infer<typeof quoteDtoSchema>;

const nullableTrimmed = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v.length === 0 ? null : v))
    .nullable()
    .optional();

export const createQuoteBodySchema = z.object({
  customerId: uuidSchema,
  currency: currencySchema.default('SEK'),
  issueDate: isoDateSchema,
  validUntil: isoDateSchema.nullable().optional(),
  customerNotes: nullableTrimmed(5000),
  internalNotes: nullableTrimmed(5000),
  lineItems: z.array(lineItemInputSchema).min(1).max(200),
});
export type CreateQuoteBody = z.infer<typeof createQuoteBodySchema>;

/** Draft quotes only. Providing lineItems replaces the whole set. */
export const updateQuoteBodySchema = z
  .object({
    customerId: uuidSchema.optional(),
    currency: currencySchema.optional(),
    issueDate: isoDateSchema.optional(),
    validUntil: isoDateSchema.nullable().optional(),
    customerNotes: nullableTrimmed(5000),
    internalNotes: nullableTrimmed(5000),
    lineItems: z.array(lineItemInputSchema).min(1).max(200).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'Nothing to update' });
export type UpdateQuoteBody = z.infer<typeof updateQuoteBodySchema>;

export const quoteListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  status: quoteStatusSchema.optional(),
  customerId: uuidSchema.optional(),
  search: z.string().trim().max(200).optional(),
});
export type QuoteListQuery = z.infer<typeof quoteListQuerySchema>;

export const quoteIdParamsSchema = z.object({ quoteId: uuidSchema });
export type QuoteIdParams = z.infer<typeof quoteIdParamsSchema>;
