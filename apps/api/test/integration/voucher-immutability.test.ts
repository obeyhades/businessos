import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AccountDto, VoucherDto } from '@businessos/types';
import {
  api,
  createAccountViaApi,
  createFiscalYearViaApi,
  createOrgViaApi,
  createTestContext,
  createUser,
  createVoucherViaApi,
  credit,
  debit,
  destroyTestContext,
  errorCode,
  postVoucherViaApi,
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

const VOUCHER_DATE = '2026-06-15';

describe('voucher immutability after posting (Phase 5)', () => {
  let owner: Actor;
  let bank: AccountDto;
  let sales: AccountDto;

  beforeEach(async () => {
    await truncateAll(ctx.prisma);
    owner = await createUser(ctx.app, `vimmut-owner-${Date.now()}@test.local`);
    await createOrgViaApi(ctx.app, owner, 'Immutable Ledger AB');
    bank = await createAccountViaApi(ctx, owner, { code: '1930', name: 'Bank', type: 'ASSET' });
    sales = await createAccountViaApi(ctx, owner, { code: '3010', name: 'Sales', type: 'REVENUE' });
    await createFiscalYearViaApi(ctx, owner);
  });

  it('a DRAFT voucher can be edited and deleted', async () => {
    const draft = await createVoucherViaApi(
      ctx,
      owner,
      [debit(bank.id, 100_000), credit(sales.id, 100_000)],
      { date: VOUCHER_DATE },
    );

    const patch = await api(ctx.app, 'PATCH', `/v1/accounting/vouchers/${draft.id}`, {
      session: owner,
      body: { description: 'Corrected description' },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json<VoucherDto>().description).toBe('Corrected description');

    const del = await api(ctx.app, 'DELETE', `/v1/accounting/vouchers/${draft.id}`, {
      session: owner,
    });
    expect(del.statusCode).toBe(204);
    expect(await ctx.prisma.voucher.count({ where: { id: draft.id } })).toBe(0);
  });

  it('a POSTED voucher rejects PATCH (409 voucher_immutable) and stays unchanged', async () => {
    const draft = await createVoucherViaApi(
      ctx,
      owner,
      [debit(bank.id, 100_000), credit(sales.id, 100_000)],
      { date: VOUCHER_DATE },
    );
    const posted = await postVoucherViaApi(ctx, owner, draft.id);

    const patch = await api(ctx.app, 'PATCH', `/v1/accounting/vouchers/${posted.id}`, {
      session: owner,
      body: { description: 'Trying to tamper' },
    });
    expect(patch.statusCode).toBe(409);
    expect(errorCode(patch.body)).toBe('voucher_immutable');

    const row = await ctx.prisma.voucher.findUniqueOrThrow({ where: { id: posted.id } });
    expect(row.description).toBe(posted.description);
    expect(row.status).toBe('POSTED');
    expect(row.number).toBe(posted.number);
  });

  it('a POSTED voucher rejects DELETE (409 voucher_immutable) and survives', async () => {
    const draft = await createVoucherViaApi(
      ctx,
      owner,
      [debit(bank.id, 100_000), credit(sales.id, 100_000)],
      { date: VOUCHER_DATE },
    );
    const posted = await postVoucherViaApi(ctx, owner, draft.id);

    const del = await api(ctx.app, 'DELETE', `/v1/accounting/vouchers/${posted.id}`, {
      session: owner,
    });
    expect(del.statusCode).toBe(409);
    expect(errorCode(del.body)).toBe('voucher_immutable');
    expect(await ctx.prisma.voucher.count({ where: { id: posted.id } })).toBe(1);
  });
});
