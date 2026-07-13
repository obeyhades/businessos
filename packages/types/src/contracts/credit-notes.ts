import { z } from 'zod';
import { timestampSchema, uuidSchema } from './common.js';
import {
  currencySchema,
  isoDateSchema,
  nonNegativeMoneyMinorSchema,
  percentSchema,
  quantitySchema,
  taxLineSchema,
} from './billing-common.js';

export const CREDIT_NOTE_STATUSES = ['DRAFT', 'ISSUED'] as const;
export const creditNoteStatusSchema = z.enum(CREDIT_NOTE_STATUSES);
export type CreditNoteStatus = (typeof CREDIT_NOTE_STATUSES)[number];

export const creditNoteLineItemDtoSchema = z.object({
  id: uuidSchema,
  description: z.string(),
  quantity: z.number(),
  unitPriceMinor: z.number().int(),
  taxRatePercent: z.number(),
  lineNetMinor: z.number().int(),
  lineTaxMinor: z.number().int(),
  lineTotalMinor: z.number().int(),
});
export type CreditNoteLineItemDto = z.infer<typeof creditNoteLineItemDtoSchema>;

export const creditNoteDtoSchema = z.object({
  id: uuidSchema,
  invoiceId: uuidSchema,
  number: z.string().nullable(),
  status: creditNoteStatusSchema,
  currency: currencySchema,
  issueDate: z.string(),
  reason: z.string().nullable(),
  subtotalMinor: z.number().int(),
  taxMinor: z.number().int(),
  totalMinor: z.number().int(),
  taxLines: z.array(taxLineSchema),
  lineItems: z.array(creditNoteLineItemDtoSchema),
  issuedAt: timestampSchema.nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type CreditNoteDto = z.infer<typeof creditNoteDtoSchema>;

export const creditNoteLineInputSchema = z.object({
  description: z.string().trim().min(1).max(500),
  quantity: quantitySchema.default(1),
  unitPriceMinor: nonNegativeMoneyMinorSchema.default(0),
  taxRatePercent: percentSchema.default(0),
});
export type CreditNoteLineInput = z.infer<typeof creditNoteLineInputSchema>;

/**
 * Credit note against a finalized invoice. Omit lineItems to credit the full
 * invoice (its lines are mirrored); provide lineItems for a partial credit.
 * Total credited across notes may not exceed the invoice total.
 */
export const createCreditNoteBodySchema = z.object({
  issueDate: isoDateSchema.optional(),
  reason: z
    .string()
    .trim()
    .max(2000)
    .transform((v) => (v.length === 0 ? null : v))
    .nullable()
    .optional(),
  lineItems: z.array(creditNoteLineInputSchema).min(1).max(200).optional(),
});
export type CreateCreditNoteBody = z.infer<typeof createCreditNoteBodySchema>;

export const creditNoteIdParamsSchema = z.object({
  invoiceId: uuidSchema,
  creditNoteId: uuidSchema,
});
export type CreditNoteIdParams = z.infer<typeof creditNoteIdParamsSchema>;
