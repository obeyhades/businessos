import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  addMemberViaInvitation,
  api,
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

describe('role-based access control', () => {
  let owner: Actor;
  let employee: Actor;
  let accountant: Actor;
  let readonly: Actor;

  // Members join through the real invitation flow so the whole chain
  // (invite → outbox email → accept → membership role) is what gets tested.
  beforeEach(async () => {
    await truncateAll(ctx.prisma);
    owner = await createUser(ctx.app, 'owner@example.com');
    await createOrgViaApi(ctx.app, owner, 'RBAC Org');
    employee = await addMemberViaInvitation(ctx, owner, 'employee@example.com', 'EMPLOYEE');
    accountant = await addMemberViaInvitation(ctx, owner, 'accountant@example.com', 'ACCOUNTANT');
    readonly = await addMemberViaInvitation(ctx, owner, 'readonly@example.com', 'READONLY');
  });

  it('EMPLOYEE cannot create invitations (403)', async () => {
    const response = await api(ctx.app, 'POST', '/v1/organizations/current/invitations', {
      session: employee,
      body: { email: 'friend@example.com', role: 'EMPLOYEE' },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: 'forbidden' } });
  });

  it('EMPLOYEE cannot update the organization (403)', async () => {
    const response = await api(ctx.app, 'PATCH', '/v1/organizations/current', {
      session: employee,
      body: { name: 'Employee Was Here' },
    });
    expect(response.statusCode).toBe(403);
  });

  it('EMPLOYEE cannot read audit logs (403)', async () => {
    const response = await api(ctx.app, 'GET', '/v1/organizations/current/audit-logs', {
      session: employee,
    });
    expect(response.statusCode).toBe(403);
  });

  it('ACCOUNTANT can read audit logs (200)', async () => {
    const response = await api(ctx.app, 'GET', '/v1/organizations/current/audit-logs', {
      session: accountant,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ page: 1 });
  });

  it('READONLY cannot update the organization (403) but can list members (200)', async () => {
    const patch = await api(ctx.app, 'PATCH', '/v1/organizations/current', {
      session: readonly,
      body: { name: 'Readonly Was Here' },
    });
    expect(patch.statusCode).toBe(403);

    const members = await api(ctx.app, 'GET', '/v1/organizations/current/members', {
      session: readonly,
    });
    expect(members.statusCode).toBe(200);
    expect(members.json<{ items: unknown[] }>().items).toHaveLength(4);
  });
});
