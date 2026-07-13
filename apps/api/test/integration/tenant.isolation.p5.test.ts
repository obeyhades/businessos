import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type {
  AccountDto,
  FiscalYearDto,
  Paginated,
  TrialBalanceDto,
  VoucherDto,
} from '@businessos/types';
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

const VOUCHER_DATE = '2026-06-15';

// Every Phase 5 ledger resource of org A must be invisible and immutable to org B.
describe('tenant isolation (Phase 5 accounting)', () => {
  let userA: Actor;
  let userB: Actor;
  let bankA: AccountDto;
  let salesA: AccountDto;
  let fiscalYearA: FiscalYearDto;
  let draftA: VoucherDto;
  let postedA: VoucherDto;

  beforeEach(async () => {
    await truncateAll(ctx.prisma);
    userA = await createUser(ctx.app, `p5-a-${Date.now()}@test.local`);
    userB = await createUser(ctx.app, `p5-b-${Date.now()}@test.local`);
    await createOrgViaApi(ctx.app, userA, 'Alpha Ledger');
    await createOrgViaApi(ctx.app, userB, 'Beta Ledger');

    // Org A ledger data.
    bankA = await createAccountViaApi(ctx, userA, { code: '1930', name: 'A Bank', type: 'ASSET' });
    salesA = await createAccountViaApi(ctx, userA, {
      code: '3010',
      name: 'A Sales',
      type: 'REVENUE',
    });
    fiscalYearA = await createFiscalYearViaApi(ctx, userA);
    draftA = await createVoucherViaApi(
      ctx,
      userA,
      [debit(bankA.id, 100_000), credit(salesA.id, 100_000)],
      {
        date: VOUCHER_DATE,
      },
    );
    const toPost = await createVoucherViaApi(
      ctx,
      userA,
      [debit(bankA.id, 40_000), credit(salesA.id, 40_000)],
      { date: VOUCHER_DATE },
    );
    postedA = await postVoucherViaApi(ctx, userA, toPost.id);

    // Org B gets its own data so lists/reports are not trivially empty.
    const bankB = await createAccountViaApi(ctx, userB, {
      code: '1930',
      name: 'B Bank',
      type: 'ASSET',
    });
    const salesB = await createAccountViaApi(ctx, userB, {
      code: '3010',
      name: 'B Sales',
      type: 'REVENUE',
    });
    await createFiscalYearViaApi(ctx, userB);
    const bDraft = await createVoucherViaApi(
      ctx,
      userB,
      [debit(bankB.id, 25_000), credit(salesB.id, 25_000)],
      { date: VOUCHER_DATE },
    );
    await postVoucherViaApi(ctx, userB, bDraft.id);
  });

  it("B's account list excludes A rows; GET/PATCH/DELETE A account is 404", async () => {
    const list = await api(ctx.app, 'GET', '/v1/accounting/accounts?pageSize=100', {
      session: userB,
    });
    expect(list.json<Paginated<AccountDto>>().items.map((a) => a.id)).not.toContain(bankA.id);

    expect(
      (await api(ctx.app, 'GET', `/v1/accounting/accounts/${bankA.id}`, { session: userB }))
        .statusCode,
    ).toBe(404);
    expect(
      (
        await api(ctx.app, 'PATCH', `/v1/accounting/accounts/${bankA.id}`, {
          session: userB,
          body: { name: 'Hijacked' },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await api(ctx.app, 'DELETE', `/v1/accounting/accounts/${bankA.id}`, { session: userB }))
        .statusCode,
    ).toBe(404);
    const row = await ctx.prisma.account.findUniqueOrThrow({ where: { id: bankA.id } });
    expect(row.name).toBe('A Bank');
  });

  it("B's voucher list excludes A rows; B cannot GET/PATCH/DELETE A voucher (404)", async () => {
    const list = await api(ctx.app, 'GET', '/v1/accounting/vouchers?pageSize=100', {
      session: userB,
    });
    const ids = list.json<Paginated<VoucherDto>>().items.map((v) => v.id);
    expect(ids).not.toContain(draftA.id);
    expect(ids).not.toContain(postedA.id);

    expect(
      (await api(ctx.app, 'GET', `/v1/accounting/vouchers/${draftA.id}`, { session: userB }))
        .statusCode,
    ).toBe(404);
    expect(
      (
        await api(ctx.app, 'PATCH', `/v1/accounting/vouchers/${draftA.id}`, {
          session: userB,
          body: { description: 'Hijacked' },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await api(ctx.app, 'DELETE', `/v1/accounting/vouchers/${draftA.id}`, { session: userB }))
        .statusCode,
    ).toBe(404);
  });

  it("B cannot post A's draft or reverse A's posted voucher (404), and A is unchanged", async () => {
    const post = await api(ctx.app, 'POST', `/v1/accounting/vouchers/${draftA.id}/post`, {
      session: userB,
    });
    expect(post.statusCode).toBe(404);

    const reverse = await api(ctx.app, 'POST', `/v1/accounting/vouchers/${postedA.id}/reverse`, {
      session: userB,
      body: { date: '2026-06-20' },
    });
    expect(reverse.statusCode).toBe(404);

    // A's draft is still an unnumbered draft; A's posted voucher is still POSTED, not reversed.
    const stillDraft = await ctx.prisma.voucher.findUniqueOrThrow({ where: { id: draftA.id } });
    expect(stillDraft.status).toBe('DRAFT');
    expect(stillDraft.number).toBeNull();
    const stillPosted = await ctx.prisma.voucher.findUniqueOrThrow({ where: { id: postedA.id } });
    expect(stillPosted.status).toBe('POSTED');
  });

  it("B's fiscal-year list excludes A rows; GET A fiscal year is 404", async () => {
    const list = await api(ctx.app, 'GET', '/v1/accounting/fiscal-years', { session: userB });
    expect(list.json<FiscalYearDto[]>().map((y) => y.id)).not.toContain(fiscalYearA.id);

    expect(
      (
        await api(ctx.app, 'GET', `/v1/accounting/fiscal-years/${fiscalYearA.id}`, {
          session: userB,
        })
      ).statusCode,
    ).toBe(404);
  });

  it("B's trial balance never includes A's accounts", async () => {
    const tb = (
      await api(ctx.app, 'GET', '/v1/accounting/reports/trial-balance', { session: userB })
    ).json<TrialBalanceDto>();
    const accountIds = tb.rows.map((r) => r.accountId);
    expect(accountIds).not.toContain(bankA.id);
    expect(accountIds).not.toContain(salesA.id);
    // B only sees its own balanced books (its single 25 000 voucher).
    expect(tb.totalDebitMinor).toBe(25_000);
    expect(tb.totalCreditMinor).toBe(25_000);
    expect(tb.isBalanced).toBe(true);
  });
});
