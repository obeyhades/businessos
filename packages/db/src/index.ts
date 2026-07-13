import { PrismaClient, Prisma, OrganizationRole } from '@prisma/client';

export { PrismaClient, Prisma, OrganizationRole };
export type {
  User,
  Organization,
  OrganizationMember,
  Session,
  Invitation,
  PasswordResetToken,
  AuditLog,
  OutboxMessage,
  ProcessedMessage,
  FailedJob,
  // Phase 2
  Customer,
  CustomerContact,
  Project,
  Task,
  Comment,
  FileAttachment,
  Activity,
  // Phase 3
  Employee,
  EmployeeNote,
  Certification,
  AbsenceRequest,
  EmployeeDocument,
  OnboardingTemplate,
  OnboardingTemplateItem,
  // Phase 4
  Product,
  Quote,
  QuoteLineItem,
  Invoice,
  InvoiceLineItem,
  Payment,
  CreditNote,
  CreditNoteLineItem,
  NumberSequence,
  // Phase 5
  Account,
  FiscalYear,
  FiscalPeriod,
  Voucher,
  VoucherLine,
  VoucherAttachment,
  AccountMapping,
  // Phase 6
  Calendar,
  CalendarEvent,
  EventAttendee,
  EventReminder,
  EventException,
  SentReminder,
} from '@prisma/client';
export {
  CustomerStatus,
  ProjectStatus,
  TaskStatus,
  TaskPriority,
  // Phase 3
  EmploymentStatus,
  EmploymentType,
  AbsenceType,
  AbsenceStatus,
  EmployeeDocumentCategory,
  ChecklistType,
  // Phase 4
  QuoteStatus,
  InvoiceStatus,
  PaymentMethod,
  CreditNoteStatus,
  NumberSequenceKind,
  // Phase 5
  AccountType,
  FiscalPeriodStatus,
  VoucherStatus,
  VoucherSource,
  // Phase 6
  CalendarType,
  EventStatus,
  EventVisibility,
  AttendeeResponse,
  ReminderMethod,
  RecurrenceFreq,
  ExceptionType,
} from '@prisma/client';

export interface CreatePrismaClientOptions {
  databaseUrl: string;
  logQueries?: boolean;
}

export function createPrismaClient(options: CreatePrismaClientOptions): PrismaClient {
  return new PrismaClient({
    datasources: { db: { url: options.databaseUrl } },
    log: options.logQueries ? ['query', 'warn', 'error'] : ['warn', 'error'],
  });
}
