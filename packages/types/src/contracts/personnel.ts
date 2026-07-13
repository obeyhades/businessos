import { z } from 'zod';
import { timestampSchema, uuidSchema } from './common.js';

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be a date (YYYY-MM-DD)');
const nullableTrimmed = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v.length === 0 ? null : v))
    .nullable()
    .optional();

// --- Employee notes (restricted: personnel.read_sensitive) ---
export const employeeNoteDtoSchema = z.object({
  id: uuidSchema,
  body: z.string(),
  author: z.object({ id: uuidSchema, name: z.string() }).nullable(),
  createdAt: timestampSchema,
});
export type EmployeeNoteDto = z.infer<typeof employeeNoteDtoSchema>;

export const createEmployeeNoteBodySchema = z.object({
  body: z.string().trim().min(1).max(10000),
});
export type CreateEmployeeNoteBody = z.infer<typeof createEmployeeNoteBodySchema>;

export const employeeNoteIdParamsSchema = z.object({
  employeeId: uuidSchema,
  noteId: uuidSchema,
});
export type EmployeeNoteIdParams = z.infer<typeof employeeNoteIdParamsSchema>;

// --- Certifications ---
export const certificationDtoSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  issuer: z.string().nullable(),
  issuedDate: z.string().nullable(),
  expiresAt: z.string().nullable(),
  notes: z.string().nullable(),
  createdAt: timestampSchema,
});
export type CertificationDto = z.infer<typeof certificationDtoSchema>;

export const createCertificationBodySchema = z.object({
  name: z.string().trim().min(1).max(200),
  issuer: nullableTrimmed(200),
  issuedDate: dateSchema.nullable().optional(),
  expiresAt: dateSchema.nullable().optional(),
  notes: nullableTrimmed(2000),
});
export type CreateCertificationBody = z.infer<typeof createCertificationBodySchema>;

export const updateCertificationBodySchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    issuer: nullableTrimmed(200),
    issuedDate: dateSchema.nullable().optional(),
    expiresAt: dateSchema.nullable().optional(),
    notes: nullableTrimmed(2000),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'Nothing to update' });
export type UpdateCertificationBody = z.infer<typeof updateCertificationBodySchema>;

export const certificationIdParamsSchema = z.object({
  employeeId: uuidSchema,
  certificationId: uuidSchema,
});
export type CertificationIdParams = z.infer<typeof certificationIdParamsSchema>;

/** Certifications expiring within a window — for the dashboard. */
export const expiringCertificationDtoSchema = certificationDtoSchema.extend({
  employee: z.object({ id: uuidSchema, name: z.string() }),
});
export type ExpiringCertificationDto = z.infer<typeof expiringCertificationDtoSchema>;

export const expiringCertificationsQuerySchema = z.object({
  withinDays: z.coerce.number().int().min(1).max(365).default(60),
});
export type ExpiringCertificationsQuery = z.infer<typeof expiringCertificationsQuerySchema>;

// --- Absence requests ---
export const ABSENCE_TYPES = ['VACATION', 'SICK', 'PARENTAL', 'UNPAID', 'OTHER'] as const;
export const absenceTypeSchema = z.enum(ABSENCE_TYPES);
export type AbsenceType = (typeof ABSENCE_TYPES)[number];

export const ABSENCE_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] as const;
export const absenceStatusSchema = z.enum(ABSENCE_STATUSES);
export type AbsenceStatus = (typeof ABSENCE_STATUSES)[number];

export const absenceRequestDtoSchema = z.object({
  id: uuidSchema,
  employee: z.object({ id: uuidSchema, name: z.string() }),
  type: absenceTypeSchema,
  status: absenceStatusSchema,
  startDate: z.string(),
  endDate: z.string(),
  reason: z.string().nullable(),
  reviewedBy: z.object({ id: uuidSchema, name: z.string() }).nullable(),
  reviewedAt: timestampSchema.nullable(),
  reviewNote: z.string().nullable(),
  createdAt: timestampSchema,
});
export type AbsenceRequestDto = z.infer<typeof absenceRequestDtoSchema>;

export const createAbsenceRequestBodySchema = z
  .object({
    type: absenceTypeSchema,
    startDate: dateSchema,
    endDate: dateSchema,
    reason: nullableTrimmed(2000),
  })
  .refine((v) => v.endDate >= v.startDate, {
    message: 'End date must be on or after start date',
    path: ['endDate'],
  });
export type CreateAbsenceRequestBody = z.infer<typeof createAbsenceRequestBodySchema>;

export const reviewAbsenceBodySchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  reviewNote: nullableTrimmed(2000),
});
export type ReviewAbsenceBody = z.infer<typeof reviewAbsenceBodySchema>;

export const absenceListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  status: absenceStatusSchema.optional(),
  employeeId: uuidSchema.optional(),
});
export type AbsenceListQuery = z.infer<typeof absenceListQuerySchema>;

export const absenceIdParamsSchema = z.object({ absenceId: uuidSchema });
export type AbsenceIdParams = z.infer<typeof absenceIdParamsSchema>;
export const employeeAbsenceParamsSchema = z.object({ employeeId: uuidSchema });
export type EmployeeAbsenceParams = z.infer<typeof employeeAbsenceParamsSchema>;

// --- Employee documents ---
export const EMPLOYEE_DOCUMENT_CATEGORIES = [
  'CONTRACT',
  'IDENTIFICATION',
  'CERTIFICATE',
  'POLICY',
  'OTHER',
] as const;
export const employeeDocumentCategorySchema = z.enum(EMPLOYEE_DOCUMENT_CATEGORIES);
export type EmployeeDocumentCategory = (typeof EMPLOYEE_DOCUMENT_CATEGORIES)[number];

export const employeeDocumentDtoSchema = z.object({
  id: uuidSchema,
  fileName: z.string(),
  contentType: z.string(),
  size: z.number().int(),
  category: employeeDocumentCategorySchema,
  isSensitive: z.boolean(),
  uploadedBy: z.object({ id: uuidSchema, name: z.string() }).nullable(),
  createdAt: timestampSchema,
});
export type EmployeeDocumentDto = z.infer<typeof employeeDocumentDtoSchema>;

export const employeeDocumentIdParamsSchema = z.object({
  employeeId: uuidSchema,
  documentId: uuidSchema,
});
export type EmployeeDocumentIdParams = z.infer<typeof employeeDocumentIdParamsSchema>;
