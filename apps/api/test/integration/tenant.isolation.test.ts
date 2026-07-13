import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { MemberDto, Paginated } from '@businessos/types';
import {
  api,
  createOrgViaApi,
  createTestContext,
  createUser,
  destroyTestContext,
  inviteViaApi,
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

describe('tenant isolation', () => {
  let userA: Actor;
  let userB: Actor;
  let orgAId: string;
  let orgBId: string;

  beforeEach(async () => {
    await truncateAll(ctx.prisma);
    userA = await createUser(ctx.app, 'owner-a@example.com');
    userB = await createUser(ctx.app, 'owner-b@example.com');
    orgAId = (await createOrgViaApi(ctx.app, userA, 'Org Alpha')).id;
    orgBId = (await createOrgViaApi(ctx.app, userB, 'Org Beta')).id;
  });

  it("B's members list never contains org A rows", async () => {
    const response = await api(ctx.app, 'GET', '/v1/organizations/current/members', {
      session: userB,
    });
    expect(response.statusCode).toBe(200);
    const page = response.json<Paginated<MemberDto>>();
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.user.id).toBe(userB.userId);

    const orgAMemberIds = (
      await ctx.prisma.organizationMember.findMany({ where: { organizationId: orgAId } })
    ).map((m) => m.id);
    for (const item of page.items) {
      expect(orgAMemberIds).not.toContain(item.id);
    }
  });

  it('A cannot PATCH a membership belonging to org B (404)', async () => {
    const memberB = await ctx.prisma.organizationMember.findFirstOrThrow({
      where: { organizationId: orgBId },
    });
    const response = await api(
      ctx.app,
      'PATCH',
      `/v1/organizations/current/members/${memberB.id}`,
      { session: userA, body: { role: 'ADMIN' } },
    );
    expect(response.statusCode).toBe(404);

    const unchanged = await ctx.prisma.organizationMember.findUniqueOrThrow({
      where: { id: memberB.id },
    });
    expect(unchanged.role).toBe('OWNER');
  });

  it('A cannot DELETE a membership belonging to org B (404)', async () => {
    const memberB = await ctx.prisma.organizationMember.findFirstOrThrow({
      where: { organizationId: orgBId },
    });
    const response = await api(
      ctx.app,
      'DELETE',
      `/v1/organizations/current/members/${memberB.id}`,
      { session: userA },
    );
    expect(response.statusCode).toBe(404);
    expect(await ctx.prisma.organizationMember.count({ where: { id: memberB.id } })).toBe(1);
  });

  it('A cannot switch the active organization to org B (403)', async () => {
    const response = await api(ctx.app, 'POST', '/v1/organizations/switch', {
      session: userA,
      body: { organizationId: orgBId },
    });
    expect(response.statusCode).toBe(403);

    // The session must still point at org A.
    const session = await api(ctx.app, 'GET', '/v1/auth/session', { session: userA });
    expect(session.json()).toMatchObject({ activeOrganizationId: orgAId });
  });

  it("A's audit log listing only contains organizationId A rows", async () => {
    // Generate org-scoped audit activity in both tenants.
    await api(ctx.app, 'PATCH', '/v1/organizations/current', {
      session: userA,
      body: { name: 'Org Alpha Renamed' },
    });
    await api(ctx.app, 'PATCH', '/v1/organizations/current', {
      session: userB,
      body: { name: 'Org Beta Renamed' },
    });

    const response = await api(
      ctx.app,
      'GET',
      '/v1/organizations/current/audit-logs?page=1&pageSize=100',
      { session: userA },
    );
    expect(response.statusCode).toBe(200);
    const page = response.json<Paginated<{ id: string }>>();
    expect(page.items.length).toBeGreaterThan(0);

    // Verify every returned row against the database.
    const orgARows = new Set(
      (await ctx.prisma.auditLog.findMany({ where: { organizationId: orgAId } })).map((r) => r.id),
    );
    for (const item of page.items) {
      expect(orgARows.has(item.id), `audit row ${item.id} does not belong to org A`).toBe(true);
    }
    expect(page.totalItems).toBe(orgARows.size);

    // Sanity: org B does have audit rows that were correctly excluded.
    expect(await ctx.prisma.auditLog.count({ where: { organizationId: orgBId } })).toBeGreaterThan(
      0,
    );
  });

  it("an invitation created in org A cannot be revoked through B's session (404)", async () => {
    const { invitation } = await inviteViaApi(ctx, userA, 'newhire@example.com', 'EMPLOYEE');

    const response = await api(
      ctx.app,
      'DELETE',
      `/v1/organizations/current/invitations/${invitation.id}`,
      { session: userB },
    );
    expect(response.statusCode).toBe(404);

    const row = await ctx.prisma.invitation.findUniqueOrThrow({ where: { id: invitation.id } });
    expect(row.revokedAt).toBeNull();
  });
});
