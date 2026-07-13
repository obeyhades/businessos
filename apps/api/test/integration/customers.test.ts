import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CustomerDto, Paginated } from '@businessos/types';
import {
  api,
  createCustomerViaApi,
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

describe('customers CRUD', () => {
  let owner: Actor;
  let orgId: string;

  beforeEach(async () => {
    await truncateAll(ctx.prisma);
    owner = await createUser(ctx.app, 'owner@example.com');
    orgId = (await createOrgViaApi(ctx.app, owner, 'Acme AB')).id;
  });

  it('creates a customer and returns the DTO', async () => {
    const response = await api(ctx.app, 'POST', '/v1/customers', {
      session: owner,
      body: {
        name: 'Lindqvist Fastigheter AB',
        orgNumber: '556677-8899',
        email: 'hej@lindqvist.example',
        status: 'ACTIVE',
      },
    });
    expect(response.statusCode).toBe(201);
    const customer = response.json<CustomerDto>();
    expect(customer).toMatchObject({
      name: 'Lindqvist Fastigheter AB',
      orgNumber: '556677-8899',
      email: 'hej@lindqvist.example',
      status: 'ACTIVE',
    });
    // Cleared/optional fields normalize to null, not undefined.
    expect(customer.phone).toBeNull();
    expect(customer.notes).toBeNull();
  });

  it('gets a customer by id', async () => {
    const created = await createCustomerViaApi(ctx, owner, { name: 'Solgarden Restaurang' });
    const response = await api(ctx.app, 'GET', `/v1/customers/${created.id}`, { session: owner });
    expect(response.statusCode).toBe(200);
    expect(response.json<CustomerDto>().name).toBe('Solgarden Restaurang');
  });

  it('returns 404 for an unknown customer id', async () => {
    const response = await api(
      ctx.app,
      'GET',
      '/v1/customers/00000000-0000-0000-0000-000000000000',
      { session: owner },
    );
    expect(response.statusCode).toBe(404);
  });

  it('lists customers with a status filter', async () => {
    await createCustomerViaApi(ctx, owner, { name: 'Lead One', status: 'LEAD' });
    await createCustomerViaApi(ctx, owner, { name: 'Active One', status: 'ACTIVE' });

    const response = await api(ctx.app, 'GET', '/v1/customers?status=LEAD', { session: owner });
    expect(response.statusCode).toBe(200);
    const page = response.json<Paginated<CustomerDto>>();
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.name).toBe('Lead One');
  });

  it('lists customers with a case-insensitive search over name/email/orgNumber', async () => {
    await createCustomerViaApi(ctx, owner, { name: 'Berg & Soner Bygg', orgNumber: '551234-0001' });
    await createCustomerViaApi(ctx, owner, {
      name: 'Unrelated Co',
      email: 'someone@soner-mail.example',
    });
    await createCustomerViaApi(ctx, owner, { name: 'Totally Different' });

    const byName = await api(ctx.app, 'GET', '/v1/customers?search=soner', { session: owner });
    expect(byName.statusCode).toBe(200);
    const names = byName
      .json<Paginated<CustomerDto>>()
      .items.map((c) => c.name)
      .sort();
    expect(names).toEqual(['Berg & Soner Bygg', 'Unrelated Co']);

    const byOrgNumber = await api(ctx.app, 'GET', '/v1/customers?search=551234', {
      session: owner,
    });
    expect(byOrgNumber.json<Paginated<CustomerDto>>().items.map((c) => c.name)).toEqual([
      'Berg & Soner Bygg',
    ]);
  });

  it('updates a customer', async () => {
    const created = await createCustomerViaApi(ctx, owner, { name: 'Old Name' });
    const response = await api(ctx.app, 'PATCH', `/v1/customers/${created.id}`, {
      session: owner,
      body: { name: 'New Name', phone: '+46 70 000 00 00' },
    });
    expect(response.statusCode).toBe(200);
    const updated = response.json<CustomerDto>();
    expect(updated.name).toBe('New Name');
    expect(updated.phone).toBe('+46 70 000 00 00');
  });

  it('emits a customer.created activity row AND an audit row on create', async () => {
    const created = await createCustomerViaApi(ctx, owner, { name: 'Traceable Kund' });

    const activity = await ctx.prisma.activity.findFirst({
      where: { organizationId: orgId, type: 'customer.created', customerId: created.id },
    });
    expect(activity).not.toBeNull();
    expect(activity?.actorUserId).toBe(owner.userId);

    const audit = await ctx.prisma.auditLog.findFirst({
      where: { organizationId: orgId, action: 'customer.created', entityId: created.id },
    });
    expect(audit).not.toBeNull();
  });

  it('archiving a customer records customer.archived (activity + audit)', async () => {
    const created = await createCustomerViaApi(ctx, owner, {
      name: 'To Archive',
      status: 'ACTIVE',
    });
    const response = await api(ctx.app, 'PATCH', `/v1/customers/${created.id}`, {
      session: owner,
      body: { status: 'ARCHIVED' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<CustomerDto>().status).toBe('ARCHIVED');

    const activity = await ctx.prisma.activity.findFirst({
      where: { organizationId: orgId, type: 'customer.archived', customerId: created.id },
    });
    expect(activity).not.toBeNull();

    const audit = await ctx.prisma.auditLog.findFirst({
      where: { organizationId: orgId, action: 'customer.archived', entityId: created.id },
    });
    expect(audit).not.toBeNull();

    // A plain status change that is not to ARCHIVED records customer.updated instead.
    const another = await createCustomerViaApi(ctx, owner, { name: 'Stays Active' });
    await api(ctx.app, 'PATCH', `/v1/customers/${another.id}`, {
      session: owner,
      body: { status: 'LEAD' },
    });
    expect(
      await ctx.prisma.activity.count({
        where: { organizationId: orgId, type: 'customer.archived', customerId: another.id },
      }),
    ).toBe(0);
    expect(
      await ctx.prisma.activity.count({
        where: { organizationId: orgId, type: 'customer.updated', customerId: another.id },
      }),
    ).toBe(1);
  });
});
