import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AccountDto, TrialBalanceDto, TrialBalanceRow } from '@businessos/types';
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

async function trialBalance(actor: Actor, query = ''): Promise<TrialBalanceDto> {
  const res = await api(ctx.app, 'GET', `/v1/accounting/reports/trial-balance${query}`, {
    session: actor,
  });
  if (res.statusCode !== 200) throw new Error(`trial-balance ${res.statusCode}: ${res.body}`);
  return res.json<TrialBalanceDto>();
}

function rowFor(tb: TrialBalanceDto, accountId: string): TrialBalanceRow | undefined {
  return tb.rows.find((r) => r.accountId === accountId);
}

describe('trial balance report (Phase 5)', () => {
  let owner: Actor;
  let bank: AccountDto;
  let sales: AccountDto;
  let expense: AccountDto;

  beforeEach(async () => {
    await truncateAll(ctx.prisma);
    owner = await createUser(ctx.app, `tb-owner-${Date.now()}@test.local`);
    await createOrgViaApi(ctx.app, owner, 'Trial Balance AB');
    bank = await createAccountViaApi(ctx, owner, { code: '1930', name: 'Bank', type: 'ASSET' });
    sales = await createAccountViaApi(ctx, owner, { code: '3010', name: 'Sales', type: 'REVENUE' });
    expense = await createAccountViaApi(ctx, owner, {
      code: '4000',
      name: 'Costs',
      type: 'EXPENSE',
    });
    await createFiscalYearViaApi(ctx, owner);

    // Two posted, balanced vouchers in different months.
    const v1 = await createVoucherViaApi(
      ctx,
      owner,
      [debit(bank.id, 100_000), credit(sales.id, 100_000)],
      { date: '2026-06-15' },
    );
    await postVoucherViaApi(ctx, owner, v1.id);
    const v2 = await createVoucherViaApi(
      ctx,
      owner,
      [debit(expense.id, 30_000), credit(bank.id, 30_000)],
      { date: '2026-07-05' },
    );
    await postVoucherViaApi(ctx, owner, v2.id);
  });

  it('totals balance and per-account balanceMinor = debit − credit', async () => {
    const tb = await trialBalance(owner);
    expect(tb.totalDebitMinor).toBe(130_000);
    expect(tb.totalCreditMinor).toBe(130_000);
    expect(tb.totalDebitMinor).toBe(tb.totalCreditMinor);
    expect(tb.isBalanced).toBe(true);

    expect(rowFor(tb, bank.id)).toMatchObject({
      debitMinor: 100_000,
      creditMinor: 30_000,
      balanceMinor: 70_000,
    });
    expect(rowFor(tb, sales.id)).toMatchObject({
      debitMinor: 0,
      creditMinor: 100_000,
      balanceMinor: -100_000,
    });
    expect(rowFor(tb, expense.id)).toMatchObject({
      debitMinor: 30_000,
      creditMinor: 0,
      balanceMinor: 30_000,
    });

    // The signed balances of all accounts always net to zero in double entry.
    const netBalance = tb.rows.reduce((sum, r) => sum + r.balanceMinor, 0);
    expect(netBalance).toBe(0);
  });

  it('includeDrafts=false excludes drafts; includeDrafts=true includes them', async () => {
    // Add an UNPOSTED draft: Dr bank 50000 / Cr sales 50000.
    await createVoucherViaApi(ctx, owner, [debit(bank.id, 50_000), credit(sales.id, 50_000)], {
      date: '2026-06-16',
    });

    const excluded = await trialBalance(owner, '?includeDrafts=false');
    expect(excluded.totalDebitMinor).toBe(130_000);
    expect(rowFor(excluded, bank.id)?.balanceMinor).toBe(70_000);

    const included = await trialBalance(owner, '?includeDrafts=true');
    expect(included.totalDebitMinor).toBe(180_000);
    expect(included.totalCreditMinor).toBe(180_000);
    expect(included.isBalanced).toBe(true);
    expect(rowFor(included, bank.id)?.balanceMinor).toBe(120_000);
    expect(rowFor(included, sales.id)?.balanceMinor).toBe(-150_000);
  });

  it('date-range filter counts only vouchers in the window', async () => {
    // July only: just the expense/bank voucher.
    const july = await trialBalance(owner, '?from=2026-07-01&to=2026-07-31');
    expect(july.totalDebitMinor).toBe(30_000);
    expect(july.totalCreditMinor).toBe(30_000);
    expect(rowFor(july, expense.id)?.balanceMinor).toBe(30_000);
    expect(rowFor(july, bank.id)?.balanceMinor).toBe(-30_000);
    // The sales account had no July activity, so it is absent.
    expect(rowFor(july, sales.id)).toBeUndefined();
  });
});
