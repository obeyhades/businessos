import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ApplyTemplateResult, EmployeeDto, OnboardingTemplateDto } from '@businessos/types';
import {
  api,
  createEmployeeViaApi,
  createOrgViaApi,
  createTemplateViaApi,
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

/** Adds N days to a YYYY-MM-DD string in UTC, returning YYYY-MM-DD. */
function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

describe('onboarding template application', () => {
  let owner: Actor;
  let orgId: string;
  let template: OnboardingTemplateDto;
  let employee: EmployeeDto;
  const startDate = '2026-03-02';

  beforeEach(async () => {
    await truncateAll(ctx.prisma);
    owner = await createUser(ctx.app, 'owner@example.com');
    orgId = (await createOrgViaApi(ctx.app, owner, 'Acme AB')).id;
    template = await createTemplateViaApi(ctx, owner, {
      name: 'Field employee onboarding',
      items: [
        { title: 'Sign contract', dueOffsetDays: 0 },
        { title: 'Order equipment', dueOffsetDays: 1 },
        { title: 'Safety training', dueOffsetDays: 7 },
      ],
    });
    employee = await createEmployeeViaApi(ctx, owner, {
      firstName: 'Johan',
      lastName: 'Berg',
      startDate,
    });
  });

  it('creates one dated task per item, with correct titles and due dates', async () => {
    const response = await api(ctx.app, 'POST', `/v1/employees/${employee.id}/apply-template`, {
      session: owner,
      body: { templateId: template.id },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json<ApplyTemplateResult>().createdTaskCount).toBe(3);

    const tasks = await ctx.prisma.task.findMany({
      where: { organizationId: orgId, employeeId: employee.id },
      orderBy: { dueDate: 'asc' },
    });
    expect(tasks).toHaveLength(3);
    for (const task of tasks) {
      expect(task.employeeId).toBe(employee.id);
    }

    const byTitle = new Map(tasks.map((t) => [t.title, t]));
    const expected: Array<[string, number]> = [
      ['Sign contract', 0],
      ['Order equipment', 1],
      ['Safety training', 7],
    ];
    for (const [title, offset] of expected) {
      const task = byTitle.get(title);
      expect(task, title).toBeDefined();
      // dueDate is stored with time; compare the date part against startDate + offset.
      expect(task?.dueDate?.toISOString().slice(0, 10)).toBe(addDays(startDate, offset));
    }
  });

  it('records an audit row and an onboarding_started activity row', async () => {
    await api(ctx.app, 'POST', `/v1/employees/${employee.id}/apply-template`, {
      session: owner,
      body: { templateId: template.id },
    });

    const audit = await ctx.prisma.auditLog.findFirst({
      where: {
        organizationId: orgId,
        action: 'onboarding_template.applied',
        entityId: employee.id,
      },
    });
    expect(audit).not.toBeNull();

    const activity = await ctx.prisma.activity.findFirst({
      where: {
        organizationId: orgId,
        type: 'employee.onboarding_started',
        employeeId: employee.id,
      },
    });
    expect(activity).not.toBeNull();
  });

  it('rejects an unknown template id (400 invalid_template)', async () => {
    const response = await api(ctx.app, 'POST', `/v1/employees/${employee.id}/apply-template`, {
      session: owner,
      body: { templateId: '00000000-0000-4000-8000-000000000000' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('invalid_template');
    expect(await ctx.prisma.task.count({ where: { employeeId: employee.id } })).toBe(0);
  });

  it('falls back to today when the employee has no start date', async () => {
    const noStart = await createEmployeeViaApi(ctx, owner, { firstName: 'No', lastName: 'Start' });
    const today = new Date().toISOString().slice(0, 10);
    const response = await api(ctx.app, 'POST', `/v1/employees/${noStart.id}/apply-template`, {
      session: owner,
      body: { templateId: template.id },
    });
    expect(response.statusCode).toBe(201);
    const first = await ctx.prisma.task.findFirst({
      where: { employeeId: noStart.id, title: 'Sign contract' },
    });
    expect(first?.dueDate?.toISOString().slice(0, 10)).toBe(today);
  });
});
