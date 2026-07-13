import type { OrganizationMember, PrismaClient, Session, User } from '@businessos/db';
import type { ApiConfig } from './config.js';
import type { ObjectStorage } from './lib/storage.js';

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
    config: ApiConfig;
    storage: ObjectStorage;
  }
  interface FastifyRequest {
    currentUser: User | null;
    currentSession: Session | null;
    /** Membership for the session's active organization — the tenant context. */
    membership: OrganizationMember | null;
  }
}
