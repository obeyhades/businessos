import { z } from 'zod';
import { emailSchema, timestampSchema, uuidSchema } from './common.js';

export const EMPLOYMENT_STATUSES = [
  'ONBOARDING',
  'ACTIVE',
  'ON_LEAVE',
  'OFFBOARDING',
  'TERMINATED',
] as const;
export const employmentStatusSchema = z.enum(EMPLOYMENT_STATUSES);
export type EmploymentStatus = (typeof EMPLOYMENT_STATUSES)[number];

export const EMPLOYMENT_TYPES = [
  'FULL_TIME',
  'PART_TIME',
  'CONTRACT',
  'INTERN',
  'TEMPORARY',
] as const;
export const employmentTypeSchema = z.enum(EMPLOYMENT_TYPES);
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

/** ISO date (no time), e.g. "2026-01-15". */
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be a date (YYYY-MM-DD)');

const miniRef = z.object({ id: uuidSchema, name: z.string() });

/**
 * Sensitive personal fields. Present on the detail DTO ONLY when the caller
 * holds personnel.read_sensitive; omitted entirely otherwise (the field is not
 * even serialized). This object is the single source of truth for what counts
 * as sensitive.
 */
export const employeeSensitiveSchema = z.object({
  personalIdNumber: z.string().nullable(),
  dateOfBirth: z.string().nullable(),
  homeAddress: z.string().nullable(),
  homePostalCode: z.string().nullable(),
  homeCity: z.string().nullable(),
  personalEmail: z.string().nullable(),
  personalPhone: z.string().nullable(),
  emergencyContactName: z.string().nullable(),
  emergencyContactPhone: z.string().nullable(),
  emergencyContactRelation: z.string().nullable(),
});
export type EmployeeSensitive = z.infer<typeof employeeSensitiveSchema>;

/** Directory tier — always readable with personnel.read. */
export const employeeDtoSchema = z.object({
  id: uuidSchema,
  firstName: z.string(),
  lastName: z.string(),
  workEmail: z.string().nullable(),
  workPhone: z.string().nullable(),
  jobTitle: z.string().nullable(),
  department: z.string().nullable(),
  employmentStatus: employmentStatusSchema,
  employmentType: employmentTypeSchema,
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  manager: miniRef.nullable(),
  user: z.object({ id: uuidSchema, name: z.string(), email: emailSchema }).nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  /** Present only when the caller has personnel.read_sensitive. */
  sensitive: employeeSensitiveSchema.optional(),
});
export type EmployeeDto = z.infer<typeof employeeDtoSchema>;

const nullableTrimmed = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v.length === 0 ? null : v))
    .nullable()
    .optional();

const sensitiveInput = {
  personalIdNumber: nullableTrimmed(64),
  dateOfBirth: dateSchema.nullable().optional(),
  homeAddress: nullableTrimmed(300),
  homePostalCode: nullableTrimmed(32),
  homeCity: nullableTrimmed(120),
  personalEmail: z.union([emailSchema, z.literal('')]).optional(),
  personalPhone: nullableTrimmed(64),
  emergencyContactName: nullableTrimmed(200),
  emergencyContactPhone: nullableTrimmed(64),
  emergencyContactRelation: nullableTrimmed(120),
};

export const createEmployeeBodySchema = z.object({
  firstName: z.string().trim().min(1).max(120),
  lastName: z.string().trim().min(1).max(120),
  workEmail: z.union([emailSchema, z.literal('')]).optional(),
  workPhone: nullableTrimmed(64),
  jobTitle: nullableTrimmed(160),
  department: nullableTrimmed(160),
  employmentStatus: employmentStatusSchema.default('ONBOARDING'),
  employmentType: employmentTypeSchema.default('FULL_TIME'),
  startDate: dateSchema.nullable().optional(),
  endDate: dateSchema.nullable().optional(),
  managerId: uuidSchema.nullable().optional(),
  userId: uuidSchema.nullable().optional(),
  ...sensitiveInput,
});
export type CreateEmployeeBody = z.infer<typeof createEmployeeBodySchema>;

export const updateEmployeeBodySchema = z
  .object({
    firstName: z.string().trim().min(1).max(120).optional(),
    lastName: z.string().trim().min(1).max(120).optional(),
    workEmail: z.union([emailSchema, z.literal('')]).optional(),
    workPhone: nullableTrimmed(64),
    jobTitle: nullableTrimmed(160),
    department: nullableTrimmed(160),
    employmentStatus: employmentStatusSchema.optional(),
    employmentType: employmentTypeSchema.optional(),
    startDate: dateSchema.nullable().optional(),
    endDate: dateSchema.nullable().optional(),
    managerId: uuidSchema.nullable().optional(),
    userId: uuidSchema.nullable().optional(),
    ...sensitiveInput,
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'Nothing to update' });
export type UpdateEmployeeBody = z.infer<typeof updateEmployeeBodySchema>;

/** Keys in the update/create body that belong to the sensitive tier. */
export const SENSITIVE_EMPLOYEE_FIELDS = Object.keys(sensitiveInput) as Array<
  keyof typeof sensitiveInput
>;

export const employeeListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  status: employmentStatusSchema.optional(),
  department: z.string().trim().max(160).optional(),
  managerId: uuidSchema.optional(),
  search: z.string().trim().max(200).optional(),
});
export type EmployeeListQuery = z.infer<typeof employeeListQuerySchema>;

export const employeeIdParamsSchema = z.object({ employeeId: uuidSchema });
export type EmployeeIdParams = z.infer<typeof employeeIdParamsSchema>;

export const applyTemplateBodySchema = z.object({
  templateId: uuidSchema,
  /** Who the generated tasks are assigned to; defaults server-side to the manager. */
  assigneeId: uuidSchema.nullable().optional(),
});
export type ApplyTemplateBody = z.infer<typeof applyTemplateBodySchema>;

export const applyTemplateResultSchema = z.object({
  createdTaskCount: z.number().int(),
});
export type ApplyTemplateResult = z.infer<typeof applyTemplateResultSchema>;
