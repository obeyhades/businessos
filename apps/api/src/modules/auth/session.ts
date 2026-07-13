import type { PrismaClient, Session, User } from '@businessos/db';
import type { SessionDto } from '@businessos/types';
import { generateToken, hashToken } from '../../lib/tokens.js';
import { toMembershipDto, toUserDto } from '../../lib/mappers.js';

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const SESSION_TTL_SECONDS = SESSION_TTL_MS / 1000;

export interface SessionMeta {
  ip?: string;
  userAgent?: string;
}

export async function createSession(
  prisma: PrismaClient,
  userId: string,
  activeOrganizationId: string | null,
  meta: SessionMeta,
): Promise<{ token: string; session: Session }> {
  const token = generateToken();
  const session = await prisma.session.create({
    data: {
      tokenHash: hashToken(token),
      userId,
      activeOrganizationId,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      ip: meta.ip ?? null,
      userAgent: meta.userAgent?.slice(0, 512) ?? null,
    },
  });
  return { token, session };
}

/** Picks the org a fresh session should start in: the only/first membership. */
export async function defaultOrganizationId(
  prisma: PrismaClient,
  userId: string,
): Promise<string | null> {
  const membership = await prisma.organizationMember.findFirst({
    where: { userId },
    orderBy: { createdAt: 'asc' },
    select: { organizationId: true },
  });
  return membership?.organizationId ?? null;
}

export async function buildSessionDto(
  prisma: PrismaClient,
  user: User,
  activeOrganizationId: string | null,
): Promise<SessionDto> {
  const memberships = await prisma.organizationMember.findMany({
    where: { userId: user.id },
    include: { organization: true },
    orderBy: { createdAt: 'asc' },
  });
  return {
    user: toUserDto(user),
    memberships: memberships.map(toMembershipDto),
    activeOrganizationId,
  };
}
