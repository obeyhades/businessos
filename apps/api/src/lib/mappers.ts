import type { AuditLog, Invitation, Organization, OrganizationMember, User } from '@businessos/db';
import type {
  AuditAction,
  AssignableRole,
  AuditLogDto,
  InvitationDto,
  Locale,
  MemberDto,
  MembershipDto,
  OrganizationDto,
  UserDto,
} from '@businessos/types';

/** DB stores locale as free string; the API contract narrows it. */
function toLocale(value: string): Locale {
  return value === 'sv' ? 'sv' : 'en';
}

export function toUserDto(user: User): UserDto {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    locale: toLocale(user.locale),
    isPlatformAdmin: user.isPlatformAdmin,
    createdAt: user.createdAt.toISOString(),
  };
}

export function toOrganizationDto(org: Organization): OrganizationDto {
  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    locale: toLocale(org.locale),
    currency: org.currency,
    createdAt: org.createdAt.toISOString(),
  };
}

export function toMembershipDto(
  member: OrganizationMember & { organization: Organization },
): MembershipDto {
  return {
    organization: toOrganizationDto(member.organization),
    role: member.role,
  };
}

export function toMemberDto(member: OrganizationMember & { user: User }): MemberDto {
  return {
    id: member.id,
    role: member.role,
    createdAt: member.createdAt.toISOString(),
    user: { id: member.user.id, name: member.user.name, email: member.user.email },
  };
}

export function toInvitationDto(
  invitation: Invitation & { invitedBy: User | null },
): InvitationDto {
  return {
    id: invitation.id,
    email: invitation.email,
    role: invitation.role as AssignableRole,
    expiresAt: invitation.expiresAt.toISOString(),
    createdAt: invitation.createdAt.toISOString(),
    invitedBy: invitation.invitedBy
      ? { id: invitation.invitedBy.id, name: invitation.invitedBy.name }
      : null,
  };
}

export function toAuditLogDto(log: AuditLog & { actor: User | null }): AuditLogDto {
  return {
    id: log.id,
    action: log.action as AuditAction,
    entityType: log.entityType,
    entityId: log.entityId,
    metadata: (log.metadata as Record<string, unknown> | null) ?? null,
    ip: log.ip,
    createdAt: log.createdAt.toISOString(),
    actor: log.actor ? { id: log.actor.id, name: log.actor.name } : null,
  };
}
