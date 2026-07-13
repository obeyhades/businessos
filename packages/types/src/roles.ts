export const ORGANIZATION_ROLES = [
  'OWNER',
  'ADMIN',
  'ACCOUNTANT',
  'MANAGER',
  'EMPLOYEE',
  'READONLY',
] as const;

export type OrganizationRole = (typeof ORGANIZATION_ROLES)[number];

/** Roles an inviter may assign. OWNER can only be granted by transferring ownership (future). */
export const ASSIGNABLE_ROLES = ['ADMIN', 'ACCOUNTANT', 'MANAGER', 'EMPLOYEE', 'READONLY'] as const;

export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];
