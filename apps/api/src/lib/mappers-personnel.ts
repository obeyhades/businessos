import type {
  AbsenceRequest,
  Certification,
  Employee,
  EmployeeDocument,
  EmployeeNote,
  OnboardingTemplate,
  OnboardingTemplateItem,
  User,
} from '@businessos/db';
import type {
  AbsenceRequestDto,
  AbsenceStatus,
  AbsenceType,
  CertificationDto,
  EmployeeDocumentCategory,
  EmployeeDocumentDto,
  EmployeeDto,
  EmployeeNoteDto,
  EmploymentStatus,
  EmploymentType,
  OnboardingTemplateDto,
} from '@businessos/types';

type MiniUser = Pick<User, 'id' | 'name'>;
type MiniEmployee = Pick<Employee, 'id' | 'firstName' | 'lastName'>;

function employeeName(e: MiniEmployee): { id: string; name: string } {
  return { id: e.id, name: `${e.firstName} ${e.lastName}`.trim() };
}

function isoDate(value: Date | null): string | null {
  // @db.Date columns come back as a Date at UTC midnight; take the date part.
  return value ? value.toISOString().slice(0, 10) : null;
}

export interface EmployeeRelations {
  manager: MiniEmployee | null;
  user: Pick<User, 'id' | 'name' | 'email'> | null;
}

/**
 * Directory-tier serialization. Sensitive personal fields are attached ONLY
 * when `includeSensitive` is true — the caller (route) passes that after
 * checking personnel.read_sensitive. When false, the `sensitive` key is absent
 * entirely, so the data never leaves the process.
 */
export function toEmployeeDto(
  employee: Employee & EmployeeRelations,
  options: { includeSensitive: boolean },
): EmployeeDto {
  const dto: EmployeeDto = {
    id: employee.id,
    firstName: employee.firstName,
    lastName: employee.lastName,
    workEmail: employee.workEmail,
    workPhone: employee.workPhone,
    jobTitle: employee.jobTitle,
    department: employee.department,
    employmentStatus: employee.employmentStatus as EmploymentStatus,
    employmentType: employee.employmentType as EmploymentType,
    startDate: isoDate(employee.startDate),
    endDate: isoDate(employee.endDate),
    manager: employee.manager ? employeeName(employee.manager) : null,
    user: employee.user
      ? { id: employee.user.id, name: employee.user.name, email: employee.user.email }
      : null,
    createdAt: employee.createdAt.toISOString(),
    updatedAt: employee.updatedAt.toISOString(),
  };

  if (options.includeSensitive) {
    dto.sensitive = {
      personalIdNumber: employee.personalIdNumber,
      dateOfBirth: isoDate(employee.dateOfBirth),
      homeAddress: employee.homeAddress,
      homePostalCode: employee.homePostalCode,
      homeCity: employee.homeCity,
      personalEmail: employee.personalEmail,
      personalPhone: employee.personalPhone,
      emergencyContactName: employee.emergencyContactName,
      emergencyContactPhone: employee.emergencyContactPhone,
      emergencyContactRelation: employee.emergencyContactRelation,
    };
  }
  return dto;
}

export function toEmployeeNoteDto(
  note: EmployeeNote & { author: MiniUser | null },
): EmployeeNoteDto {
  return {
    id: note.id,
    body: note.body,
    author: note.author ? { id: note.author.id, name: note.author.name } : null,
    createdAt: note.createdAt.toISOString(),
  };
}

export function toCertificationDto(cert: Certification): CertificationDto {
  return {
    id: cert.id,
    name: cert.name,
    issuer: cert.issuer,
    issuedDate: isoDate(cert.issuedDate),
    expiresAt: isoDate(cert.expiresAt),
    notes: cert.notes,
    createdAt: cert.createdAt.toISOString(),
  };
}

export function toAbsenceRequestDto(
  absence: AbsenceRequest & { employee: MiniEmployee; reviewedBy: MiniUser | null },
): AbsenceRequestDto {
  return {
    id: absence.id,
    employee: employeeName(absence.employee),
    type: absence.type as AbsenceType,
    status: absence.status as AbsenceStatus,
    startDate: isoDate(absence.startDate) ?? '',
    endDate: isoDate(absence.endDate) ?? '',
    reason: absence.reason,
    reviewedBy: absence.reviewedBy
      ? { id: absence.reviewedBy.id, name: absence.reviewedBy.name }
      : null,
    reviewedAt: absence.reviewedAt?.toISOString() ?? null,
    reviewNote: absence.reviewNote,
    createdAt: absence.createdAt.toISOString(),
  };
}

export function toEmployeeDocumentDto(
  doc: EmployeeDocument & { uploadedBy: MiniUser | null },
): EmployeeDocumentDto {
  return {
    id: doc.id,
    fileName: doc.fileName,
    contentType: doc.contentType,
    size: doc.size,
    category: doc.category as EmployeeDocumentCategory,
    isSensitive: doc.isSensitive,
    uploadedBy: doc.uploadedBy ? { id: doc.uploadedBy.id, name: doc.uploadedBy.name } : null,
    createdAt: doc.createdAt.toISOString(),
  };
}

export function toOnboardingTemplateDto(
  template: OnboardingTemplate & { items: OnboardingTemplateItem[] },
): OnboardingTemplateDto {
  return {
    id: template.id,
    name: template.name,
    description: template.description,
    type: template.type as OnboardingTemplateDto['type'],
    items: [...template.items]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((item) => ({
        id: item.id,
        title: item.title,
        description: item.description,
        dueOffsetDays: item.dueOffsetDays,
        sortOrder: item.sortOrder,
      })),
    createdAt: template.createdAt.toISOString(),
    updatedAt: template.updatedAt.toISOString(),
  };
}

export { employeeName, isoDate };
