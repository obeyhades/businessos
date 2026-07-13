import { z } from 'zod';
import { uuidSchema } from './common.js';

export const SEARCH_RESULT_KINDS = ['customer', 'project', 'task', 'employee'] as const;
export const searchResultKindSchema = z.enum(SEARCH_RESULT_KINDS);
export type SearchResultKind = (typeof SEARCH_RESULT_KINDS)[number];

export const searchResultSchema = z.object({
  kind: searchResultKindSchema,
  id: uuidSchema,
  title: z.string(),
  subtitle: z.string().nullable(),
});
export type SearchResult = z.infer<typeof searchResultSchema>;

export const searchQuerySchema = z.object({
  q: z.string().trim().min(1).max(200),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type SearchQuery = z.infer<typeof searchQuerySchema>;

export const searchResponseSchema = z.object({
  results: z.array(searchResultSchema),
});
export type SearchResponse = z.infer<typeof searchResponseSchema>;
