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
