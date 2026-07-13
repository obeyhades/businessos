/**
 * Audit actions recorded in Phase 1. Later phases append to this list; values
 * are stable identifiers persisted in the database — never rename existing ones.
 */
export const AUDIT_ACTIONS = [
  'user.registered',
  'user.login',
  'user.login_failed',
  'user.logout',
  'user.password_reset_requested',
  'user.password_reset_completed',
  'user.password_changed',
  'user.profile_updated',
  'organization.created',
  'organization.updated',
  'organization.switched',
  'member.invited',
  'member.invitation_accepted',
  'member.invitation_revoked',
  'member.role_changed',
  'member.removed',
  // Phase 2
  'customer.created',
  'customer.updated',
  'customer.archived',
  'contact.created',
  'contact.updated',
  'contact.deleted',
  'project.created',
  'project.updated',
  'project.archived',
  'task.created',
  'task.updated',
  'task.completed',
  'task.deleted',
  'comment.created',
  'comment.deleted',
  'attachment.uploaded',
  'attachment.deleted',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];
