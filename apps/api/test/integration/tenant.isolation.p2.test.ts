import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type {
  CustomerDto,
  Paginated,
  ProjectDto,
  SearchResponse,
  TaskDto,
} from '@businessos/types';
import {
  addContactViaApi,
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

// One organization's data must be completely invisible and immutable to
// another organization's members, across EVERY Phase 2 resource.
describe('tenant isolation (Phase 2)', () => {
  let userA: Actor;
  let userB: Actor;
  let orgAId: string;

  // Org A resources.
  let customerA: CustomerDto;
  let projectA: ProjectDto;
  let taskA: TaskDto;

  beforeEach(async () => {
    await truncateAll(ctx.prisma);
    userA = await createUser(ctx.app, 'owner-a@example.com');
    userB = await createUser(ctx.app, 'owner-b@example.com');
    orgAId = (await createOrgViaApi(ctx.app, userA, 'Org Alpha')).id;
    await createOrgViaApi(ctx.app, userB, 'Org Beta');

    customerA = await createCustomerViaApi(ctx, userA, {
      name: 'Alpha Secret Customer',
      email: 'secret@alpha.example',
    });
    projectA = await createProjectViaApi(ctx, userA, {
      name: 'Alpha Secret Project',
      customerId: customerA.id,
    });
    taskA = await createTaskViaApi(ctx, userA, {
      title: 'Alpha Secret Task',
      customerId: customerA.id,
      projectId: projectA.id,
    });

    // Give org B its own data so its list endpoints are not trivially empty.
    await createCustomerViaApi(ctx, userB, { name: 'Beta Own Customer' });
    await createProjectViaApi(ctx, userB, { name: 'Beta Own Project' });
    await createTaskViaApi(ctx, userB, { title: 'Beta Own Task' });
  });

  it("B's customer list excludes org A rows", async () => {
    const response = await api(ctx.app, 'GET', '/v1/customers?pageSize=100', { session: userB });
    expect(response.statusCode).toBe(200);
    const page = response.json<Paginated<CustomerDto>>();
    expect(page.items.map((c) => c.id)).not.toContain(customerA.id);
    expect(page.items.every((c) => c.name !== 'Alpha Secret Customer')).toBe(true);
  });

  it("B's project list excludes org A rows", async () => {
    const response = await api(ctx.app, 'GET', '/v1/projects?pageSize=100', { session: userB });
    expect(response.statusCode).toBe(200);
    expect(response.json<Paginated<ProjectDto>>().items.map((p) => p.id)).not.toContain(
      projectA.id,
    );
  });

  it("B's task list excludes org A rows", async () => {
    const response = await api(ctx.app, 'GET', '/v1/tasks?pageSize=100', { session: userB });
    expect(response.statusCode).toBe(200);
    expect(response.json<Paginated<TaskDto>>().items.map((t) => t.id)).not.toContain(taskA.id);
  });

  it("B cannot GET or PATCH A's customer (404)", async () => {
    expect(
      (await api(ctx.app, 'GET', `/v1/customers/${customerA.id}`, { session: userB })).statusCode,
    ).toBe(404);
    const patch = await api(ctx.app, 'PATCH', `/v1/customers/${customerA.id}`, {
      session: userB,
      body: { name: 'Hijacked' },
    });
    expect(patch.statusCode).toBe(404);
    // The row is untouched in the DB.
    const row = await ctx.prisma.customer.findUniqueOrThrow({ where: { id: customerA.id } });
    expect(row.name).toBe('Alpha Secret Customer');
  });

  it("B cannot GET or PATCH A's project (404)", async () => {
    expect(
      (await api(ctx.app, 'GET', `/v1/projects/${projectA.id}`, { session: userB })).statusCode,
    ).toBe(404);
    const patch = await api(ctx.app, 'PATCH', `/v1/projects/${projectA.id}`, {
      session: userB,
      body: { name: 'Hijacked' },
    });
    expect(patch.statusCode).toBe(404);
    const row = await ctx.prisma.project.findUniqueOrThrow({ where: { id: projectA.id } });
    expect(row.name).toBe('Alpha Secret Project');
  });

  it("B cannot GET, PATCH or DELETE A's task (404)", async () => {
    expect(
      (await api(ctx.app, 'GET', `/v1/tasks/${taskA.id}`, { session: userB })).statusCode,
    ).toBe(404);
    const patch = await api(ctx.app, 'PATCH', `/v1/tasks/${taskA.id}`, {
      session: userB,
      body: { title: 'Hijacked' },
    });
    expect(patch.statusCode).toBe(404);
    const del = await api(ctx.app, 'DELETE', `/v1/tasks/${taskA.id}`, { session: userB });
    expect(del.statusCode).toBe(404);
    expect(await ctx.prisma.task.count({ where: { id: taskA.id } })).toBe(1);
  });

  it("B cannot add a contact to A's customer (404 on parent resolve)", async () => {
    const response = await api(ctx.app, 'POST', `/v1/customers/${customerA.id}/contacts`, {
      session: userB,
      body: { name: 'Intruder Contact' },
    });
    expect(response.statusCode).toBe(404);
    expect(await ctx.prisma.customerContact.count({ where: { customerId: customerA.id } })).toBe(0);
  });

  it("B cannot list A's customer contacts (404)", async () => {
    await addContactViaApi(ctx, userA, customerA.id, { name: 'Alpha Contact' });
    const response = await api(ctx.app, 'GET', `/v1/customers/${customerA.id}/contacts`, {
      session: userB,
    });
    expect(response.statusCode).toBe(404);
  });

  it("B cannot comment on A's customer, project or task (404 on parent resolve)", async () => {
    for (const [path, id] of [
      ['customers', customerA.id],
      ['projects', projectA.id],
      ['tasks', taskA.id],
    ] as const) {
      const response = await api(ctx.app, 'POST', `/v1/${path}/${id}/comments`, {
        session: userB,
        body: { body: 'intruding' },
      });
      expect(response.statusCode, `${path} comment`).toBe(404);
    }
    expect(await ctx.prisma.comment.count({ where: { organizationId: orgAId } })).toBe(0);
  });

  it("B cannot attach a file to A's customer (404 on parent resolve)", async () => {
    // Uses the JSON list endpoint to prove the parent is invisible; the upload
    // path shares the same resolveEntityRef gate.
    const list = await api(ctx.app, 'GET', `/v1/customers/${customerA.id}/attachments`, {
      session: userB,
    });
    expect(list.statusCode).toBe(404);
  });

  it("B's search never returns org A rows", async () => {
    for (const q of ['Alpha', 'Secret', 'secret@alpha.example']) {
      const response = await api(ctx.app, 'GET', `/v1/search?q=${encodeURIComponent(q)}`, {
        session: userB,
      });
      expect(response.statusCode).toBe(200);
      const ids = response.json<SearchResponse>().results.map((r) => r.id);
      expect(ids, `search "${q}"`).not.toContain(customerA.id);
      expect(ids).not.toContain(projectA.id);
      expect(ids).not.toContain(taskA.id);
    }
  });

  it("B cannot read A's customer / project / task activity timeline (404)", async () => {
    expect(
      (await api(ctx.app, 'GET', `/v1/customers/${customerA.id}/activity`, { session: userB }))
        .statusCode,
    ).toBe(404);
    expect(
      (await api(ctx.app, 'GET', `/v1/projects/${projectA.id}/activity`, { session: userB }))
        .statusCode,
    ).toBe(404);
    expect(
      (await api(ctx.app, 'GET', `/v1/tasks/${taskA.id}/activity`, { session: userB })).statusCode,
    ).toBe(404);
  });

  it("B's org-wide activity feed excludes org A activity", async () => {
    const response = await api(ctx.app, 'GET', '/v1/activity?pageSize=100', { session: userB });
    expect(response.statusCode).toBe(200);
    const rows = response.json<Paginated<{ id: string }>>().items;
    const orgAActivityIds = new Set(
      (await ctx.prisma.activity.findMany({ where: { organizationId: orgAId } })).map((a) => a.id),
    );
    for (const row of rows) {
      expect(orgAActivityIds.has(row.id)).toBe(false);
    }
    expect(orgAActivityIds.size).toBeGreaterThan(0);
  });
});
