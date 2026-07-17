import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { hasPermission } from '@businessos/types';
import type { CustomerDto, RecordingDto } from '@businessos/types';
import {
  addMemberViaInvitation,
  api,
  createCustomerViaApi,
  createOrgViaApi,
  createTestContext,
  createUser,
  createVoiceNoteViaApi,
  destroyTestContext,
  truncateAll,
  uploadVoiceNoteViaApi,
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

// Guards asserted against the matrix in packages/types/src/permissions.ts.
describe('RBAC (Phase 8 recordings)', () => {
  let owner: Actor;
  let admin: Actor;
  let manager: Actor;
  let employee: Actor;
  let readonly: Actor;
  let customer: CustomerDto;
  let recording: RecordingDto;

  beforeEach(async () => {
    await truncateAll(ctx.prisma);
    owner = await createUser(ctx.app, `rbac8-owner-${Date.now()}@test.local`);
    await createOrgViaApi(ctx.app, owner, 'RBAC Voice AB');
    admin = await addMemberViaInvitation(ctx, owner, 'rbac8-admin@example.com', 'ADMIN');
    manager = await addMemberViaInvitation(ctx, owner, 'rbac8-mgr@example.com', 'MANAGER');
    employee = await addMemberViaInvitation(ctx, owner, 'rbac8-emp@example.com', 'EMPLOYEE');
    readonly = await addMemberViaInvitation(ctx, owner, 'rbac8-ro@example.com', 'READONLY');

    customer = await createCustomerViaApi(ctx, owner);
    // A shared org recording, already linked to a customer so to-invoice is
    // gated only by permission (not by the missing-customer guard).
    recording = await createVoiceNoteViaApi(ctx.app, owner, { customerId: customer.id });
  });

  it('matrix: recordings.read vs recordings.manage per role', () => {
    for (const role of ['OWNER', 'ADMIN', 'MANAGER'] as const) {
      expect(hasPermission(role, 'recordings.read')).toBe(true);
      expect(hasPermission(role, 'recordings.manage')).toBe(true);
    }
    // EMPLOYEE and READONLY can read but never manage.
    for (const role of ['EMPLOYEE', 'READONLY'] as const) {
      expect(hasPermission(role, 'recordings.read')).toBe(true);
      expect(hasPermission(role, 'recordings.manage')).toBe(false);
    }
    // ACCOUNTANT has no recordings access at all.
    expect(hasPermission('ACCOUNTANT', 'recordings.read')).toBe(false);
    expect(hasPermission('ACCOUNTANT', 'recordings.manage')).toBe(false);
    // The dual-permission guards: MANAGER can convert to a task (tasks.manage)
    // but not to an invoice (no invoices.manage).
    expect(hasPermission('MANAGER', 'tasks.manage')).toBe(true);
    expect(hasPermission('MANAGER', 'invoices.manage')).toBe(false);
  });

  it('READONLY can read but every mutation is 403', async () => {
    expect((await api(ctx.app, 'GET', '/v1/recordings', { session: readonly })).statusCode).toBe(
      200,
    );
    expect(
      (await api(ctx.app, 'GET', `/v1/recordings/${recording.id}`, { session: readonly }))
        .statusCode,
    ).toBe(200);
    // Audio download is a read; READONLY is allowed the signed URL.
    expect(
      (await api(ctx.app, 'GET', `/v1/recordings/${recording.id}/audio`, { session: readonly }))
        .statusCode,
    ).toBe(200);

    const upload = await uploadVoiceNoteViaApi(ctx.app, readonly);
    expect(upload.statusCode).toBe(403);

    const mutations: Array<Promise<{ statusCode: number }>> = [
      api(ctx.app, 'POST', '/v1/recordings/call-logs', {
        session: readonly,
        body: { title: 'Nope', direction: 'INBOUND' },
      }),
      api(ctx.app, 'PATCH', `/v1/recordings/${recording.id}`, {
        session: readonly,
        body: { title: 'Nope' },
      }),
      api(ctx.app, 'DELETE', `/v1/recordings/${recording.id}`, { session: readonly }),
      api(ctx.app, 'POST', `/v1/recordings/${recording.id}/retranscribe`, { session: readonly }),
      api(ctx.app, 'POST', `/v1/recordings/${recording.id}/task`, { session: readonly, body: {} }),
      api(ctx.app, 'POST', `/v1/recordings/${recording.id}/invoice`, {
        session: readonly,
        body: { unitPriceMinor: 1000, quantity: 1, taxRatePercent: 25 },
      }),
    ];
    for (const response of await Promise.all(mutations)) {
      expect(response.statusCode).toBe(403);
    }
  });

  it('EMPLOYEE can read but cannot upload or convert (no recordings.manage)', async () => {
    expect((await api(ctx.app, 'GET', '/v1/recordings', { session: employee })).statusCode).toBe(
      200,
    );
    // recordings.manage is required to upload — EMPLOYEE lacks it.
    expect((await uploadVoiceNoteViaApi(ctx.app, employee)).statusCode).toBe(403);
    // to-task needs recordings.manage AND tasks.manage; EMPLOYEE has tasks.manage
    // but not recordings.manage, so it is still 403.
    expect(
      (await api(ctx.app, 'POST', `/v1/recordings/${recording.id}/task`, { session: employee, body: {} }))
        .statusCode,
    ).toBe(403);
  });

  it('MANAGER can convert to a task (201) but not to an invoice (403 — dual-permission guard)', async () => {
    const toTask = await api(ctx.app, 'POST', `/v1/recordings/${recording.id}/task`, {
      session: manager,
      body: {},
    });
    expect(toTask.statusCode).toBe(201);

    // MANAGER has recordings.manage but NOT invoices.manage.
    const toInvoice = await api(ctx.app, 'POST', `/v1/recordings/${recording.id}/invoice`, {
      session: manager,
      body: { unitPriceMinor: 1000, quantity: 1, taxRatePercent: 25 },
    });
    expect(toInvoice.statusCode).toBe(403);
  });

  it('MANAGER can upload, patch, and delete recordings', async () => {
    const upload = await uploadVoiceNoteViaApi(ctx.app, manager);
    expect(upload.statusCode).toBe(201);
    const rec = upload.json<RecordingDto>();
    expect(
      (await api(ctx.app, 'PATCH', `/v1/recordings/${rec.id}`, { session: manager, body: { title: 'Renamed' } }))
        .statusCode,
    ).toBe(200);
    expect(
      (await api(ctx.app, 'DELETE', `/v1/recordings/${rec.id}`, { session: manager })).statusCode,
    ).toBe(204);
  });

  it('OWNER and ADMIN can convert to an invoice (201)', async () => {
    const ownerInvoice = await api(ctx.app, 'POST', `/v1/recordings/${recording.id}/invoice`, {
      session: owner,
      body: { unitPriceMinor: 1000, quantity: 1, taxRatePercent: 25 },
    });
    expect(ownerInvoice.statusCode).toBe(201);

    const adminInvoice = await api(ctx.app, 'POST', `/v1/recordings/${recording.id}/invoice`, {
      session: admin,
      body: { unitPriceMinor: 2000, quantity: 1, taxRatePercent: 25 },
    });
    expect(adminInvoice.statusCode).toBe(201);
  });
});
