import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  acceptInvitation,
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

describe('invitations', () => {
  let owner: Actor;
  let orgId: string;

  beforeEach(async () => {
    await truncateAll(ctx.prisma);
    owner = await createUser(ctx.app, 'owner@example.com');
    orgId = (await createOrgViaApi(ctx.app, owner, 'Invite Org')).id;
  });

  it('accept with a mismatched email returns 403', async () => {
    const { token } = await inviteViaApi(ctx, owner, 'invited@example.com', 'EMPLOYEE');
    const impostor = await createUser(ctx.app, 'impostor@example.com');

    const response = await acceptInvitation(ctx.app, impostor, token);
    expect(response.statusCode).toBe(403);
    expect(
      await ctx.prisma.organizationMember.count({
        where: { organizationId: orgId, userId: impostor.userId },
      }),
    ).toBe(0);
  });

  it('accepting the same invitation twice returns 409 for the acceptor', async () => {
    const { token } = await inviteViaApi(ctx, owner, 'invited@example.com', 'EMPLOYEE');
    const invitee = await createUser(ctx.app, 'invited@example.com');

    const first = await acceptInvitation(ctx.app, invitee, token);
    expect(first.statusCode).toBe(200);

    const second = await acceptInvitation(ctx.app, invitee, token);
    expect(second.statusCode).toBe(409);
  });

  it('a revoked invitation returns 404 on preview and accept', async () => {
    const { invitation, token } = await inviteViaApi(ctx, owner, 'invited@example.com', 'EMPLOYEE');

    const revoke = await api(
      ctx.app,
      'DELETE',
      `/v1/organizations/current/invitations/${invitation.id}`,
      { session: owner },
    );
    expect(revoke.statusCode).toBe(204);

    const preview = await api(ctx.app, 'GET', `/v1/invitations/${token}`);
    expect(preview.statusCode).toBe(404);

    const invitee = await createUser(ctx.app, 'invited@example.com');
    const accept = await acceptInvitation(ctx.app, invitee, token);
    expect(accept.statusCode).toBe(404);
  });

  it('an expired invitation returns 404 on preview and accept', async () => {
    const { invitation, token } = await inviteViaApi(ctx, owner, 'invited@example.com', 'EMPLOYEE');
    await ctx.prisma.invitation.update({
      where: { id: invitation.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const preview = await api(ctx.app, 'GET', `/v1/invitations/${token}`);
    expect(preview.statusCode).toBe(404);

    const invitee = await createUser(ctx.app, 'invited@example.com');
    const accept = await acceptInvitation(ctx.app, invitee, token);
    expect(accept.statusCode).toBe(404);
  });

  it('a pending invitation previews without authentication', async () => {
    const { token } = await inviteViaApi(ctx, owner, 'invited@example.com', 'ACCOUNTANT');
    const preview = await api(ctx.app, 'GET', `/v1/invitations/${token}`);
    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toMatchObject({
      organizationName: 'Invite Org',
      email: 'invited@example.com',
      role: 'ACCOUNTANT',
    });
  });

  it('accepting creates the membership with the invited role and writes audit + outbox rows', async () => {
    const { token } = await inviteViaApi(ctx, owner, 'invited@example.com', 'MANAGER');
    const invitee = await createUser(ctx.app, 'invited@example.com');

    const response = await acceptInvitation(ctx.app, invitee, token);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ activeOrganizationId: orgId });

    const membership = await ctx.prisma.organizationMember.findUniqueOrThrow({
      where: { organizationId_userId: { organizationId: orgId, userId: invitee.userId } },
    });
    expect(membership.role).toBe('MANAGER');

    const audit = await ctx.prisma.auditLog.findFirst({
      where: { action: 'member.invitation_accepted', organizationId: orgId },
    });
    expect(audit).not.toBeNull();
    expect(audit?.actorUserId).toBe(invitee.userId);

    const outbox = await ctx.prisma.outboxMessage.findFirst({
      where: { type: 'member.invitation_accepted' },
    });
    expect(outbox).not.toBeNull();
    expect(outbox?.payload).toMatchObject({
      organizationId: orgId,
      userId: invitee.userId,
      role: 'MANAGER',
    });
  });
});
