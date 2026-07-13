import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { hasPermission } from '@businessos/types';
import type { EmployeeDto, Paginated } from '@businessos/types';
import {
  addMemberViaInvitation,
  api,
  createEmployeeViaApi,
  createOrgViaApi,
  createTestContext,
  createUser,
  destroyTestContext,
  truncateAll,
  type Actor,
  type TestContext,
} from './helpers.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});

afterAll(async () => {
  await destroyTestContext(ctx);
});

// The two-tier sensitivity model is the defining invariant of Phase 3:
// personnel.read exposes the directory; personnel.read_sensitive is required
// for the extra `sensitive` block, internal notes, and sensitive documents.
// MANAGER holds read + manage but NOT read_sensitive.
describe('sensitive personnel data gating', () => {
  let owner: Actor;
  let manager: Actor;
  let readonly: Actor;
  let accountant: Actor;
  let employee: EmployeeDto;

  const SENSITIVE_INPUT = {
    personalIdNumber: '19900101-1234',
    homeAddress: 'Storgatan 1',
    emergencyContactPhone: '+46700000000',
  };

  beforeEach(async () => {
    await truncateAll(ctx.prisma);
    owner = await createUser(ctx.app, 'owner@example.com');
    await createOrgViaApi(ctx.app, owner, 'Acme AB');
    manager = await addMemberViaInvitation(ctx, owner, 'manager@example.com', 'MANAGER');
    readonly = await addMemberViaInvitation(ctx, owner, 'readonly@example.com', 'READONLY');
    accountant = await addMemberViaInvitation(ctx, owner, 'accountant@example.com', 'ACCOUNTANT');
    employee = await createEmployeeViaApi(ctx, owner, {
      firstName: 'Sofia',
      lastName: 'Sensitive',
      ...SENSITIVE_INPUT,
    });
  });

  it('confirms the matrix intent the suite relies on', () => {
    expect(hasPermission('OWNER', 'personnel.read_sensitive')).toBe(true);
    expect(hasPermission('ADMIN', 'personnel.read_sensitive')).toBe(true);
    expect(hasPermission('MANAGER', 'personnel.read')).toBe(true);
    expect(hasPermission('MANAGER', 'personnel.manage')).toBe(true);
    expect(hasPermission('MANAGER', 'personnel.read_sensitive')).toBe(false);
    expect(hasPermission('READONLY', 'personnel.read')).toBe(true);
    expect(hasPermission('READONLY', 'personnel.manage')).toBe(false);
    expect(hasPermission('ACCOUNTANT', 'personnel.read')).toBe(false);
  });

  it('OWNER detail includes the sensitive block with the stored values', async () => {
    const response = await api(ctx.app, 'GET', `/v1/employees/${employee.id}`, { session: owner });
    expect(response.statusCode).toBe(200);
    const dto = response.json<EmployeeDto>();
    expect(dto.sensitive).toBeDefined();
    expect(dto.sensitive).toMatchObject({
      personalIdNumber: SENSITIVE_INPUT.personalIdNumber,
      homeAddress: SENSITIVE_INPUT.homeAddress,
      emergencyContactPhone: SENSITIVE_INPUT.emergencyContactPhone,
    });
  });

  it('OWNER list never carries a sensitive key on any item', async () => {
    const response = await api(ctx.app, 'GET', '/v1/employees?pageSize=100', { session: owner });
    expect(response.statusCode).toBe(200);
    const page = response.json<Paginated<EmployeeDto>>();
    expect(page.items.length).toBeGreaterThan(0);
    for (const item of page.items) {
      expect(item).not.toHaveProperty('sensitive');
    }
  });

  it('MANAGER detail omits the sensitive key entirely', async () => {
    const response = await api(ctx.app, 'GET', `/v1/employees/${employee.id}`, {
      session: manager,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<EmployeeDto>()).not.toHaveProperty('sensitive');
  });

  it('MANAGER cannot read or create internal notes (403)', async () => {
    const list = await api(ctx.app, 'GET', `/v1/employees/${employee.id}/notes`, {
      session: manager,
    });
    expect(list.statusCode).toBe(403);
    const create = await api(ctx.app, 'POST', `/v1/employees/${employee.id}/notes`, {
      session: manager,
      body: { body: 'should not be allowed' },
    });
    expect(create.statusCode).toBe(403);
    expect(await ctx.prisma.employeeNote.count()).toBe(0);
  });

  it('MANAGER PATCH with a sensitive field is forbidden but directory-only PATCH succeeds', async () => {
    const blocked = await api(ctx.app, 'PATCH', `/v1/employees/${employee.id}`, {
      session: manager,
      body: { personalIdNumber: '19801231-9999' },
    });
    expect(blocked.statusCode).toBe(403);
    // The sensitive value is untouched.
    const row = await ctx.prisma.employee.findUniqueOrThrow({ where: { id: employee.id } });
    expect(row.personalIdNumber).toBe(SENSITIVE_INPUT.personalIdNumber);

    const allowed = await api(ctx.app, 'PATCH', `/v1/employees/${employee.id}`, {
      session: manager,
      body: { jobTitle: 'Site Lead' },
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json<EmployeeDto>().jobTitle).toBe('Site Lead');
  });

  it('MANAGER POST with a sensitive field in the body is forbidden (403)', async () => {
    const response = await api(ctx.app, 'POST', '/v1/employees', {
      session: manager,
      body: { firstName: 'New', lastName: 'Hire', personalIdNumber: '19770707-0000' },
    });
    expect(response.statusCode).toBe(403);
  });

  it('MANAGER can create a directory-only employee (201, no sensitive echoed back)', async () => {
    const response = await api(ctx.app, 'POST', '/v1/employees', {
      session: manager,
      body: { firstName: 'Plain', lastName: 'Directory', jobTitle: 'Carpenter' },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json<EmployeeDto>()).not.toHaveProperty('sensitive');
  });

  it('READONLY can read list and detail (no sensitive) but cannot create (403)', async () => {
    const list = await api(ctx.app, 'GET', '/v1/employees', { session: readonly });
    expect(list.statusCode).toBe(200);

    const detail = await api(ctx.app, 'GET', `/v1/employees/${employee.id}`, {
      session: readonly,
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json<EmployeeDto>()).not.toHaveProperty('sensitive');

    const create = await api(ctx.app, 'POST', '/v1/employees', {
      session: readonly,
      body: { firstName: 'No', lastName: 'Way' },
    });
    expect(create.statusCode).toBe(403);
  });

  it('ACCOUNTANT (no personnel perms) is forbidden from the directory (403)', async () => {
    const list = await api(ctx.app, 'GET', '/v1/employees', { session: accountant });
    expect(list.statusCode).toBe(403);
    const detail = await api(ctx.app, 'GET', `/v1/employees/${employee.id}`, {
      session: accountant,
    });
    expect(detail.statusCode).toBe(403);
  });
});
