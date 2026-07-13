import { z } from 'zod';
import { currencySchema, uuidSchema } from './common.js';

export { currencySchema };

/** Integer minor units (öre/cents). Safe-integer bounded. */
export const moneyMinorSchema = z.number().int().min(-1_000_000_000_000).max(1_000_000_000_000);
export const nonNegativeMoneyMinorSchema = z.number().int().min(0).max(1_000_000_000_000);

/** Quantity may be fractional (e.g. 2.5 hours). */
export const quantitySchema = z.number().min(0).max(1_000_000);
export const percentSchema = z.number().min(0).max(100);

/** ISO date (no time), e.g. "2026-01-15". Also rejects non-existent calendar
 *  days (e.g. 2026-02-30, 2026-13-01) that the shape check alone would let
 *  through and that Date parsing would silently roll into the next month. */
export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be a date (YYYY-MM-DD)')
  .refine((s) => {
    const [y, m, d] = s.split('-').map(Number) as [number, number, number];
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  }, 'Not a valid calendar date');

export const taxLineSchema = z.object({
  ratePercent: z.string(),
  baseMinor: z.number().int(),
  taxMinor: z.number().int(),
});
export type TaxLine = z.infer<typeof taxLineSchema>;

/** A line as returned to clients, with server-computed amounts. */
export const lineItemDtoSchema = z.object({
  id: uuidSchema,
  productId: uuidSchema.nullable(),
  description: z.string(),
  quantity: z.number(),
  unitPriceMinor: z.number().int(),
  discountPercent: z.number(),
  taxRatePercent: z.number(),
  lineNetMinor: z.number().int(),
  lineTaxMinor: z.number().int(),
  lineTotalMinor: z.number().int(),
});
export type LineItemDto = z.infer<typeof lineItemDtoSchema>;

/** A line as submitted by clients; amounts are computed server-side. */
export const lineItemInputSchema = z.object({
  productId: uuidSchema.nullable().optional(),
  description: z.string().trim().min(1).max(500),
  quantity: quantitySchema.default(1),
  unitPriceMinor: nonNegativeMoneyMinorSchema.default(0),
  discountPercent: percentSchema.default(0),
  taxRatePercent: percentSchema.default(0),
});
export type LineItemInput = z.infer<typeof lineItemInputSchema>;
