import { z } from 'zod';
import { timestampSchema, uuidSchema } from './common.js';
import {
  currencySchema,
  isoDateSchema,
  lineItemDtoSchema,
  lineItemInputSchema,
  taxLineSchema,
} from './billing-common.js';

export const INVOICE_STATUSES = [
  'DRAFT',
  'OPEN',
  'SENT',
  'PARTIALLY_PAID',
  'PAID',
  'OVERDUE',
  'CANCELLED',
  'CREDITED',
] as const;
export const invoiceStatusSchema = z.enum(INVOICE_STATUSES);
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

const miniRef = z.object({ id: uuidSchema, name: z.string() });

export const invoiceDtoSchema = z.object({
  id: uuidSchema,
  number: z.string().nullable(),
  status: invoiceStatusSchema,
  currency: currencySchema,
  issueDate: z.string(),
  dueDate: z.string(),
  customer: miniRef,
  customerNotes: z.string().nullable(),
  internalNotes: z.string().nullable(),
  subtotalMinor: z.number().int(),
  discountMinor: z.number().int(),
  taxMinor: z.number().int(),
  totalMinor: z.number().int(),
  amountPaidMinor: z.number().int(),
  creditedMinor: z.number().int(),
  /** Derived: total − paid − credited. */
  amountDueMinor: z.number().int(),
  taxLines: z.array(taxLineSchema),
  lineItems: z.array(lineItemDtoSchema),
  /** Derived: past due date and still owing. */
  isOverdue: z.boolean(),
  hasPdf: z.boolean(),
  fromQuoteId: uuidSchema.nullable(),
  finalizedAt: timestampSchema.nullable(),
  sentAt: timestampSchema.nullable(),
  paidAt: timestampSchema.nullable(),
  cancelledAt: timestampSchema.nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type InvoiceDto = z.infer<typeof invoiceDtoSchema>;

const nullableTrimmed = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v.length === 0 ? null : v))
    .nullable()
    .optional();

export const createInvoiceBodySchema = z.object({
  customerId: uuidSchema,
  currency: currencySchema.default('SEK'),
  issueDate: isoDateSchema,
  dueDate: isoDateSchema,
  customerNotes: nullableTrimmed(5000),
  internalNotes: nullableTrimmed(5000),
  lineItems: z.array(lineItemInputSchema).min(1).max(200),
});
export type CreateInvoiceBody = z.infer<typeof createInvoiceBodySchema>;

/** Draft invoices only. Providing lineItems replaces the whole set. */
export const updateInvoiceBodySchema = z
  .object({
    customerId: uuidSchema.optional(),
    currency: currencySchema.optional(),
    issueDate: isoDateSchema.optional(),
    dueDate: isoDateSchema.optional(),
    customerNotes: nullableTrimmed(5000),
    internalNotes: nullableTrimmed(5000),
    lineItems: z.array(lineItemInputSchema).min(1).max(200).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'Nothing to update' });
export type UpdateInvoiceBody = z.infer<typeof updateInvoiceBodySchema>;

export const invoiceListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  status: invoiceStatusSchema.optional(),
  customerId: uuidSchema.optional(),
  search: z.string().trim().max(200).optional(),
});
export type InvoiceListQuery = z.infer<typeof invoiceListQuerySchema>;

export const invoiceIdParamsSchema = z.object({ invoiceId: uuidSchema });
export type InvoiceIdParams = z.infer<typeof invoiceIdParamsSchema>;

/** Optional recipient override; defaults to the customer's email. */
export const sendInvoiceBodySchema = z.object({
  to: z.string().email().optional(),
});
export type SendInvoiceBody = z.infer<typeof sendInvoiceBodySchema>;
