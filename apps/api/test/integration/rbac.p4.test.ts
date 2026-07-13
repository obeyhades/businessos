import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { hasPermission } from '@businessos/types';
import type { CustomerDto, InvoiceDto } from '@businessos/types';
import {
  addMemberViaInvitation,
  api,
  createCustomerViaApi,
  createInvoiceViaApi,
  createOrgViaApi,
  createTestContext,
  createUser,
  destroyTestContext,
  finalizeInvoiceViaApi,
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

const LINE = [
  {
    description: 'Item',
    quantity: 1,
    unitPriceMinor: 10000,
    discountPercent: 0,
    taxRatePercent: 25,
  },
];

// Guards are asserted against the matrix in packages/types/src/permissions.ts.
describe('RBAC (Phase 4 invoices)', () => {
  let owner: Actor;
  let employee: Actor;
  let readonly: Actor;
  let accountant: Actor;
  let customer: CustomerDto;
  let draftInvoice: InvoiceDto;
  let openInvoice: InvoiceDto;

  beforeEach(async () => {
    await truncateAll(ctx.prisma);
    owner = await createUser(ctx.app, 'rbac4-owner@example.com');
    await createOrgViaApi(ctx.app, owner, 'RBAC Billing AB');
    employee = await addMemberViaInvitation(ctx, owner, 'rbac4-emp@example.com', 'EMPLOYEE');
    readonly = await addMemberViaInvitation(ctx, owner, 'rbac4-ro@example.com', 'READONLY');
    accountant = await addMemberViaInvitation(ctx, owner, 'rbac4-acc@example.com', 'ACCOUNTANT');

    customer = await createCustomerViaApi(ctx, owner, { name: 'Billable Co' });
    draftInvoice = await createInvoiceViaApi(ctx, owner, customer.id, LINE);
    const anotherDraft = await createInvoiceViaApi(ctx, owner, customer.id, LINE);
    openInvoice = await finalizeInvoiceViaApi(ctx, owner, anotherDraft.id);
  });

  describe('EMPLOYEE (no invoices.* at all)', () => {
    it('matrix: EMPLOYEE lacks invoices.read and invoices.manage', () => {
      expect(hasPermission('EMPLOYEE', 'invoices.read')).toBe(false);
      expect(hasPermission('EMPLOYEE', 'invoices.manage')).toBe(false);
    });

    it('is forbidden from every billing read (403)', async () => {
      for (const path of ['invoices', 'quotes', 'products']) {
        const res = await api(ctx.app, 'GET', `/v1/${path}`, { session: employee });
        expect(res.statusCode, path).toBe(403);
      }
    });
  });

  describe('READONLY (invoices.read only)', () => {
    it('matrix: READONLY has read but not manage', () => {
      expect(hasPermission('READONLY', 'invoices.read')).toBe(true);
      expect(hasPermission('READONLY', 'invoices.manage')).toBe(false);
    });

    it('can read billing lists (200)', async () => {
      for (const path of ['invoices', 'quotes', 'products']) {
        const res = await api(ctx.app, 'GET', `/v1/${path}`, { session: readonly });
        expect(res.statusCode, path).toBe(200);
      }
    });

    it('cannot create, finalize or pay (403)', async () => {
      const create = await api(ctx.app, 'POST', '/v1/invoices', {
        session: readonly,
        body: {
          customerId: customer.id,
          issueDate: '2026-01-15',
          dueDate: '2026-02-14',
          lineItems: LINE,
        },
      });
      expect(create.statusCode).toBe(403);

      const finalize = await api(ctx.app, 'POST', `/v1/invoices/${draftInvoice.id}/finalize`, {
        session: readonly,
      });
      expect(finalize.statusCode).toBe(403);

      const pay = await api(ctx.app, 'POST', `/v1/invoices/${openInvoice.id}/payments`, {
        session: readonly,
        body: { amountMinor: 100, method: 'CASH', paidOn: '2026-01-20' },
      });
      expect(pay.statusCode).toBe(403);

      const product = await api(ctx.app, 'POST', '/v1/products', {
        session: readonly,
        body: { name: 'Nope' },
      });
      expect(product.statusCode).toBe(403);
    });
  });

  describe('ACCOUNTANT (invoices.read + invoices.manage)', () => {
    it('matrix: ACCOUNTANT has both read and manage', () => {
      expect(hasPermission('ACCOUNTANT', 'invoices.read')).toBe(true);
      expect(hasPermission('ACCOUNTANT', 'invoices.manage')).toBe(true);
    });

    it('can read, create, finalize and pay (2xx)', async () => {
      const list = await api(ctx.app, 'GET', '/v1/invoices', { session: accountant });
      expect(list.statusCode).toBe(200);

      const product = await api(ctx.app, 'POST', '/v1/products', {
        session: accountant,
        body: { name: 'Accountant Product' },
      });
      expect(product.statusCode).toBe(201);

      const created = await api(ctx.app, 'POST', '/v1/invoices', {
        session: accountant,
        body: {
          customerId: customer.id,
          issueDate: '2026-01-15',
          dueDate: '2026-02-14',
          lineItems: LINE,
        },
      });
      expect(created.statusCode).toBe(201);
      const invoiceId = created.json<InvoiceDto>().id;

      const finalize = await api(ctx.app, 'POST', `/v1/invoices/${invoiceId}/finalize`, {
        session: accountant,
      });
      expect(finalize.statusCode).toBe(200);

      const pay = await api(ctx.app, 'POST', `/v1/invoices/${invoiceId}/payments`, {
        session: accountant,
        body: { amountMinor: 100, method: 'CASH', paidOn: '2026-01-20' },
      });
      expect(pay.statusCode).toBe(201);
    });
  });
});
