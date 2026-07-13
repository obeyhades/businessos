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

describe('members', () => {
  let owner: Actor;
  let admin: Actor;
  let orgId: string;
  let ownerMemberId: string;

  beforeEach(async () => {
    await truncateAll(ctx.prisma);
    owner = await createUser(ctx.app, 'owner@example.com');
    orgId = (await createOrgViaApi(ctx.app, owner, 'Members Org')).id;
    admin = await addMemberViaInvitation(ctx, owner, 'admin@example.com', 'ADMIN');
    ownerMemberId = (
      await ctx.prisma.organizationMember.findUniqueOrThrow({
        where: { organizationId_userId: { organizationId: orgId, userId: owner.userId } },
      })
    ).id;
  });

  it('the owner cannot be role-changed (403)', async () => {
    const response = await api(
      ctx.app,
      'PATCH',
      `/v1/organizations/current/members/${ownerMemberId}`,
      { session: admin, body: { role: 'EMPLOYEE' } },
    );
    expect(response.statusCode).toBe(403);

    const unchanged = await ctx.prisma.organizationMember.findUniqueOrThrow({
      where: { id: ownerMemberId },
    });
    expect(unchanged.role).toBe('OWNER');
  });

  it('the owner cannot be removed (403)', async () => {
    const response = await api(
      ctx.app,
      'DELETE',
      `/v1/organizations/current/members/${ownerMemberId}`,
      { session: admin },
    );
    expect(response.statusCode).toBe(403);
    expect(await ctx.prisma.organizationMember.count({ where: { id: ownerMemberId } })).toBe(1);
  });

  it('changing your own role returns 400', async () => {
    const response = await api(
      ctx.app,
      'PATCH',
      `/v1/organizations/current/members/${ownerMemberId}`,
      { session: owner, body: { role: 'ADMIN' } },
    );
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: 'cannot_change_own_role' } });
  });

  it('a role change by an authorized member persists and is audited', async () => {
    const employee = await addMemberViaInvitation(ctx, owner, 'employee@example.com', 'EMPLOYEE');
    const employeeMember = await ctx.prisma.organizationMember.findUniqueOrThrow({
      where: { organizationId_userId: { organizationId: orgId, userId: employee.userId } },
    });

    const response = await api(
      ctx.app,
      'PATCH',
      `/v1/organizations/current/members/${employeeMember.id}`,
      { session: owner, body: { role: 'MANAGER' } },
    );
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ role: 'MANAGER' });

    const audit = await ctx.prisma.auditLog.findFirst({
      where: { action: 'member.role_changed', organizationId: orgId },
    });
    expect(audit?.metadata).toMatchObject({ from: 'EMPLOYEE', to: 'MANAGER' });
  });

  it("removing a member detaches their sessions' activeOrganizationId", async () => {
    const employee = await addMemberViaInvitation(ctx, owner, 'employee@example.com', 'EMPLOYEE');
    const employeeMember = await ctx.prisma.organizationMember.findUniqueOrThrow({
      where: { organizationId_userId: { organizationId: orgId, userId: employee.userId } },
    });

    // Accepting the invitation pointed the employee's session at this org.
    const sessionsBefore = await ctx.prisma.session.findMany({
      where: { userId: employee.userId },
    });
    expect(sessionsBefore.some((s) => s.activeOrganizationId === orgId)).toBe(true);

    const response = await api(
      ctx.app,
      'DELETE',
      `/v1/organizations/current/members/${employeeMember.id}`,
      { session: owner },
    );
    expect(response.statusCode).toBe(204);

    expect(await ctx.prisma.organizationMember.count({ where: { id: employeeMember.id } })).toBe(0);
    const sessionsAfter = await ctx.prisma.session.findMany({
      where: { userId: employee.userId },
    });
    expect(sessionsAfter.length).toBeGreaterThan(0);
    for (const session of sessionsAfter) {
      expect(session.activeOrganizationId).toBeNull();
    }
  });
});
