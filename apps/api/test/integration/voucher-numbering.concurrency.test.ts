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

/** Parses the numeric suffix of a voucher number (e.g. "V-00007" → 7). */
function numOf(voucherNumber: string | null): number {
  if (!voucherNumber) throw new Error('expected a voucher number');
  return Number(voucherNumber.slice(2));
}

// Mirrors billing.concurrency.test.ts: the row lock (SELECT ... FOR UPDATE)
// inside the post transaction must serialize concurrent posts so numbers are
// distinct and gap-free, and one draft is never posted twice.
describe('voucher numbering concurrency (Phase 5)', () => {
  let owner: Actor;
  let bank: AccountDto;
  let sales: AccountDto;

  beforeEach(async () => {
    await truncateAll(ctx.prisma);
    owner = await createUser(ctx.app, `vnum-owner-${Date.now()}@test.local`);
    await createOrgViaApi(ctx.app, owner, 'Numbering AB');
    bank = await createAccountViaApi(ctx, owner, { code: '1930', name: 'Bank', type: 'ASSET' });
    sales = await createAccountViaApi(ctx, owner, { code: '3010', name: 'Sales', type: 'REVENUE' });
    await createFiscalYearViaApi(ctx, owner);
  });

  function draft(): Promise<VoucherDto> {
    return createVoucherViaApi(ctx, owner, [debit(bank.id, 100_000), credit(sales.id, 100_000)], {
      date: VOUCHER_DATE,
    });
  }

  it('two concurrent posts of one draft: exactly one succeeds, one number consumed', async () => {
    const v = await draft();
    const [a, b] = await Promise.all([
      api(ctx.app, 'POST', `/v1/accounting/vouchers/${v.id}/post`, { session: owner }),
      api(ctx.app, 'POST', `/v1/accounting/vouchers/${v.id}/post`, { session: owner }),
    ]);
    const codes = [a.statusCode, b.statusCode].sort();
    expect(codes).toEqual([200, 409]); // one posts, the other is rejected

    const posted = (
      await api(ctx.app, 'GET', `/v1/accounting/vouchers/${v.id}`, { session: owner })
    ).json<VoucherDto>();
    expect(posted.status).toBe('POSTED');
    expect(posted.number).toBe('V-00001');

    // The sequence advanced by exactly one — no gap, no wasted number.
    const seq = await ctx.prisma.numberSequence.findFirst({ where: { kind: 'VOUCHER' } });
    expect(seq?.next).toBe(2);
  });

  it('several distinct drafts posted in parallel get distinct, gap-free numbers', async () => {
    const count = 6;
    const drafts: VoucherDto[] = [];
    for (let i = 0; i < count; i += 1) drafts.push(await draft());

    const responses = await Promise.all(
      drafts.map((d) =>
        api(ctx.app, 'POST', `/v1/accounting/vouchers/${d.id}/post`, { session: owner }),
      ),
    );
    // Every post succeeds.
    for (const res of responses) expect(res.statusCode).toBe(200);

    const numbers = responses
      .map((res) => numOf(res.json<VoucherDto>().number))
      .sort((x, y) => x - y);
    // Distinct and contiguous 1..count.
    expect(new Set(numbers).size).toBe(count);
    expect(numbers).toEqual(Array.from({ length: count }, (_, i) => i + 1));

    const seq = await ctx.prisma.numberSequence.findFirst({ where: { kind: 'VOUCHER' } });
    expect(seq?.next).toBe(count + 1);
  });
});
