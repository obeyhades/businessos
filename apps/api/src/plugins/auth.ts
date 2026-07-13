import { hasPermission, type Permission } from '@businessos/types';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { errors } from '../lib/errors.js';
import { hashToken } from '../lib/tokens.js';
import { SESSION_COOKIE } from './security.js';

const LAST_USED_UPDATE_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Resolves the session cookie into request.currentUser / currentSession /
 * membership. The active organization comes exclusively from the server-side
 * session, and the membership is re-checked on every request so removed
 * members and role changes take effect immediately.
 */
export function registerAuthContext(app: FastifyInstance): void {
  app.decorateRequest('currentUser', null);
  app.decorateRequest('currentSession', null);
  app.decorateRequest('membership', null);

  app.addHook('onRequest', async (request) => {
    const rawToken = request.cookies[SESSION_COOKIE];
    if (!rawToken) return;

    const session = await app.prisma.session.findUnique({
      where: { tokenHash: hashToken(rawToken) },
      include: { user: true },
    });
    if (!session || session.expiresAt.getTime() <= Date.now()) return;

    const { user, ...sessionOnly } = session;
    request.currentSession = sessionOnly;
    request.currentUser = user;

    if (Date.now() - session.lastUsedAt.getTime() > LAST_USED_UPDATE_INTERVAL_MS) {
      // Best-effort activity timestamp; never fail the request over it.
      await app.prisma.session
        .update({ where: { id: session.id }, data: { lastUsedAt: new Date() } })
        .catch(() => undefined);
    }

    if (session.activeOrganizationId) {
      request.membership = await app.prisma.organizationMember.findUnique({
        where: {
          organizationId_userId: {
            organizationId: session.activeOrganizationId,
            userId: session.userId,
          },
        },
      });
    }
  });
}

/** preHandler: any authenticated user (no organization context required). */
export async function requireAuth(request: FastifyRequest): Promise<void> {
  if (!request.currentUser || !request.currentSession) throw errors.unauthorized();
}

/** preHandler factory: authenticated + active organization + permission. */
export function requirePermission(permission: Permission) {
  return async (request: FastifyRequest): Promise<void> => {
    if (!request.currentUser || !request.currentSession) throw errors.unauthorized();
    if (!request.membership) throw errors.noActiveOrganization();
    if (!hasPermission(request.membership.role, permission)) throw errors.forbidden();
  };
}

/** preHandler: platform operator (instance-level, not tenant-level). */
export async function requirePlatformAdmin(request: FastifyRequest): Promise<void> {
  if (!request.currentUser || !request.currentSession) throw errors.unauthorized();
  if (!request.currentUser.isPlatformAdmin) throw errors.forbidden();
}

/** Tenant context for handlers that passed requirePermission. */
export function orgContext(request: FastifyRequest): { organizationId: string; role: string } {
  const membership = request.membership;
  if (!membership) throw errors.noActiveOrganization();
  return { organizationId: membership.organizationId, role: membership.role };
}
