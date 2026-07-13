import { describe, expect, it } from 'vitest';
import { PERMISSIONS, ROLE_PERMISSIONS, hasPermission, type Permission } from './permissions.js';
import { ORGANIZATION_ROLES } from './roles.js';

const ALL_PERMISSIONS = new Set<Permission>(PERMISSIONS);

describe('permission matrix invariants', () => {
  it('covers every organization role', () => {
    for (const role of ORGANIZATION_ROLES) {
      expect(ROLE_PERMISSIONS[role]).toBeDefined();
    }
    expect(Object.keys(ROLE_PERMISSIONS).sort()).toEqual([...ORGANIZATION_ROLES].sort());
  });

  it("every role's permissions are a subset of PERMISSIONS", () => {
    for (const role of ORGANIZATION_ROLES) {
      for (const permission of ROLE_PERMISSIONS[role]) {
        expect(
          ALL_PERMISSIONS.has(permission),
          `${role} grants unknown permission ${permission}`,
        ).toBe(true);
      }
    }
  });

  it('no role has duplicate permissions', () => {
    for (const role of ORGANIZATION_ROLES) {
      const granted = ROLE_PERMISSIONS[role];
      expect(new Set(granted).size, `${role} has duplicate permissions`).toBe(granted.length);
    }
  });

  it('OWNER has every permission', () => {
    const owner = new Set(ROLE_PERMISSIONS.OWNER);
    for (const permission of PERMISSIONS) {
      expect(owner.has(permission), `OWNER is missing ${permission}`).toBe(true);
    }
    expect(owner.size).toBe(PERMISSIONS.length);
  });

  it('ADMIN has every permission except org.delete', () => {
    const admin = new Set(ROLE_PERMISSIONS.ADMIN);
    expect(admin.has('org.delete')).toBe(false);
    for (const permission of PERMISSIONS.filter((p) => p !== 'org.delete')) {
      expect(admin.has(permission), `ADMIN is missing ${permission}`).toBe(true);
    }
    expect(admin.size).toBe(PERMISSIONS.length - 1);
  });

  it('READONLY has no mutating permissions', () => {
    const mutatingSuffixes = ['.manage', '.invite', '.update_role', '.remove', '.post'];
    for (const permission of ROLE_PERMISSIONS.READONLY) {
      for (const suffix of mutatingSuffixes) {
        expect(permission.endsWith(suffix), `READONLY should not have ${permission}`).toBe(false);
      }
    }
    expect(ROLE_PERMISSIONS.READONLY).not.toContain('org.update');
    expect(ROLE_PERMISSIONS.READONLY).not.toContain('org.delete');
  });

  it('EMPLOYEE lacks members.invite and audit.read', () => {
    expect(ROLE_PERMISSIONS.EMPLOYEE).not.toContain('members.invite');
    expect(ROLE_PERMISSIONS.EMPLOYEE).not.toContain('audit.read');
  });
});

describe('hasPermission', () => {
  it('grants permissions the role holds', () => {
    expect(hasPermission('OWNER', 'org.delete')).toBe(true);
    expect(hasPermission('ADMIN', 'members.invite')).toBe(true);
    expect(hasPermission('ACCOUNTANT', 'audit.read')).toBe(true);
    expect(hasPermission('EMPLOYEE', 'tasks.manage')).toBe(true);
    expect(hasPermission('READONLY', 'members.read')).toBe(true);
  });

  it('denies permissions the role does not hold', () => {
    expect(hasPermission('ADMIN', 'org.delete')).toBe(false);
    expect(hasPermission('ACCOUNTANT', 'members.invite')).toBe(false);
    expect(hasPermission('MANAGER', 'audit.read')).toBe(false);
    expect(hasPermission('EMPLOYEE', 'members.invite')).toBe(false);
    expect(hasPermission('EMPLOYEE', 'audit.read')).toBe(false);
    expect(hasPermission('READONLY', 'org.update')).toBe(false);
  });

  it('agrees with the raw matrix for every role/permission combination', () => {
    for (const role of ORGANIZATION_ROLES) {
      const granted = new Set(ROLE_PERMISSIONS[role]);
      for (const permission of PERMISSIONS) {
        expect(hasPermission(role, permission)).toBe(granted.has(permission));
      }
    }
  });
});
