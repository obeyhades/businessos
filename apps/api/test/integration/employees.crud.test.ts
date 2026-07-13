import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ActivityDto, EmployeeDto, Paginated } from '@businessos/types';
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

describe('employee CRUD', () => {
  let owner: Actor;

  beforeEach(async () => {
    await truncateAll(ctx.prisma);
    owner = await createUser(ctx.app, 'owner@example.com');
    await createOrgViaApi(ctx.app, owner, 'Acme AB');
  });

  it('creates, gets, updates directory fields and deletes an employee', async () => {
    const created = await createEmployeeViaApi(ctx, owner, {
      firstName: 'Olivia',
      lastName: 'Ohlsson',
      jobTitle: 'Operations Manager',
      department: 'Operations',
    });
    expect(created).toMatchObject({ firstName: 'Olivia', jobTitle: 'Operations Manager' });

    const get = await api(ctx.app, 'GET', `/v1/employees/${created.id}`, { session: owner });
    expect(get.statusCode).toBe(200);
    expect(get.json<EmployeeDto>().id).toBe(created.id);

    const patch = await api(ctx.app, 'PATCH', `/v1/employees/${created.id}`, {
      session: owner,
      body: { jobTitle: 'Head of Operations' },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json<EmployeeDto>().jobTitle).toBe('Head of Operations');

    const del = await api(ctx.app, 'DELETE', `/v1/employees/${created.id}`, { session: owner });
    expect(del.statusCode).toBe(204);
    expect(
      (await api(ctx.app, 'GET', `/v1/employees/${created.id}`, { session: owner })).statusCode,
    ).toBe(404);
  });

  it('filters the list by status, department and search', async () => {
    await createEmployeeViaApi(ctx, owner, {
      firstName: 'Active',
      lastName: 'Carpenter',
      department: 'Field',
      employmentStatus: 'ACTIVE',
      jobTitle: 'Carpenter',
    });
    await createEmployeeViaApi(ctx, owner, {
      firstName: 'Leave',
      lastName: 'Electrician',
      department: 'Field',
      employmentStatus: 'ON_LEAVE',
      jobTitle: 'Electrician',
    });
    await createEmployeeViaApi(ctx, owner, {
      firstName: 'Office',
      lastName: 'Admin',
      department: 'Admin',
      employmentStatus: 'ACTIVE',
    });

    const byStatus = await api(ctx.app, 'GET', '/v1/employees?status=ON_LEAVE&pageSize=100', {
      session: owner,
    });
    const statusItems = byStatus.json<Paginated<EmployeeDto>>().items;
    expect(statusItems.every((e) => e.employmentStatus === 'ON_LEAVE')).toBe(true);
    expect(statusItems.map((e) => e.lastName)).toContain('Electrician');

    const byDept = await api(ctx.app, 'GET', '/v1/employees?department=Field&pageSize=100', {
      session: owner,
    });
    const deptItems = byDept.json<Paginated<EmployeeDto>>().items;
    expect(deptItems.every((e) => e.department === 'Field')).toBe(true);
    expect(deptItems).toHaveLength(2);

    const bySearch = await api(ctx.app, 'GET', '/v1/employees?search=electric&pageSize=100', {
      session: owner,
    });
    const searchItems = bySearch.json<Paginated<EmployeeDto>>().items;
    expect(searchItems.map((e) => e.lastName)).toContain('Electrician');
    expect(searchItems.map((e) => e.lastName)).not.toContain('Carpenter');
  });

  it('rejects an employee as their own manager (400 invalid_manager)', async () => {
    const employee = await createEmployeeViaApi(ctx, owner, { firstName: 'Self', lastName: 'Ref' });
    const response = await api(ctx.app, 'PATCH', `/v1/employees/${employee.id}`, {
      session: owner,
      body: { managerId: employee.id },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('invalid_manager');
  });

  it('rejects linking a userId that is not a member of the org (400 invalid_user)', async () => {
    // A user who exists but never joined this organization.
    const outsider = await createUser(ctx.app, 'outsider@example.com');
    const response = await api(ctx.app, 'POST', '/v1/employees', {
      session: owner,
      body: { firstName: 'Linked', lastName: 'Nope', userId: outsider.userId },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('invalid_user');
  });

  it('rejects linking a userId already linked to another employee (409 user_already_linked)', async () => {
    const member = await addMemberViaInvitation(ctx, owner, 'member@example.com', 'EMPLOYEE');
    await createEmployeeViaApi(ctx, owner, {
      firstName: 'First',
      lastName: 'Linked',
      userId: member.userId,
    });
    const response = await api(ctx.app, 'POST', '/v1/employees', {
      session: owner,
      body: { firstName: 'Second', lastName: 'Clash', userId: member.userId },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('user_already_linked');
  });

  it('activity timeline returns the created and status-changed rows', async () => {
    const employee = await createEmployeeViaApi(ctx, owner, {
      firstName: 'Timeline',
      lastName: 'Person',
      employmentStatus: 'ONBOARDING',
    });
    await api(ctx.app, 'PATCH', `/v1/employees/${employee.id}`, {
      session: owner,
      body: { employmentStatus: 'ACTIVE' },
    });

    const response = await api(ctx.app, 'GET', `/v1/employees/${employee.id}/activity`, {
      session: owner,
    });
    expect(response.statusCode).toBe(200);
    const types = response.json<Paginated<ActivityDto>>().items.map((a) => a.type);
    expect(types).toContain('employee.created');
    expect(types).toContain('employee.status_changed');
  });
});
