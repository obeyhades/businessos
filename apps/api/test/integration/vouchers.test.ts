import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AccountDto, VoucherDto } from '@businessos/types';
import {
  addMemberViaInvitation,
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

// A voucher dated inside the auto-generated 2026 monthly periods.
const VOUCHER_DATE = '2026-06-15';

describe('vouchers: draft, balance and posting (Phase 5)', () => {
  let owner: Actor;
  let bank: AccountDto;
  let sales: AccountDto;

  beforeEach(async () => {
    await truncateAll(ctx.prisma);
    owner = await createUser(ctx.app, `vouchers-owner-${Date.now()}@test.local`);
    await createOrgViaApi(ctx.app, owner, 'Vouchers AB');
    bank = await createAccountViaApi(ctx, owner, { code: '1930', name: 'Bank', type: 'ASSET' });
    sales = await createAccountViaApi(ctx, owner, { code: '3010', name: 'Sales', type: 'REVENUE' });
  });

  it('creates a balanced draft; balance is NOT required and isBalanced reflects the lines', async () => {
    const balanced = await createVoucherViaApi(
      ctx,
      owner,
      [debit(bank.id, 100_000), credit(sales.id, 100_000)],
      { date: VOUCHER_DATE },
    );
    expect(balanced.status).toBe('DRAFT');
    expect(balanced.number).toBeNull();
    expect(balanced.totalDebitMinor).toBe(100_000);
    expect(balanced.totalCreditMinor).toBe(100_000);
    expect(balanced.isBalanced).toBe(true);
    expect(balanced.lines).toHaveLength(2);

    // An unbalanced draft is allowed to exist; isBalanced is false.
    const unbalanced = await createVoucherViaApi(
      ctx,
      owner,
      [debit(bank.id, 100_000), credit(sales.id, 60_000)],
      { date: VOUCHER_DATE },
    );
    expect(unbalanced.status).toBe('DRAFT');
    expect(unbalanced.totalDebitMinor).toBe(100_000);
    expect(unbalanced.totalCreditMinor).toBe(60_000);
    expect(unbalanced.isBalanced).toBe(false);
  });

  it('rejects a line with both a debit and a credit (400 validation)', async () => {
    const res = await api(ctx.app, 'POST', '/v1/accounting/vouchers', {
      session: owner,
      body: {
        date: VOUCHER_DATE,
        description: 'Bad line',
        lines: [
          { accountId: bank.id, debitMinor: 100_000, creditMinor: 100_000 },
          credit(sales.id, 100_000),
        ],
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a line with neither a debit nor a credit (400 validation)', async () => {
    const res = await api(ctx.app, 'POST', '/v1/accounting/vouchers', {
      session: owner,
      body: {
        date: VOUCHER_DATE,
        description: 'Zero line',
        lines: [{ accountId: bank.id, debitMinor: 0, creditMinor: 0 }, credit(sales.id, 100_000)],
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a create with fewer than two lines (400 validation)', async () => {
    const res = await api(ctx.app, 'POST', '/v1/accounting/vouchers', {
      session: owner,
      body: { date: VOUCHER_DATE, description: 'Single', lines: [debit(bank.id, 100_000)] },
    });
    expect(res.statusCode).toBe(400);
  });

  describe('post', () => {
    beforeEach(async () => {
      // An open covering period so the happy-path post is not blocked on periods.
      await createFiscalYearViaApi(ctx, owner);
    });

    it('posts a balanced voucher: assigns V-00001, sets POSTED, stamps postedAt', async () => {
      const draft = await createVoucherViaApi(
        ctx,
        owner,
        [debit(bank.id, 100_000), credit(sales.id, 100_000)],
        { date: VOUCHER_DATE },
      );
      const res = await api(ctx.app, 'POST', `/v1/accounting/vouchers/${draft.id}/post`, {
        session: owner,
      });
      expect(res.statusCode).toBe(200);
      const posted = res.json<VoucherDto>();
      expect(posted.status).toBe('POSTED');
      expect(posted.number).toBe('V-00001');
      expect(posted.postedAt).not.toBeNull();
      expect(posted.fiscalPeriodId).not.toBeNull();
      expect(posted.isBalanced).toBe(true);
    });

    it('refuses to post an unbalanced voucher (400 unbalanced)', async () => {
      const draft = await createVoucherViaApi(
        ctx,
        owner,
        [debit(bank.id, 100_000), credit(sales.id, 60_000)],
        { date: VOUCHER_DATE },
      );
      const res = await api(ctx.app, 'POST', `/v1/accounting/vouchers/${draft.id}/post`, {
        session: owner,
      });
      expect(res.statusCode).toBe(400);
      expect(errorCode(res.body)).toBe('unbalanced');
      // Still a numberless draft.
      const row = await ctx.prisma.voucher.findUniqueOrThrow({ where: { id: draft.id } });
      expect(row.status).toBe('DRAFT');
      expect(row.number).toBeNull();
    });

    it('refuses to post a balanced-but-zero voucher (400 zero_voucher)', async () => {
      const draft = await createVoucherViaApi(
        ctx,
        owner,
        [debit(bank.id, 100_000), credit(sales.id, 100_000)],
        { date: VOUCHER_DATE },
      );
      // Rewrite both lines to zero directly (the create contract forbids zero
      // lines, so we reach the post-time zero guard via the DB).
      await ctx.prisma.voucherLine.updateMany({
        where: { voucherId: draft.id },
        data: { debitMinor: 0, creditMinor: 0 },
      });
      const res = await api(ctx.app, 'POST', `/v1/accounting/vouchers/${draft.id}/post`, {
        session: owner,
      });
      expect(res.statusCode).toBe(400);
      expect(errorCode(res.body)).toBe('zero_voucher');
    });

    it('refuses to post a single-line voucher (400 too_few_lines)', async () => {
      const draft = await createVoucherViaApi(
        ctx,
        owner,
        [debit(bank.id, 100_000), credit(sales.id, 100_000)],
        { date: VOUCHER_DATE },
      );
      // Drop one line directly to reach the post-time min-lines guard.
      const line = await ctx.prisma.voucherLine.findFirstOrThrow({
        where: { voucherId: draft.id },
      });
      await ctx.prisma.voucherLine.delete({ where: { id: line.id } });
      const res = await api(ctx.app, 'POST', `/v1/accounting/vouchers/${draft.id}/post`, {
        session: owner,
      });
      expect(res.statusCode).toBe(400);
      expect(errorCode(res.body)).toBe('too_few_lines');
    });
  });

  it('posting requires accounting.post: a manager without it is 403', async () => {
    await createFiscalYearViaApi(ctx, owner);
    const draft = await createVoucherViaApi(
      ctx,
      owner,
      [debit(bank.id, 100_000), credit(sales.id, 100_000)],
      { date: VOUCHER_DATE },
    );
    // MANAGER has no accounting.* permission at all.
    const manager = await addMemberViaInvitation(
      ctx,
      owner,
      `vouchers-mgr-${Date.now()}@test.local`,
      'MANAGER',
    );
    const res = await api(ctx.app, 'POST', `/v1/accounting/vouchers/${draft.id}/post`, {
      session: manager,
    });
    expect(res.statusCode).toBe(403);
  });
});
