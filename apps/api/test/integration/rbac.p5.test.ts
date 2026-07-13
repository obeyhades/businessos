import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { hasPermission } from '@businessos/types';
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

// Guards asserted against the matrix in packages/types/src/permissions.ts.
describe('RBAC (Phase 5 accounting)', () => {
  let owner: Actor;
  let accountant: Actor;
  let readonly: Actor;
  let manager: Actor;
  let employee: Actor;
  let bank: AccountDto;
  let sales: AccountDto;
  let draft: VoucherDto;

  beforeEach(async () => {
    await truncateAll(ctx.prisma);
    owner = await createUser(ctx.app, `rbac5-owner-${Date.now()}@test.local`);
    await createOrgViaApi(ctx.app, owner, 'RBAC Accounting AB');
    accountant = await addMemberViaInvitation(ctx, owner, 'rbac5-acc@example.com', 'ACCOUNTANT');
    readonly = await addMemberViaInvitation(ctx, owner, 'rbac5-ro@example.com', 'READONLY');
    manager = await addMemberViaInvitation(ctx, owner, 'rbac5-mgr@example.com', 'MANAGER');
    employee = await addMemberViaInvitation(ctx, owner, 'rbac5-emp@example.com', 'EMPLOYEE');

    bank = await createAccountViaApi(ctx, owner, { code: '1930', name: 'Bank', type: 'ASSET' });
    sales = await createAccountViaApi(ctx, owner, { code: '3010', name: 'Sales', type: 'REVENUE' });
    await createFiscalYearViaApi(ctx, owner);
    draft = await createVoucherViaApi(
      ctx,
      owner,
      [debit(bank.id, 100_000), credit(sales.id, 100_000)],
      {
        date: VOUCHER_DATE,
      },
    );
  });

  describe('ACCOUNTANT (read + manage + post)', () => {
    it('matrix: ACCOUNTANT has all three accounting permissions', () => {
      expect(hasPermission('ACCOUNTANT', 'accounting.read')).toBe(true);
      expect(hasPermission('ACCOUNTANT', 'accounting.manage')).toBe(true);
      expect(hasPermission('ACCOUNTANT', 'accounting.post')).toBe(true);
    });

    it('can read, create accounts, and post a voucher (2xx)', async () => {
      expect(
        (await api(ctx.app, 'GET', '/v1/accounting/accounts', { session: accountant })).statusCode,
      ).toBe(200);

      const created = await api(ctx.app, 'POST', '/v1/accounting/accounts', {
        session: accountant,
        body: { code: '4000', name: 'Costs', type: 'EXPENSE' },
      });
      expect(created.statusCode).toBe(201);

      const post = await api(ctx.app, 'POST', `/v1/accounting/vouchers/${draft.id}/post`, {
        session: accountant,
      });
      expect(post.statusCode).toBe(200);
      expect(post.json<VoucherDto>().status).toBe('POSTED');

      const reverse = await api(ctx.app, 'POST', `/v1/accounting/vouchers/${draft.id}/reverse`, {
        session: accountant,
        body: { date: '2026-06-20' },
      });
      expect(reverse.statusCode).toBe(201);
    });
  });

  describe('READONLY (read only)', () => {
    it('matrix: READONLY has read but not manage or post', () => {
      expect(hasPermission('READONLY', 'accounting.read')).toBe(true);
      expect(hasPermission('READONLY', 'accounting.manage')).toBe(false);
      expect(hasPermission('READONLY', 'accounting.post')).toBe(false);
    });

    it('can read accounting endpoints (200)', async () => {
      for (const path of [
        'accounts',
        'vouchers',
        'fiscal-years',
        'mapping',
        'reports/trial-balance',
        'reports/general-ledger',
      ]) {
        const res = await api(ctx.app, 'GET', `/v1/accounting/${path}`, { session: readonly });
        expect(res.statusCode, path).toBe(200);
      }
    });

    it('cannot create an account, create/post a voucher (403)', async () => {
      const account = await api(ctx.app, 'POST', '/v1/accounting/accounts', {
        session: readonly,
        body: { code: '9999', name: 'Nope', type: 'ASSET' },
      });
      expect(account.statusCode).toBe(403);

      const voucher = await api(ctx.app, 'POST', '/v1/accounting/vouchers', {
        session: readonly,
        body: {
          date: VOUCHER_DATE,
          description: 'Nope',
          lines: [debit(bank.id, 100_000), credit(sales.id, 100_000)],
        },
      });
      expect(voucher.statusCode).toBe(403);

      const post = await api(ctx.app, 'POST', `/v1/accounting/vouchers/${draft.id}/post`, {
        session: readonly,
      });
      expect(post.statusCode).toBe(403);
    });
  });

  describe('MANAGER and EMPLOYEE (no accounting.* at all)', () => {
    it('matrix: neither has any accounting permission', () => {
      for (const role of ['MANAGER', 'EMPLOYEE'] as const) {
        expect(hasPermission(role, 'accounting.read')).toBe(false);
        expect(hasPermission(role, 'accounting.manage')).toBe(false);
        expect(hasPermission(role, 'accounting.post')).toBe(false);
      }
    });

    it('are forbidden from every accounting endpoint (403)', async () => {
      for (const actor of [manager, employee]) {
        // Reads.
        for (const path of [
          'accounts',
          'vouchers',
          'fiscal-years',
          'mapping',
          'reports/trial-balance',
        ]) {
          const res = await api(ctx.app, 'GET', `/v1/accounting/${path}`, { session: actor });
          expect(res.statusCode, `GET ${path}`).toBe(403);
        }
        // Writes.
        const account = await api(ctx.app, 'POST', '/v1/accounting/accounts', {
          session: actor,
          body: { code: '8888', name: 'Nope', type: 'ASSET' },
        });
        expect(account.statusCode).toBe(403);

        const post = await api(ctx.app, 'POST', `/v1/accounting/vouchers/${draft.id}/post`, {
          session: actor,
        });
        expect(post.statusCode).toBe(403);
      }
    });
  });
});
