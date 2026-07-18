import type { OrganizationRole } from './roles.js';

/**
 * All permissions the platform knows about. Grouped per module; permissions for
 * modules that ship in later phases are defined now so the matrix is reviewed
 * once and route guards can be written against stable names.
 */
export const PERMISSIONS = [
  // organization settings
  'org.read',
  'org.update',
  'org.delete',
  // memberships & invitations
  'members.read',
  'members.invite',
  'members.update_role',
  'members.remove',
  // audit
  'audit.read',
  // dashboard
  'dashboard.read',
  // customers & projects (Phase 2)
  'customers.read',
  'customers.manage',
  'projects.read',
  'projects.manage',
  'tasks.read',
  'tasks.manage',
  // personnel (Phase 3) — sensitive data has its own permission
  'personnel.read',
  'personnel.read_sensitive',
  'personnel.manage',
  // quotes & invoicing (Phase 4)
  'invoices.read',
  'invoices.manage',
  // bookkeeping (Phase 5)
  'accounting.read',
  'accounting.manage',
  'accounting.post',
  // calendar (Phase 6)
  'calendar.read',
  'calendar.manage',
  // email (Phase 7)
  'email.read',
  'email.send',
  // voice notes (Phase 8)
  'recordings.read',
  'recordings.manage',
  // integrations & compliance (Phase 9) — admin-level; webhook secrets and the
  // full event stream are sensitive, so these stay with OWNER/ADMIN only.
  'integrations.read',
  'integrations.manage',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ALL: readonly Permission[] = PERMISSIONS;

const READ_ONLY: readonly Permission[] = [
  'org.read',
  'members.read',
  'dashboard.read',
  'customers.read',
  'projects.read',
  'tasks.read',
  'personnel.read',
  'invoices.read',
  'accounting.read',
  'calendar.read',
  'email.read',
  'recordings.read',
];

/**
 * Code-defined permission matrix (ADR-0003). Custom roles are a later phase;
 * changing this matrix is a reviewed code change, which is what we want while
 * the permission surface is still growing.
 */
export const ROLE_PERMISSIONS: Record<OrganizationRole, readonly Permission[]> = {
  OWNER: ALL,
  ADMIN: ALL.filter((p) => p !== 'org.delete'),
  ACCOUNTANT: [
    'org.read',
    'members.read',
    'dashboard.read',
    'customers.read',
    'projects.read',
    'tasks.read',
    'invoices.read',
    'invoices.manage',
    'accounting.read',
    'accounting.manage',
    'accounting.post',
    'audit.read',
  ],
  MANAGER: [
    'org.read',
    'members.read',
    'dashboard.read',
    'customers.read',
    'customers.manage',
    'projects.read',
    'projects.manage',
    'tasks.read',
    'tasks.manage',
    'personnel.read',
    'personnel.manage',
    'invoices.read',
    'calendar.read',
    'calendar.manage',
    'email.read',
    'email.send',
    'recordings.read',
    'recordings.manage',
  ],
  EMPLOYEE: [
    'org.read',
    'members.read',
    'dashboard.read',
    'customers.read',
    'projects.read',
    'tasks.read',
    'tasks.manage',
    'calendar.read',
    'recordings.read',
  ],
  READONLY: READ_ONLY,
};

export function hasPermission(role: OrganizationRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}
