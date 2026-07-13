import { z } from 'zod';
import { timestampSchema, uuidSchema } from './common.js';

export const ENTITY_KINDS = ['customer', 'project', 'task'] as const;
export const entityKindSchema = z.enum(ENTITY_KINDS);
export type EntityKind = (typeof ENTITY_KINDS)[number];

export const commentDtoSchema = z.object({
  id: uuidSchema,
  body: z.string(),
  author: z.object({ id: uuidSchema, name: z.string() }).nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type CommentDto = z.infer<typeof commentDtoSchema>;

export const createCommentBodySchema = z.object({
  body: z.string().trim().min(1).max(10000),
});
export type CreateCommentBody = z.infer<typeof createCommentBodySchema>;

/** Comments hang off a parent entity: /v1/{entityKind}s/{entityId}/comments */
export const commentParentParamsSchema = z.object({
  entityKind: entityKindSchema,
  entityId: uuidSchema,
});
export type CommentParentParams = z.infer<typeof commentParentParamsSchema>;

export const commentIdParamsSchema = z.object({
  entityKind: entityKindSchema,
  entityId: uuidSchema,
  commentId: uuidSchema,
});
export type CommentIdParams = z.infer<typeof commentIdParamsSchema>;
