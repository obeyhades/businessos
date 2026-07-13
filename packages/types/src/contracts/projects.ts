import { z } from 'zod';
import { timestampSchema, uuidSchema } from './common.js';

export const PROJECT_STATUSES = ['ACTIVE', 'ON_HOLD', 'COMPLETED', 'ARCHIVED'] as const;
export const projectStatusSchema = z.enum(PROJECT_STATUSES);
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const projectDtoSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  description: z.string().nullable(),
  status: projectStatusSchema,
  customer: z.object({ id: uuidSchema, name: z.string() }).nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type ProjectDto = z.infer<typeof projectDtoSchema>;

const nullableTrimmed = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v.length === 0 ? null : v))
    .nullable()
    .optional();

export const createProjectBodySchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: nullableTrimmed(5000),
  customerId: uuidSchema.nullable().optional(),
  status: projectStatusSchema.default('ACTIVE'),
});
export type CreateProjectBody = z.infer<typeof createProjectBodySchema>;

export const updateProjectBodySchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    description: nullableTrimmed(5000),
    customerId: uuidSchema.nullable().optional(),
    status: projectStatusSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'Nothing to update' });
export type UpdateProjectBody = z.infer<typeof updateProjectBodySchema>;

export const projectListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  status: projectStatusSchema.optional(),
  customerId: uuidSchema.optional(),
  search: z.string().trim().max(200).optional(),
});
export type ProjectListQuery = z.infer<typeof projectListQuerySchema>;

export const projectIdParamsSchema = z.object({ projectId: uuidSchema });
export type ProjectIdParams = z.infer<typeof projectIdParamsSchema>;
