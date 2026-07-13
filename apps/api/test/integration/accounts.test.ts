import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AccountDto, Paginated } from '@businessos/types';
import {
  api,
  createAccountViaApi,
  createOrgViaApi,
  createTestContext,
  createUser,
  createVoucherViaApi,
  credit,
  debit,
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

describe('chart of accounts (Phase 5)', () => {
  let owner: Actor;

  beforeEach(async () => {
    await truncateAll(ctx.prisma);
    owner = await createUser(ctx.app, `accts-owner-${Date.now()}@test.local`);
    await createOrgViaApi(ctx.app, owner, 'Ledger AB');
  });

  it('creates an account and reads it back', async () => {
    const created = await api(ctx.app, 'POST', '/v1/accounting/accounts', {
      session: owner,
      body: { code: '1930', name: 'Bank', type: 'ASSET' },
    });
    expect(created.statusCode).toBe(201);
    const account = created.json<AccountDto>();
    expect(account.code).toBe('1930');
    expect(account.type).toBe('ASSET');
    expect(account.isActive).toBe(true);

    const fetched = await api(ctx.app, 'GET', `/v1/accounting/accounts/${account.id}`, {
      session: owner,
    });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json<AccountDto>().id).toBe(account.id);

    const list = await api(ctx.app, 'GET', '/v1/accounting/accounts', { session: owner });
    expect(list.statusCode).toBe(200);
    expect(list.json<Paginated<AccountDto>>().items.map((a) => a.id)).toContain(account.id);
  });

  it('rejects a duplicate code with 409 duplicate_code', async () => {
    await createAccountViaApi(ctx, owner, { code: '3010', name: 'Sales', type: 'REVENUE' });
    const dup = await api(ctx.app, 'POST', '/v1/accounting/accounts', {
      session: owner,
      body: { code: '3010', name: 'Other Sales', type: 'REVENUE' },
    });
    expect(dup.statusCode).toBe(409);
    expect(errorCode(dup.body)).toBe('duplicate_code');
  });

  it('updates name and deactivates via PATCH', async () => {
    const account = await createAccountViaApi(ctx, owner, {
      code: '4000',
      name: 'COGS',
      type: 'EXPENSE',
    });

    const rename = await api(ctx.app, 'PATCH', `/v1/accounting/accounts/${account.id}`, {
      session: owner,
      body: { name: 'Cost of goods sold' },
    });
    expect(rename.statusCode).toBe(200);
    expect(rename.json<AccountDto>().name).toBe('Cost of goods sold');

    const deactivate = await api(ctx.app, 'PATCH', `/v1/accounting/accounts/${account.id}`, {
      session: owner,
      body: { isActive: false },
    });
    expect(deactivate.statusCode).toBe(200);
    expect(deactivate.json<AccountDto>().isActive).toBe(false);
  });

  it('deletes an unused account (204) but keeps one with journal entries (409 account_in_use)', async () => {
    const unused = await createAccountViaApi(ctx, owner, {
      code: '5000',
      name: 'Unused',
      type: 'EXPENSE',
    });
    const del = await api(ctx.app, 'DELETE', `/v1/accounting/accounts/${unused.id}`, {
      session: owner,
    });
    expect(del.statusCode).toBe(204);
    expect(await ctx.prisma.account.count({ where: { id: unused.id } })).toBe(0);

    // An account referenced by even a DRAFT voucher line cannot be deleted.
    const bank = await createAccountViaApi(ctx, owner, {
      code: '1930',
      name: 'Bank',
      type: 'ASSET',
    });
    const sales = await createAccountViaApi(ctx, owner, {
      code: '3010',
      name: 'Sales',
      type: 'REVENUE',
    });
    await createVoucherViaApi(ctx, owner, [debit(bank.id, 100_000), credit(sales.id, 100_000)]);

    const blocked = await api(ctx.app, 'DELETE', `/v1/accounting/accounts/${bank.id}`, {
      session: owner,
    });
    expect(blocked.statusCode).toBe(409);
    expect(errorCode(blocked.body)).toBe('account_in_use');
    // The account survives for the audit trail.
    expect(await ctx.prisma.account.count({ where: { id: bank.id } })).toBe(1);
  });

  it('scopes accounts per org: B cannot see, edit or delete A account (404)', async () => {
    const accountA = await createAccountViaApi(ctx, owner, {
      code: '1930',
      name: 'A Bank',
      type: 'ASSET',
    });

    const userB = await createUser(ctx.app, `accts-b-${Date.now()}@test.local`);
    await createOrgViaApi(ctx.app, userB, 'Other AB');

    const list = await api(ctx.app, 'GET', '/v1/accounting/accounts?pageSize=100', {
      session: userB,
    });
    expect(list.json<Paginated<AccountDto>>().items.map((a) => a.id)).not.toContain(accountA.id);

    expect(
      (await api(ctx.app, 'GET', `/v1/accounting/accounts/${accountA.id}`, { session: userB }))
        .statusCode,
    ).toBe(404);
    expect(
      (
        await api(ctx.app, 'PATCH', `/v1/accounting/accounts/${accountA.id}`, {
          session: userB,
          body: { name: 'Hijacked' },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await api(ctx.app, 'DELETE', `/v1/accounting/accounts/${accountA.id}`, { session: userB }))
        .statusCode,
    ).toBe(404);
    // Untouched.
    const row = await ctx.prisma.account.findUniqueOrThrow({ where: { id: accountA.id } });
    expect(row.name).toBe('A Bank');
  });
});
