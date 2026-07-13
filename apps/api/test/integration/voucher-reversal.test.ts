import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AccountDto, TrialBalanceDto, VoucherDto } from '@businessos/types';
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
const REVERSAL_DATE = '2026-06-20'; // same OPEN June period.

describe('voucher reversal (Phase 5)', () => {
  let owner: Actor;
  let bank: AccountDto;
  let sales: AccountDto;

  beforeEach(async () => {
    await truncateAll(ctx.prisma);
    owner = await createUser(ctx.app, `vrev-owner-${Date.now()}@test.local`);
    await createOrgViaApi(ctx.app, owner, 'Reversal AB');
    bank = await createAccountViaApi(ctx, owner, { code: '1930', name: 'Bank', type: 'ASSET' });
    sales = await createAccountViaApi(ctx, owner, { code: '3010', name: 'Sales', type: 'REVENUE' });
    await createFiscalYearViaApi(ctx, owner);
  });

  async function postOriginal(): Promise<VoucherDto> {
    const draft = await createVoucherViaApi(
      ctx,
      owner,
      [debit(bank.id, 100_000), credit(sales.id, 100_000)],
      { date: VOUCHER_DATE },
    );
    return postVoucherViaApi(ctx, owner, draft.id);
  }

  async function bankBalanceMinor(): Promise<number> {
    const tb = (
      await api(ctx.app, 'GET', '/v1/accounting/reports/trial-balance', { session: owner })
    ).json<TrialBalanceDto>();
    const row = tb.rows.find((r) => r.accountId === bank.id);
    return row?.balanceMinor ?? 0;
  }

  it('reverses a POSTED voucher: 201, swapped lines, links both ways, original REVERSED', async () => {
    const original = await postOriginal();
    expect(await bankBalanceMinor()).toBe(100_000);

    const res = await api(ctx.app, 'POST', `/v1/accounting/vouchers/${original.id}/reverse`, {
      session: owner,
      body: { date: REVERSAL_DATE },
    });
    expect(res.statusCode).toBe(201);
    const reversal = res.json<VoucherDto>();

    expect(reversal.status).toBe('POSTED');
    expect(reversal.reversesVoucherId).toBe(original.id);
    expect(reversal.number).toBe('V-00002');

    // Every line's debit/credit is swapped relative to the original.
    const origByAccount = new Map(original.lines.map((l) => [l.accountId, l]));
    for (const line of reversal.lines) {
      const orig = origByAccount.get(line.accountId)!;
      expect(line.debitMinor).toBe(orig.creditMinor);
      expect(line.creditMinor).toBe(orig.debitMinor);
    }

    // The original is now REVERSED and points back at its reversal.
    const refetched = (
      await api(ctx.app, 'GET', `/v1/accounting/vouchers/${original.id}`, { session: owner })
    ).json<VoucherDto>();
    expect(refetched.status).toBe('REVERSED');
    expect(refetched.reversedByVoucherId).toBe(reversal.id);

    // The pair nets to zero: the account balance returns to its pre-original value.
    expect(await bankBalanceMinor()).toBe(0);
  });

  it('a draft voucher cannot be reversed (409 not_reversible)', async () => {
    const draft = await createVoucherViaApi(
      ctx,
      owner,
      [debit(bank.id, 100_000), credit(sales.id, 100_000)],
      { date: VOUCHER_DATE },
    );
    const res = await api(ctx.app, 'POST', `/v1/accounting/vouchers/${draft.id}/reverse`, {
      session: owner,
      body: { date: REVERSAL_DATE },
    });
    expect(res.statusCode).toBe(409);
    expect(errorCode(res.body)).toBe('not_reversible');
  });

  it('an already-reversed voucher cannot be reversed again (409)', async () => {
    const original = await postOriginal();
    const first = await api(ctx.app, 'POST', `/v1/accounting/vouchers/${original.id}/reverse`, {
      session: owner,
      body: { date: REVERSAL_DATE },
    });
    expect(first.statusCode).toBe(201);

    const second = await api(ctx.app, 'POST', `/v1/accounting/vouchers/${original.id}/reverse`, {
      session: owner,
      body: { date: REVERSAL_DATE },
    });
    // Re-reversal is rejected with 409. Reversing flips the original to REVERSED,
    // so the status guard (`not_reversible`) fires before the redundant
    // `already_reversed` guard — the latter is effectively unreachable via the
    // API. The observable contract (can't reverse it twice) holds either way.
    expect(second.statusCode).toBe(409);
    expect(errorCode(second.body)).toBe('not_reversible');
    // Exactly one reversal exists for the original.
    expect(await ctx.prisma.voucher.count({ where: { reversesVoucherId: original.id } })).toBe(1);
  });
});
