import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type {
  DataExportJobDto,
  OrganizationDto,
  RetentionPolicyDto,
} from '@businessos/types';
import {
  api,
  createCustomerViaApi,
  createOrgViaApi,
  createTestContext,
  createUser,
  createWebhookViaApi,
  destroyTestContext,
  errorCode,
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

describe('compliance — data export (Phase 9)', () => {
  let owner: Actor;

  beforeEach(async () => {
    await truncateAll(ctx.prisma);
    owner = await createUser(ctx.app, `p9-export-${Date.now()}@test.local`);
    await createOrgViaApi(ctx.app, owner, 'Export AB');
  });

  it('POST returns 202 with a PENDING job and enqueues an export-requested outbox row', async () => {
    const res = await api(ctx.app, 'POST', '/v1/organization/export', { session: owner });
    expect(res.statusCode).toBe(202);
    const job = res.json<DataExportJobDto>();
    expect(job.status).toBe('PENDING');
    expect(job.ready).toBe(false);
    expect(job.completedAt).toBeNull();

    // The worker builds the archive off this outbox event (not run in-process here).
    const outbox = await ctx.prisma.outboxMessage.findFirst({
      where: { type: 'organization.export_requested' },
    });
    expect(outbox).not.toBeNull();
    expect((outbox!.payload as { jobId: string }).jobId).toBe(job.id);
  });

  it('lists and gets the requested job', async () => {
    const created = (
      await api(ctx.app, 'POST', '/v1/organization/export', { session: owner })
    ).json<DataExportJobDto>();

    const list = await api(ctx.app, 'GET', '/v1/organization/exports', { session: owner });
    expect(list.statusCode).toBe(200);
    const jobs = list.json<DataExportJobDto[]>();
    expect(jobs.map((j) => j.id)).toContain(created.id);

    const get = await api(ctx.app, 'GET', `/v1/organization/exports/${created.id}`, {
      session: owner,
    });
    expect(get.statusCode).toBe(200);
    expect(get.json<DataExportJobDto>().id).toBe(created.id);
  });

  it('download of a still-PENDING job is 400 export_not_ready', async () => {
    const created = (
      await api(ctx.app, 'POST', '/v1/organization/export', { session: owner })
    ).json<DataExportJobDto>();
    const res = await api(ctx.app, 'GET', `/v1/organization/exports/${created.id}/download`, {
      session: owner,
    });
    expect(res.statusCode).toBe(400);
    expect(errorCode(res.body)).toBe('export_not_ready');
  });

  it('a missing job id is 404', async () => {
    const res = await api(
      ctx.app,
      'GET',
      '/v1/organization/exports/00000000-0000-0000-0000-000000000000',
      { session: owner },
    );
    expect(res.statusCode).toBe(404);
  });
});

describe('compliance — retention policy (Phase 9)', () => {
  let owner: Actor;

  beforeEach(async () => {
    await truncateAll(ctx.prisma);
    owner = await createUser(ctx.app, `p9-retention-${Date.now()}@test.local`);
    await createOrgViaApi(ctx.app, owner, 'Retention AB');
  });

  it('defaults every window to null before any policy is set', async () => {
    const res = await api(ctx.app, 'GET', '/v1/organization/retention', { session: owner });
    expect(res.statusCode).toBe(200);
    const policy = res.json<RetentionPolicyDto>();
    expect(policy).toMatchObject({
      recordingsDays: null,
      auditLogsDays: null,
      activitiesDays: null,
      webhookDeliveriesDays: null,
      updatedAt: null,
    });
  });

  it('PUT then GET round-trips the four windows', async () => {
    const put = await api(ctx.app, 'PUT', '/v1/organization/retention', {
      session: owner,
      body: {
        recordingsDays: 30,
        auditLogsDays: 365,
        activitiesDays: 90,
        webhookDeliveriesDays: 14,
      },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json<RetentionPolicyDto>()).toMatchObject({
      recordingsDays: 30,
      auditLogsDays: 365,
      activitiesDays: 90,
      webhookDeliveriesDays: 14,
    });

    const get = await api(ctx.app, 'GET', '/v1/organization/retention', { session: owner });
    expect(get.json<RetentionPolicyDto>()).toMatchObject({
      recordingsDays: 30,
      auditLogsDays: 365,
      activitiesDays: 90,
      webhookDeliveriesDays: 14,
    });
    expect(get.json<RetentionPolicyDto>().updatedAt).not.toBeNull();
  });

  it('PUT replaces the whole policy — omitted fields reset to null', async () => {
    await api(ctx.app, 'PUT', '/v1/organization/retention', {
      session: owner,
      body: { recordingsDays: 30, auditLogsDays: 365, activitiesDays: 90, webhookDeliveriesDays: 14 },
    });
    // A second PUT that supplies only one field must null the rest (replace, not merge).
    const put = await api(ctx.app, 'PUT', '/v1/organization/retention', {
      session: owner,
      body: { recordingsDays: 7 },
    });
    expect(put.json<RetentionPolicyDto>()).toMatchObject({
      recordingsDays: 7,
      auditLogsDays: null,
      activitiesDays: null,
      webhookDeliveriesDays: null,
    });
  });

  it('rejects out-of-range windows with validation_error', async () => {
    for (const body of [{ recordingsDays: 0 }, { auditLogsDays: 3651 }, { activitiesDays: -5 }]) {
      const res = await api(ctx.app, 'PUT', '/v1/organization/retention', { session: owner, body });
      expect(res.statusCode).toBe(400);
      expect(errorCode(res.body)).toBe('validation_error');
    }
  });
});

describe('compliance — organization erasure (Phase 9)', () => {
  it('mismatched confirmSlug is rejected; the correct slug erases the org and all children', async () => {
    // A THROWAWAY org, created here so the erasure never touches shared/seed data.
    await truncateAll(ctx.prisma);
    const eraser = await createUser(ctx.app, `p9-erase-${Date.now()}@test.local`);
    const org: OrganizationDto = await createOrgViaApi(ctx.app, eraser, 'Throwaway Erase AB');
    const customer = await createCustomerViaApi(ctx, eraser);
    const endpoint = await createWebhookViaApi(ctx, eraser);

    // Wrong confirmation → 400 confirmation_mismatch, nothing deleted.
    const wrong = await api(ctx.app, 'DELETE', '/v1/organization', {
      session: eraser,
      body: { confirmSlug: `${org.slug}-nope` },
    });
    expect(wrong.statusCode).toBe(400);
    expect(errorCode(wrong.body)).toBe('confirmation_mismatch');
    expect(await ctx.prisma.organization.count({ where: { id: org.id } })).toBe(1);

    // Correct slug → 200 and the org id echoed back.
    const ok = await api(ctx.app, 'DELETE', '/v1/organization', {
      session: eraser,
      body: { confirmSlug: org.slug },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json<{ erasedOrganizationId: string }>().erasedOrganizationId).toBe(org.id);

    // The org and every org-scoped child are gone (FK cascade).
    expect(await ctx.prisma.organization.count({ where: { id: org.id } })).toBe(0);
    expect(await ctx.prisma.customer.count({ where: { id: customer.id } })).toBe(0);
    expect(await ctx.prisma.webhookEndpoint.count({ where: { id: endpoint.id } })).toBe(0);
    expect(await ctx.prisma.organizationMember.count({ where: { organizationId: org.id } })).toBe(0);
  });
});
