import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { hasPermission } from '@businessos/types';
import type { OrganizationDto, WebhookEndpointWithSecretDto } from '@businessos/types';
import {
  addMemberViaInvitation,
  api,
  createOrgViaApi,
  createTestContext,
  createUser,
  createWebhookViaApi,
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

// Guards asserted against the matrix in packages/types/src/permissions.ts. The
// whole module is OWNER/ADMIN-only; erasure is OWNER-only.
describe('RBAC (Phase 9 integrations & compliance)', () => {
  let owner: Actor;
  let org: OrganizationDto;
  let admin: Actor;
  let accountant: Actor;
  let manager: Actor;
  let employee: Actor;
  let readonly: Actor;
  let endpoint: WebhookEndpointWithSecretDto;

  beforeEach(async () => {
    await truncateAll(ctx.prisma);
    owner = await createUser(ctx.app, `rbac9-owner-${Date.now()}@test.local`);
    org = await createOrgViaApi(ctx.app, owner, 'RBAC P9 AB');
    admin = await addMemberViaInvitation(ctx, owner, 'rbac9-admin@example.com', 'ADMIN');
    accountant = await addMemberViaInvitation(ctx, owner, 'rbac9-acc@example.com', 'ACCOUNTANT');
    manager = await addMemberViaInvitation(ctx, owner, 'rbac9-mgr@example.com', 'MANAGER');
    employee = await addMemberViaInvitation(ctx, owner, 'rbac9-emp@example.com', 'EMPLOYEE');
    readonly = await addMemberViaInvitation(ctx, owner, 'rbac9-ro@example.com', 'READONLY');
    endpoint = await createWebhookViaApi(ctx, owner);
  });

  it('matrix: integrations + org.update/delete per role', () => {
    for (const role of ['OWNER', 'ADMIN'] as const) {
      expect(hasPermission(role, 'integrations.read')).toBe(true);
      expect(hasPermission(role, 'integrations.manage')).toBe(true);
      expect(hasPermission(role, 'org.update')).toBe(true);
    }
    for (const role of ['ACCOUNTANT', 'MANAGER', 'EMPLOYEE', 'READONLY'] as const) {
      expect(hasPermission(role, 'integrations.read')).toBe(false);
      expect(hasPermission(role, 'integrations.manage')).toBe(false);
      expect(hasPermission(role, 'org.update')).toBe(false);
    }
    // org.delete (erasure) is OWNER-only.
    expect(hasPermission('OWNER', 'org.delete')).toBe(true);
    for (const role of ['ADMIN', 'ACCOUNTANT', 'MANAGER', 'EMPLOYEE', 'READONLY'] as const) {
      expect(hasPermission(role, 'org.delete')).toBe(false);
    }
  });

  it('non-privileged roles get 403 on every webhook route and on export/retention PUT', async () => {
    for (const role of [accountant, manager, employee, readonly]) {
      const ops = [
        api(ctx.app, 'GET', '/v1/webhooks', { session: role }),
        api(ctx.app, 'POST', '/v1/webhooks', {
          session: role,
          body: { url: 'https://hooks.example.com/x', eventTypes: ['*'] },
        }),
        api(ctx.app, 'GET', `/v1/webhooks/${endpoint.id}`, { session: role }),
        api(ctx.app, 'PATCH', `/v1/webhooks/${endpoint.id}`, {
          session: role,
          body: { enabled: false },
        }),
        api(ctx.app, 'DELETE', `/v1/webhooks/${endpoint.id}`, { session: role }),
        api(ctx.app, 'POST', `/v1/webhooks/${endpoint.id}/rotate-secret`, { session: role }),
        api(ctx.app, 'POST', `/v1/webhooks/${endpoint.id}/ping`, { session: role }),
        api(ctx.app, 'GET', `/v1/webhooks/${endpoint.id}/deliveries`, { session: role }),
        api(ctx.app, 'POST', `/v1/webhooks/${endpoint.id}/deliveries/${randomUUID()}/redeliver`, {
          session: role,
        }),
        api(ctx.app, 'POST', '/v1/organization/export', { session: role }),
        api(ctx.app, 'PUT', '/v1/organization/retention', {
          session: role,
          body: { recordingsDays: 30 },
        }),
      ];
      for (const response of await Promise.all(ops)) {
        expect(response.statusCode).toBe(403);
      }
    }
  });

  it('OWNER and ADMIN can use the webhook, export and retention routes', async () => {
    for (const role of [owner, admin]) {
      expect((await api(ctx.app, 'GET', '/v1/webhooks', { session: role })).statusCode).toBe(200);
      const create = await api(ctx.app, 'POST', '/v1/webhooks', {
        session: role,
        body: { url: 'https://hooks.example.com/ok', eventTypes: ['task.completed'] },
      });
      expect(create.statusCode).toBe(201);
      expect(
        (await api(ctx.app, 'POST', '/v1/organization/export', { session: role })).statusCode,
      ).toBe(202);
      expect(
        (
          await api(ctx.app, 'PUT', '/v1/organization/retention', {
            session: role,
            body: { recordingsDays: 30 },
          })
        ).statusCode,
      ).toBe(200);
    }
  });

  it('erasure is OWNER-only: ADMIN gets 403 (and the org survives)', async () => {
    const res = await api(ctx.app, 'DELETE', '/v1/organization', {
      session: admin,
      body: { confirmSlug: org.slug },
    });
    expect(res.statusCode).toBe(403);
    expect(await ctx.prisma.organization.count({ where: { id: org.id } })).toBe(1);
  });

  it('erasure is OWNER-only: OWNER with the correct slug succeeds (200)', async () => {
    const res = await api(ctx.app, 'DELETE', '/v1/organization', {
      session: owner,
      body: { confirmSlug: org.slug },
    });
    expect(res.statusCode).toBe(200);
    expect(await ctx.prisma.organization.count({ where: { id: org.id } })).toBe(0);
  });
});
