import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { hasPermission, type OrganizationRole, type SearchResponse } from '@businessos/types';
import {
  addMemberViaInvitation,
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

async function search(session: Actor, q: string, limit?: number): Promise<SearchResponse> {
  const suffix = limit ? `&limit=${limit}` : '';
  const response = await api(ctx.app, 'GET', `/v1/search?q=${encodeURIComponent(q)}${suffix}`, {
    session,
  });
  expect(response.statusCode, `search "${q}"`).toBe(200);
  return response.json<SearchResponse>();
}

describe('search', () => {
  let owner: Actor;

  beforeEach(async () => {
    await truncateAll(ctx.prisma);
    owner = await createUser(ctx.app, 'owner@example.com');
    await createOrgViaApi(ctx.app, owner, 'Acme AB');
  });

  it('matches customers by name, email and orgNumber', async () => {
    const customer = await createCustomerViaApi(ctx, owner, {
      name: 'Zephyr Konsult AB',
      email: 'kontakt@zephyr-konsult.example',
      orgNumber: '559900-1234',
    });

    for (const q of ['Zephyr', 'zephyr-konsult.example', '559900']) {
      const { results } = await search(owner, q);
      const hit = results.find((r) => r.kind === 'customer' && r.id === customer.id);
      expect(hit, `customer via "${q}"`).toBeDefined();
    }
  });

  it('matches projects by name and tasks by title', async () => {
    const project = await createProjectViaApi(ctx, owner, { name: 'Nimbus Migration' });
    const task = await createTaskViaApi(ctx, owner, { title: 'Nimbus Rollout Checklist' });

    const { results } = await search(owner, 'Nimbus');
    expect(results.find((r) => r.kind === 'project' && r.id === project.id)).toBeDefined();
    expect(results.find((r) => r.kind === 'task' && r.id === task.id)).toBeDefined();
  });

  it('returns all three kinds for a shared token', async () => {
    await createCustomerViaApi(ctx, owner, { name: 'Quokka Customer' });
    await createProjectViaApi(ctx, owner, { name: 'Quokka Project' });
    await createTaskViaApi(ctx, owner, { title: 'Quokka Task' });

    const { results } = await search(owner, 'Quokka');
    expect(new Set(results.map((r) => r.kind))).toEqual(new Set(['customer', 'project', 'task']));
  });

  it('respects the limit parameter', async () => {
    for (let i = 0; i < 6; i += 1) {
      await createCustomerViaApi(ctx, owner, { name: `Limitcust ${i}` });
      await createProjectViaApi(ctx, owner, { name: `Limitcust proj ${i}` });
      await createTaskViaApi(ctx, owner, { title: `Limitcust task ${i}` });
    }
    const { results } = await search(owner, 'Limitcust', 3);
    expect(results.length).toBeLessThanOrEqual(3);
  });

  it('is organization-scoped: results never cross tenants', async () => {
    // Provision an isolated org B whose data shares the search token.
    const ownerB = await createUser(ctx.app, 'owner-b@example.com');
    await createOrgViaApi(ctx.app, ownerB, 'Beta Org');
    const bCustomer = await createCustomerViaApi(ctx, ownerB, { name: 'Crossorg Customer B' });

    await createCustomerViaApi(ctx, owner, { name: 'Crossorg Customer A' });

    const { results } = await search(owner, 'Crossorg');
    const ids = results.map((r) => r.id);
    expect(ids).not.toContain(bCustomer.id);
    expect(results.every((r) => r.title.endsWith('A'))).toBe(true);
  });

  // NOTE ON PERMISSION SCOPING: the search route gates each entity kind on the
  // caller's *.read permission. Per packages/types/src/permissions.ts EVERY
  // assignable role (ADMIN, ACCOUNTANT, MANAGER, EMPLOYEE, READONLY) — and OWNER
  // — holds customers.read, projects.read AND tasks.read. There is therefore no
  // role that lacks one of the three reads, so a "kind is absent from results"
  // negative case is unreachable with the current matrix. We instead assert the
  // positive: a low-privilege READONLY member, holding all three reads, sees all
  // three kinds. The gating mechanism itself is unit-covered by hasPermission.
  it('a READONLY member (all three reads per matrix) sees all three kinds', async () => {
    const readonly: OrganizationRole = 'READONLY';
    expect(hasPermission(readonly, 'customers.read')).toBe(true);
    expect(hasPermission(readonly, 'projects.read')).toBe(true);
    expect(hasPermission(readonly, 'tasks.read')).toBe(true);

    await createCustomerViaApi(ctx, owner, { name: 'Scoped Customer' });
    await createProjectViaApi(ctx, owner, { name: 'Scoped Project' });
    await createTaskViaApi(ctx, owner, { title: 'Scoped Task' });
    const member = await addMemberViaInvitation(ctx, owner, 'readonly@example.com', 'READONLY');

    const { results } = await search(member, 'Scoped');
    expect(new Set(results.map((r) => r.kind))).toEqual(new Set(['customer', 'project', 'task']));
  });
});
