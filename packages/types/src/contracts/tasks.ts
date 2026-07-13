import { z } from 'zod';
import { booleanQueryParam, timestampSchema, uuidSchema } from './common.js';

export const TASK_STATUSES = ['TODO', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'CANCELLED'] as const;
export const taskStatusSchema = z.enum(TASK_STATUSES);
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
export const taskPrioritySchema = z.enum(TASK_PRIORITIES);
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

const miniRef = z.object({ id: uuidSchema, name: z.string() });

export const taskDtoSchema = z.object({
  id: uuidSchema,
  title: z.string(),
  description: z.string().nullable(),
  status: taskStatusSchema,
  priority: taskPrioritySchema,
  dueDate: timestampSchema.nullable(),
  completedAt: timestampSchema.nullable(),
  customer: miniRef.nullable(),
  project: miniRef.nullable(),
  employee: miniRef.nullable(),
  assignee: z.object({ id: uuidSchema, name: z.string() }).nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type TaskDto = z.infer<typeof taskDtoSchema>;

const nullableTrimmed = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v.length === 0 ? null : v))
    .nullable()
    .optional();

export const createTaskBodySchema = z.object({
  title: z.string().trim().min(1).max(300),
  description: nullableTrimmed(5000),
  status: taskStatusSchema.default('TODO'),
  priority: taskPrioritySchema.default('MEDIUM'),
  dueDate: timestampSchema.nullable().optional(),
  customerId: uuidSchema.nullable().optional(),
  projectId: uuidSchema.nullable().optional(),
  assigneeId: uuidSchema.nullable().optional(),
});
export type CreateTaskBody = z.infer<typeof createTaskBodySchema>;

export const updateTaskBodySchema = z
  .object({
    title: z.string().trim().min(1).max(300).optional(),
    description: nullableTrimmed(5000),
    status: taskStatusSchema.optional(),
    priority: taskPrioritySchema.optional(),
    dueDate: timestampSchema.nullable().optional(),
    customerId: uuidSchema.nullable().optional(),
    projectId: uuidSchema.nullable().optional(),
    assigneeId: uuidSchema.nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'Nothing to update' });
export type UpdateTaskBody = z.infer<typeof updateTaskBodySchema>;

export const taskListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  status: taskStatusSchema.optional(),
  priority: taskPrioritySchema.optional(),
  assigneeId: uuidSchema.optional(),
  customerId: uuidSchema.optional(),
  projectId: uuidSchema.optional(),
  employeeId: uuidSchema.optional(),
  // 'me' resolves to the authenticated user server-side.
  mine: booleanQueryParam(false),
  search: z.string().trim().max(200).optional(),
});
export type TaskListQuery = z.infer<typeof taskListQuerySchema>;

export const taskIdParamsSchema = z.object({ taskId: uuidSchema });
export type TaskIdParams = z.infer<typeof taskIdParamsSchema>;
