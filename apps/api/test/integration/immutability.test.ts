import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CustomerDto, InvoiceDto } from '@businessos/types';
import {
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
    description: 'Service',
    quantity: 2,
    unitPriceMinor: 10000,
    discountPercent: 0,
    taxRatePercent: 25,
  },
];

function errorCode(body: string): string {
  return (JSON.parse(body) as { error: { code: string } }).error.code;
}

describe('invoice immutability after finalize', () => {
  let owner: Actor;
  let customer: CustomerDto;

  beforeEach(async () => {
    await truncateAll(ctx.prisma);
    owner = await createUser(ctx.app, 'immut-owner@example.com');
    await createOrgViaApi(ctx.app, owner, 'Immutable AB');
    customer = await createCustomerViaApi(ctx, owner, { name: 'Client AB' });
  });

  it('a DRAFT invoice can be edited and deleted', async () => {
    const draft = await createInvoiceViaApi(ctx, owner, customer.id, LINE);
    const patch = await api(ctx.app, 'PATCH', `/v1/invoices/${draft.id}`, {
      session: owner,
      body: { customerNotes: 'Please pay promptly' },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json<InvoiceDto>().customerNotes).toBe('Please pay promptly');

    const del = await api(ctx.app, 'DELETE', `/v1/invoices/${draft.id}`, { session: owner });
    expect(del.statusCode).toBe(204);
    expect(await ctx.prisma.invoice.count({ where: { id: draft.id } })).toBe(0);
  });

  it('PATCH on a finalized invoice is 409 invoice_not_draft and changes nothing', async () => {
    const draft = await createInvoiceViaApi(ctx, owner, customer.id, LINE);
    const finalized = await finalizeInvoiceViaApi(ctx, owner, draft.id);

    const before = await ctx.prisma.invoice.findUniqueOrThrow({
      where: { id: finalized.id },
      include: { lineItems: true },
    });

    const patch = await api(ctx.app, 'PATCH', `/v1/invoices/${finalized.id}`, {
      session: owner,
      body: {
        customerNotes: 'Trying to tamper',
        lineItems: [
          {
            description: 'Injected',
            quantity: 99,
            unitPriceMinor: 1,
            discountPercent: 0,
            taxRatePercent: 0,
          },
        ],
      },
    });
    expect(patch.statusCode).toBe(409);
    expect(errorCode(patch.body)).toBe('invoice_not_draft');

    const after = await ctx.prisma.invoice.findUniqueOrThrow({
      where: { id: finalized.id },
      include: { lineItems: true },
    });
    // Header amounts and stored lines are byte-for-byte unchanged.
    expect(after.totalMinor).toBe(before.totalMinor);
    expect(after.subtotalMinor).toBe(before.subtotalMinor);
    expect(after.taxMinor).toBe(before.taxMinor);
    expect(after.customerNotes).toBe(before.customerNotes);
    expect(after.lineItems).toHaveLength(before.lineItems.length);
    expect(after.lineItems.map((l) => l.id).sort()).toEqual(
      before.lineItems.map((l) => l.id).sort(),
    );
  });

  it('DELETE on a finalized invoice is 409 and the row survives', async () => {
    const draft = await createInvoiceViaApi(ctx, owner, customer.id, LINE);
    const finalized = await finalizeInvoiceViaApi(ctx, owner, draft.id);

    const del = await api(ctx.app, 'DELETE', `/v1/invoices/${finalized.id}`, { session: owner });
    expect(del.statusCode).toBe(409);
    expect(errorCode(del.body)).toBe('invoice_not_draft');
    expect(await ctx.prisma.invoice.count({ where: { id: finalized.id } })).toBe(1);
  });

  it('finalizing twice is 409 already_finalized and keeps the original number', async () => {
    const draft = await createInvoiceViaApi(ctx, owner, customer.id, LINE);
    const finalized = await finalizeInvoiceViaApi(ctx, owner, draft.id);

    const again = await api(ctx.app, 'POST', `/v1/invoices/${finalized.id}/finalize`, {
      session: owner,
    });
    expect(again.statusCode).toBe(409);
    expect(errorCode(again.body)).toBe('already_finalized');

    const row = await ctx.prisma.invoice.findUniqueOrThrow({ where: { id: finalized.id } });
    expect(row.number).toBe(finalized.number);
  });

  it('finalizing an invoice with no line items is 400 empty_invoice', async () => {
    // The create contract requires ≥1 line, so strip the lines directly to
    // reach the empty-invoice guard in the finalize route.
    const draft = await createInvoiceViaApi(ctx, owner, customer.id, LINE);
    await ctx.prisma.invoiceLineItem.deleteMany({ where: { invoiceId: draft.id } });

    const finalize = await api(ctx.app, 'POST', `/v1/invoices/${draft.id}/finalize`, {
      session: owner,
    });
    expect(finalize.statusCode).toBe(400);
    expect(errorCode(finalize.body)).toBe('empty_invoice');

    // Still a numberless DRAFT.
    const row = await ctx.prisma.invoice.findUniqueOrThrow({ where: { id: draft.id } });
    expect(row.status).toBe('DRAFT');
    expect(row.number).toBeNull();
  });
});
