import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type {
  DataExportJobDto,
  OrganizationDto,
  RetentionPolicyDto,
  WebhookEndpointDto,
  WebhookEndpointWithSecretDto,
} from '@businessos/types';
import {
  api,
  createOrgViaApi,
  createTestContext,
  createUser,
  createWebhookViaApi,
  destroyTestContext,
  seedWebhookDelivery,
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

// Org A's integrations + compliance state must be invisible and immutable to org B.
describe('tenant isolation (Phase 9 integrations & compliance)', () => {
  let userA: Actor;
  let userB: Actor;
  let orgA: OrganizationDto;
  let endpointA: WebhookEndpointWithSecretDto;
  let deliveryAId: string;

  beforeEach(async () => {
    await truncateAll(ctx.prisma);
    userA = await createUser(ctx.app, `p9-iso-a-${Date.now()}@test.local`);
    userB = await createUser(ctx.app, `p9-iso-b-${Date.now()}@test.local`);
    orgA = await createOrgViaApi(ctx.app, userA, 'Alpha Integrations');
    await createOrgViaApi(ctx.app, userB, 'Beta Integrations');

    endpointA = await createWebhookViaApi(ctx, userA, { description: 'A private hook' });
    deliveryAId = await seedWebhookDelivery(ctx.prisma, {
      organizationId: orgA.id,
      endpointId: endpointA.id,
    });
    // B gets its own endpoint so its list is not trivially empty.
    await createWebhookViaApi(ctx, userB);
  });

  it("B's webhook list excludes A's endpoint", async () => {
    const res = await api(ctx.app, 'GET', '/v1/webhooks', { session: userB });
    expect(res.statusCode).toBe(200);
    const ids = res.json<WebhookEndpointDto[]>().map((e) => e.id);
    expect(ids).not.toContain(endpointA.id);
  });

  it("every access to A's endpoint from B is 404", async () => {
    const ops = [
      api(ctx.app, 'GET', `/v1/webhooks/${endpointA.id}`, { session: userB }),
      api(ctx.app, 'PATCH', `/v1/webhooks/${endpointA.id}`, {
        session: userB,
        body: { enabled: false },
      }),
      api(ctx.app, 'DELETE', `/v1/webhooks/${endpointA.id}`, { session: userB }),
      api(ctx.app, 'POST', `/v1/webhooks/${endpointA.id}/rotate-secret`, { session: userB }),
      api(ctx.app, 'POST', `/v1/webhooks/${endpointA.id}/ping`, { session: userB }),
      api(ctx.app, 'GET', `/v1/webhooks/${endpointA.id}/deliveries`, { session: userB }),
      api(ctx.app, 'POST', `/v1/webhooks/${endpointA.id}/deliveries/${deliveryAId}/redeliver`, {
        session: userB,
      }),
    ];
    for (const response of await Promise.all(ops)) {
      expect(response.statusCode).toBe(404);
    }

    // A's endpoint and its delivery are untouched.
    expect(await ctx.prisma.webhookEndpoint.count({ where: { id: endpointA.id } })).toBe(1);
    const delivery = await ctx.prisma.webhookDelivery.findUniqueOrThrow({
      where: { id: deliveryAId },
    });
    expect(delivery.status).toBe('FAILED'); // unchanged by B's redeliver attempt
    expect(delivery.organizationId).toBe(orgA.id);
  });

  it('retention policies are per-org and independent', async () => {
    await api(ctx.app, 'PUT', '/v1/organization/retention', {
      session: userA,
      body: { recordingsDays: 30 },
    });
    // B's policy is still empty — A's change did not leak across the tenant boundary.
    const bPolicy = await api(ctx.app, 'GET', '/v1/organization/retention', { session: userB });
    expect(bPolicy.json<RetentionPolicyDto>().recordingsDays).toBeNull();

    await api(ctx.app, 'PUT', '/v1/organization/retention', {
      session: userB,
      body: { auditLogsDays: 90 },
    });
    // A's policy still reflects only A's value.
    const aPolicy = await api(ctx.app, 'GET', '/v1/organization/retention', { session: userA });
    expect(aPolicy.json<RetentionPolicyDto>()).toMatchObject({
      recordingsDays: 30,
      auditLogsDays: null,
    });
  });

  it("B cannot see or fetch A's export jobs", async () => {
    const jobA = (
      await api(ctx.app, 'POST', '/v1/organization/export', { session: userA })
    ).json<DataExportJobDto>();

    const bList = await api(ctx.app, 'GET', '/v1/organization/exports', { session: userB });
    expect(bList.json<DataExportJobDto[]>().map((j) => j.id)).not.toContain(jobA.id);

    const bGet = await api(ctx.app, 'GET', `/v1/organization/exports/${jobA.id}`, {
      session: userB,
    });
    expect(bGet.statusCode).toBe(404);
  });
});
