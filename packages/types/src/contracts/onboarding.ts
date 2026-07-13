import { z } from 'zod';
import { timestampSchema, uuidSchema } from './common.js';

export const CHECKLIST_TYPES = ['ONBOARDING', 'OFFBOARDING'] as const;
export const checklistTypeSchema = z.enum(CHECKLIST_TYPES);
export type ChecklistType = (typeof CHECKLIST_TYPES)[number];

export const templateItemDtoSchema = z.object({
  id: uuidSchema,
  title: z.string(),
  description: z.string().nullable(),
  dueOffsetDays: z.number().int(),
  sortOrder: z.number().int(),
});
export type TemplateItemDto = z.infer<typeof templateItemDtoSchema>;

export const onboardingTemplateDtoSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  description: z.string().nullable(),
  type: checklistTypeSchema,
  items: z.array(templateItemDtoSchema),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type OnboardingTemplateDto = z.infer<typeof onboardingTemplateDtoSchema>;

const templateItemInputSchema = z.object({
  title: z.string().trim().min(1).max(300),
  description: z
    .string()
    .trim()
    .max(2000)
    .transform((v) => (v.length === 0 ? null : v))
    .nullable()
    .optional(),
  dueOffsetDays: z.number().int().min(0).max(3650).default(0),
});

export const createTemplateBodySchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z
    .string()
    .trim()
    .max(2000)
    .transform((v) => (v.length === 0 ? null : v))
    .nullable()
    .optional(),
  type: checklistTypeSchema.default('ONBOARDING'),
  items: z.array(templateItemInputSchema).max(100).default([]),
});
export type CreateTemplateBody = z.infer<typeof createTemplateBodySchema>;

export const updateTemplateBodySchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    description: z
      .string()
      .trim()
      .max(2000)
      .transform((v) => (v.length === 0 ? null : v))
      .nullable()
      .optional(),
    type: checklistTypeSchema.optional(),
    // When provided, the item list is replaced wholesale.
    items: z.array(templateItemInputSchema).max(100).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'Nothing to update' });
export type UpdateTemplateBody = z.infer<typeof updateTemplateBodySchema>;

export const templateIdParamsSchema = z.object({ templateId: uuidSchema });
export type TemplateIdParams = z.infer<typeof templateIdParamsSchema>;
