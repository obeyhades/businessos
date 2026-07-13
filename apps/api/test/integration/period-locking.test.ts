import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AccountDto, FiscalPeriodDto, FiscalYearDto, VoucherDto } from '@businessos/types';
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

const VOUCHER_DATE = '2026-06-15'; // falls in the auto-generated "2026-06" period.

/** Finds the generated monthly period whose range covers the given ISO date. */
function periodCovering(year: FiscalYearDto, iso: string): FiscalPeriodDto {
  const p = year.periods.find((x) => x.startDate <= iso && x.endDate >= iso);
  if (!p) throw new Error(`No period covers ${iso}`);
  return p;
}

describe('fiscal period locking (Phase 5)', () => {
  let owner: Actor;
  let bank: AccountDto;
  let sales: AccountDto;

  beforeEach(async () => {
    await truncateAll(ctx.prisma);
    owner = await createUser(ctx.app, `plock-owner-${Date.now()}@test.local`);
    await createOrgViaApi(ctx.app, owner, 'Locking AB');
    bank = await createAccountViaApi(ctx, owner, { code: '1930', name: 'Bank', type: 'ASSET' });
    sales = await createAccountViaApi(ctx, owner, { code: '3010', name: 'Sales', type: 'REVENUE' });
  });

  async function draftInPeriod(): Promise<VoucherDto> {
    return createVoucherViaApi(ctx, owner, [debit(bank.id, 100_000), credit(sales.id, 100_000)], {
      date: VOUCHER_DATE,
    });
  }

  it('posting into a LOCKED period is 409 period_locked; unlocking lets it post', async () => {
    const year = await createFiscalYearViaApi(ctx, owner);
    const june = periodCovering(year, VOUCHER_DATE);

    const lock = await api(ctx.app, 'PATCH', `/v1/accounting/periods/${june.id}/status`, {
      session: owner,
      body: { status: 'LOCKED' },
    });
    expect(lock.statusCode).toBe(200);
    expect(lock.json<FiscalPeriodDto>().status).toBe('LOCKED');

    const draft = await draftInPeriod();
    const blocked = await api(ctx.app, 'POST', `/v1/accounting/vouchers/${draft.id}/post`, {
      session: owner,
    });
    expect(blocked.statusCode).toBe(409);
    expect(errorCode(blocked.body)).toBe('period_locked');
    // Not posted, no number consumed.
    const stillDraft = await ctx.prisma.voucher.findUniqueOrThrow({ where: { id: draft.id } });
    expect(stillDraft.status).toBe('DRAFT');
    expect(stillDraft.number).toBeNull();

    // Reopen and retry: it now posts.
    const unlock = await api(ctx.app, 'PATCH', `/v1/accounting/periods/${june.id}/status`, {
      session: owner,
      body: { status: 'OPEN' },
    });
    expect(unlock.statusCode).toBe(200);

    const ok = await api(ctx.app, 'POST', `/v1/accounting/vouchers/${draft.id}/post`, {
      session: owner,
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json<VoucherDto>().status).toBe('POSTED');
  });

  it('posting into a CLOSED period is 409 period_locked', async () => {
    const year = await createFiscalYearViaApi(ctx, owner);
    const june = periodCovering(year, VOUCHER_DATE);
    await api(ctx.app, 'PATCH', `/v1/accounting/periods/${june.id}/status`, {
      session: owner,
      body: { status: 'CLOSED' },
    });

    const draft = await draftInPeriod();
    const res = await api(ctx.app, 'POST', `/v1/accounting/vouchers/${draft.id}/post`, {
      session: owner,
    });
    expect(res.statusCode).toBe(409);
    expect(errorCode(res.body)).toBe('period_locked');
  });

  it('posting with no covering period is 409 no_fiscal_period', async () => {
    // A 2026 fiscal year with periods exists, but this voucher is dated 2027,
    // outside every period → no covering period.
    await createFiscalYearViaApi(ctx, owner);
    const draft = await createVoucherViaApi(
      ctx,
      owner,
      [debit(bank.id, 100_000), credit(sales.id, 100_000)],
      { date: '2027-06-15' },
    );
    const res = await api(ctx.app, 'POST', `/v1/accounting/vouchers/${draft.id}/post`, {
      session: owner,
    });
    expect(res.statusCode).toBe(409);
    expect(errorCode(res.body)).toBe('no_fiscal_period');
  });
});
