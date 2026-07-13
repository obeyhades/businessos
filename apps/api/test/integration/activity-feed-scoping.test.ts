import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ActivityDto, Paginated } from '@businessos/types';
import {
  addMemberViaInvitation,
  api,
  createCustomerViaApi,
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

async function fetchFeed(session: Actor): Promise<ActivityDto[]> {
  const response = await api(ctx.app, 'GET', '/v1/activity?pageSize=100', { session });
  expect(response.statusCode, response.body).toBe(200);
  return response.json<Paginated<ActivityDto>>().items;
}

// Regression: the org-wide activity feed must not leak personnel activity
// (employee names, sick-leave, document names) to roles without personnel.read.
describe('org-wide activity feed permission scoping', () => {
  let owner: Actor;
  let manager: Actor;
  let employeeMember: Actor;
  let accountant: Actor;

  beforeEach(async () => {
    await truncateAll(ctx.prisma);
    owner = await createUser(ctx.app, `owner+${Date.now()}@test.local`);
    await createOrgViaApi(ctx.app, owner, 'Feed Org');
    manager = await addMemberViaInvitation(ctx, owner, 'mgr@test.local', 'MANAGER');
    employeeMember = await addMemberViaInvitation(ctx, owner, 'emp@test.local', 'EMPLOYEE');
    accountant = await addMemberViaInvitation(ctx, owner, 'acc@test.local', 'ACCOUNTANT');

    // Non-personnel activity (visible to everyone with dashboard.read).
    await createCustomerViaApi(ctx, owner, { name: 'Acme' });
    // Personnel activity (employee.created carries the name).
    await createEmployeeViaApi(ctx, owner, { firstName: 'Secret', lastName: 'Hire' });
  });

  it('excludes personnel activity for roles without personnel.read', async () => {
    for (const member of [employeeMember, accountant]) {
      const feed = await fetchFeed(member);
      // No employee-linked rows may appear.
      expect(feed.every((a) => a.employeeId === null)).toBe(true);
      expect(feed.some((a) => a.type.startsWith('employee.'))).toBe(false);
      // Non-personnel activity is still visible.
      expect(feed.some((a) => a.type === 'customer.created')).toBe(true);
    }
  });

  it('includes personnel activity for roles with personnel.read', async () => {
    for (const member of [owner, manager]) {
      const feed = await fetchFeed(member);
      expect(feed.some((a) => a.type === 'employee.created' && a.employeeId !== null)).toBe(true);
    }
  });
});
