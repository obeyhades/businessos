import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ActivityDto, Paginated } from '@businessos/types';
import {
  api,
  createCustomerViaApi,
  createOrgViaApi,
  createProjectViaApi,
  createTaskViaApi,
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

function isReverseChron(items: ActivityDto[]): boolean {
  for (let i = 1; i < items.length; i += 1) {
    if (new Date(items[i - 1]!.createdAt).getTime() < new Date(items[i]!.createdAt).getTime()) {
      return false;
    }
  }
  return true;
}

describe('activity timelines', () => {
  let owner: Actor;
  let orgId: string;

  beforeEach(async () => {
    await truncateAll(ctx.prisma);
    owner = await createUser(ctx.app, 'owner@example.com');
    orgId = (await createOrgViaApi(ctx.app, owner, 'Acme AB')).id;
  });

  it('a task created under a customer+project denormalizes customerId onto its activity', async () => {
    const customer = await createCustomerViaApi(ctx, owner, { name: 'Timeline Customer' });
    const project = await createProjectViaApi(ctx, owner, {
      name: 'Timeline Project',
      customerId: customer.id,
    });
    const task = await createTaskViaApi(ctx, owner, {
      title: 'Timeline Task',
      customerId: customer.id,
      projectId: project.id,
    });

    const created = await ctx.prisma.activity.findFirstOrThrow({
      where: { organizationId: orgId, type: 'task.created', taskId: task.id },
    });
    expect(created.customerId).toBe(customer.id);
    expect(created.projectId).toBe(project.id);
  });

  it('completing a task records task.completed AND enqueues a task.completed outbox row', async () => {
    const task = await createTaskViaApi(ctx, owner, { title: 'To Complete' });

    const response = await api(ctx.app, 'PATCH', `/v1/tasks/${task.id}`, {
      session: owner,
      body: { status: 'DONE' },
    });
    expect(response.statusCode).toBe(200);

    const activity = await ctx.prisma.activity.findFirst({
      where: { organizationId: orgId, type: 'task.completed', taskId: task.id },
    });
    expect(activity).not.toBeNull();

    const outbox = await ctx.prisma.outboxMessage.findFirst({
      where: { type: 'task.completed' },
    });
    expect(outbox).not.toBeNull();
    expect(outbox?.payload).toMatchObject({ taskId: task.id, organizationId: orgId });

    // An audit row is also written with the task.completed action.
    expect(
      await ctx.prisma.auditLog.count({
        where: { organizationId: orgId, action: 'task.completed', entityId: task.id },
      }),
    ).toBe(1);
  });

  it('the customer timeline aggregates its projects and tasks, newest first', async () => {
    const customer = await createCustomerViaApi(ctx, owner, { name: 'Aggregating Customer' });
    const project = await createProjectViaApi(ctx, owner, {
      name: 'Child Project',
      customerId: customer.id,
    });
    const task = await createTaskViaApi(ctx, owner, {
      title: 'Child Task',
      customerId: customer.id,
      projectId: project.id,
    });
    await api(ctx.app, 'PATCH', `/v1/tasks/${task.id}`, {
      session: owner,
      body: { status: 'DONE' },
    });

    const response = await api(
      ctx.app,
      'GET',
      `/v1/customers/${customer.id}/activity?pageSize=100`,
      {
        session: owner,
      },
    );
    expect(response.statusCode).toBe(200);
    const page = response.json<Paginated<ActivityDto>>();
    const types = page.items.map((a) => a.type);
    expect(types).toEqual(
      expect.arrayContaining(['customer.created', 'task.created', 'task.completed']),
    );
    // Only activities denormalized onto this customer are present.
    expect(page.items.every((a) => a.customerId === customer.id)).toBe(true);
    expect(isReverseChron(page.items)).toBe(true);
  });

  it('the project timeline is scoped to that project', async () => {
    const customer = await createCustomerViaApi(ctx, owner, { name: 'Proj Scope Customer' });
    const project = await createProjectViaApi(ctx, owner, {
      name: 'Scoped Project',
      customerId: customer.id,
    });
    const task = await createTaskViaApi(ctx, owner, {
      title: 'Project Task',
      customerId: customer.id,
      projectId: project.id,
    });
    await api(ctx.app, 'PATCH', `/v1/tasks/${task.id}`, {
      session: owner,
      body: { status: 'DONE' },
    });

    const response = await api(ctx.app, 'GET', `/v1/projects/${project.id}/activity?pageSize=100`, {
      session: owner,
    });
    expect(response.statusCode).toBe(200);
    const page = response.json<Paginated<ActivityDto>>();
    expect(page.items.length).toBeGreaterThan(0);
    expect(page.items.every((a) => a.projectId === project.id)).toBe(true);
    // The standalone customer.created activity (projectId null) is excluded.
    expect(page.items.some((a) => a.type === 'customer.created')).toBe(false);
    expect(page.items.some((a) => a.type === 'project.created')).toBe(true);
  });

  it('the task timeline is scoped to that task', async () => {
    const project = await createProjectViaApi(ctx, owner, { name: 'Task Scope Project' });
    const task = await createTaskViaApi(ctx, owner, {
      title: 'Scoped Task',
      projectId: project.id,
    });
    await api(ctx.app, 'PATCH', `/v1/tasks/${task.id}`, {
      session: owner,
      body: { status: 'DONE' },
    });

    const response = await api(ctx.app, 'GET', `/v1/tasks/${task.id}/activity?pageSize=100`, {
      session: owner,
    });
    expect(response.statusCode).toBe(200);
    const page = response.json<Paginated<ActivityDto>>();
    expect(page.items.length).toBeGreaterThan(0);
    expect(page.items.every((a) => a.taskId === task.id)).toBe(true);
    expect(page.items.map((a) => a.type)).toEqual(
      expect.arrayContaining(['task.created', 'task.completed']),
    );
    // The project.created activity (taskId null) is excluded.
    expect(page.items.some((a) => a.type === 'project.created')).toBe(false);
  });
});
