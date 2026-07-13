import { z } from 'zod';

export const LOCALES = ['en', 'sv'] as const;
export type Locale = (typeof LOCALES)[number];
export const localeSchema = z.enum(LOCALES);

/** ISO 4217, e.g. SEK, EUR, USD. */
export const currencySchema = z
  .string()
  .length(3)
  .regex(/^[A-Z]{3}$/, 'Must be an ISO 4217 currency code');

/**
 * Minimum 10 characters. Length over composition rules per current NIST /
 * OWASP guidance; a maximum guards against DoS via huge argon2 inputs.
 */
export const passwordSchema = z.string().min(10).max(128);

export const emailSchema = z.string().trim().toLowerCase().email().max(254);

export const uuidSchema = z.string().uuid();

/** ISO 8601 timestamp — all API timestamps are UTC. */
export const timestampSchema = z.string().datetime();

export const errorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ErrorResponse = z.infer<typeof errorResponseSchema>;

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export function paginatedSchema<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    items: z.array(item),
    page: z.number().int(),
    pageSize: z.number().int(),
    totalItems: z.number().int(),
    totalPages: z.number().int(),
  });
}
export type Paginated<T> = {
  items: T[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
};
