import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AbsenceRequestDto, EmployeeDto, Paginated } from '@businessos/types';
import {
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

async function createAbsence(
  owner: Actor,
  employeeId: string,
  overrides: Record<string, unknown> = {},
): Promise<AbsenceRequestDto> {
  const response = await api(ctx.app, 'POST', `/v1/employees/${employeeId}/absence-requests`, {
    session: owner,
    body: { type: 'VACATION', startDate: '2026-08-01', endDate: '2026-08-10', ...overrides },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<AbsenceRequestDto>();
}

describe('absence requests', () => {
  let owner: Actor;
  let orgId: string;
  let employee: EmployeeDto;

  beforeEach(async () => {
    await truncateAll(ctx.prisma);
    owner = await createUser(ctx.app, 'owner@example.com');
    orgId = (await createOrgViaApi(ctx.app, owner, 'Acme AB')).id;
    employee = await createEmployeeViaApi(ctx, owner, { firstName: 'Erik', lastName: 'Eklund' });
  });

  it('is created in PENDING status', async () => {
    const absence = await createAbsence(owner, employee.id);
    expect(absence.status).toBe('PENDING');
    expect(absence.reviewedBy).toBeNull();
    expect(absence.reviewedAt).toBeNull();
  });

  it('approving sets status, reviewer and timestamp, plus audit + activity rows', async () => {
    const absence = await createAbsence(owner, employee.id);
    const response = await api(ctx.app, 'POST', `/v1/absence-requests/${absence.id}/review`, {
      session: owner,
      body: { decision: 'APPROVED', reviewNote: 'Enjoy' },
    });
    expect(response.statusCode).toBe(200);
    const reviewed = response.json<AbsenceRequestDto>();
    expect(reviewed.status).toBe('APPROVED');
    expect(reviewed.reviewedBy?.id).toBe(owner.userId);
    expect(reviewed.reviewedAt).not.toBeNull();
    expect(reviewed.reviewNote).toBe('Enjoy');

    expect(
      await ctx.prisma.auditLog.count({
        where: { organizationId: orgId, action: 'absence.approved', entityId: absence.id },
      }),
    ).toBe(1);
    expect(
      await ctx.prisma.activity.count({
        where: { organizationId: orgId, type: 'absence.approved', employeeId: employee.id },
      }),
    ).toBe(1);
  });

  it('rejecting is recorded as REJECTED with the rejected audit action', async () => {
    const absence = await createAbsence(owner, employee.id);
    const response = await api(ctx.app, 'POST', `/v1/absence-requests/${absence.id}/review`, {
      session: owner,
      body: { decision: 'REJECTED' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<AbsenceRequestDto>().status).toBe('REJECTED');
    expect(
      await ctx.prisma.auditLog.count({
        where: { organizationId: orgId, action: 'absence.rejected', entityId: absence.id },
      }),
    ).toBe(1);
  });

  it('reviewing a non-PENDING request is a 409 not_pending', async () => {
    const absence = await createAbsence(owner, employee.id);
    await api(ctx.app, 'POST', `/v1/absence-requests/${absence.id}/review`, {
      session: owner,
      body: { decision: 'APPROVED' },
    });
    const again = await api(ctx.app, 'POST', `/v1/absence-requests/${absence.id}/review`, {
      session: owner,
      body: { decision: 'REJECTED' },
    });
    expect(again.statusCode).toBe(409);
    expect(again.json<{ error: { code: string } }>().error.code).toBe('not_pending');
  });

  it('cancelling sets CANCELLED; cancelling twice is a 409 already_cancelled', async () => {
    const absence = await createAbsence(owner, employee.id);
    const first = await api(ctx.app, 'POST', `/v1/absence-requests/${absence.id}/cancel`, {
      session: owner,
    });
    expect(first.statusCode).toBe(200);
    expect(first.json<AbsenceRequestDto>().status).toBe('CANCELLED');

    const second = await api(ctx.app, 'POST', `/v1/absence-requests/${absence.id}/cancel`, {
      session: owner,
    });
    expect(second.statusCode).toBe(409);
    expect(second.json<{ error: { code: string } }>().error.code).toBe('already_cancelled');
  });

  it('list filters by status and by employee', async () => {
    const other = await createEmployeeViaApi(ctx, owner, { firstName: 'Other', lastName: 'Emp' });
    const pending = await createAbsence(owner, employee.id, {
      startDate: '2026-09-01',
      endDate: '2026-09-03',
    });
    const toApprove = await createAbsence(owner, other.id, {
      startDate: '2026-09-02',
      endDate: '2026-09-04',
    });
    await api(ctx.app, 'POST', `/v1/absence-requests/${toApprove.id}/review`, {
      session: owner,
      body: { decision: 'APPROVED' },
    });

    const byStatus = await api(ctx.app, 'GET', '/v1/absence-requests?status=PENDING&pageSize=100', {
      session: owner,
    });
    expect(byStatus.statusCode).toBe(200);
    const pendingItems = byStatus.json<Paginated<AbsenceRequestDto>>().items;
    expect(pendingItems.map((a) => a.id)).toContain(pending.id);
    expect(pendingItems.every((a) => a.status === 'PENDING')).toBe(true);

    const byEmployee = await api(
      ctx.app,
      'GET',
      `/v1/absence-requests?employeeId=${employee.id}&pageSize=100`,
      { session: owner },
    );
    expect(byEmployee.statusCode).toBe(200);
    const employeeItems = byEmployee.json<Paginated<AbsenceRequestDto>>().items;
    expect(employeeItems.every((a) => a.employee.id === employee.id)).toBe(true);
    expect(employeeItems.map((a) => a.id)).not.toContain(toApprove.id);
  });

  it('per-employee absence list returns that employee rows only', async () => {
    await createAbsence(owner, employee.id);
    const response = await api(ctx.app, 'GET', `/v1/employees/${employee.id}/absence-requests`, {
      session: owner,
    });
    expect(response.statusCode).toBe(200);
    const rows = response.json<AbsenceRequestDto[]>();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((a) => a.employee.id === employee.id)).toBe(true);
  });
});
