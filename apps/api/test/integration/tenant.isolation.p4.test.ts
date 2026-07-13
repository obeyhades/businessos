import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CustomerDto, InvoiceDto, Paginated, ProductDto, QuoteDto } from '@businessos/types';
import {
  api,
  createCustomerViaApi,
  createInvoiceViaApi,
  createOrgViaApi,
  createProductViaApi,
  createQuoteViaApi,
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
    description: 'Billable',
    quantity: 2,
    unitPriceMinor: 10000,
    discountPercent: 0,
    taxRatePercent: 25,
  },
];

// Every Phase 4 resource of org A must be invisible and immutable to org B.
describe('tenant isolation (Phase 4 billing)', () => {
  let userA: Actor;
  let userB: Actor;
  let productA: ProductDto;
  let quoteA: QuoteDto;
  let invoiceA: InvoiceDto;

  beforeEach(async () => {
    await truncateAll(ctx.prisma);
    userA = await createUser(ctx.app, 'p4-a@example.com');
    userB = await createUser(ctx.app, 'p4-b@example.com');
    await createOrgViaApi(ctx.app, userA, 'Alpha Billing');
    await createOrgViaApi(ctx.app, userB, 'Beta Billing');

    const customerA: CustomerDto = await createCustomerViaApi(ctx, userA, {
      name: 'Alpha Client',
      email: 'client@alpha.example',
    });
    productA = await createProductViaApi(ctx, userA, { name: 'Alpha Product' });
    quoteA = await createQuoteViaApi(ctx, userA, customerA.id, LINE);
    // Accept it so a convert attempt by B would otherwise succeed if not scoped.
    await api(ctx.app, 'POST', `/v1/quotes/${quoteA.id}/accept`, { session: userA });

    const draftA = await createInvoiceViaApi(ctx, userA, customerA.id, LINE);
    invoiceA = await finalizeInvoiceViaApi(ctx, userA, draftA.id);
    // A payment and a credit note so those child collections are non-empty.
    await api(ctx.app, 'POST', `/v1/invoices/${invoiceA.id}/payments`, {
      session: userA,
      body: { amountMinor: 10000, method: 'BANK_TRANSFER', paidOn: '2026-01-20' },
    });
    await api(ctx.app, 'POST', `/v1/invoices/${invoiceA.id}/credit-notes`, {
      session: userA,
      body: {
        lineItems: [{ description: 'Adj', quantity: 1, unitPriceMinor: 5000, taxRatePercent: 25 }],
      },
    });

    // Give B its own billing data so lists are not trivially empty.
    const customerB = await createCustomerViaApi(ctx, userB, { name: 'Beta Client' });
    await createProductViaApi(ctx, userB, { name: 'Beta Product' });
    await createQuoteViaApi(ctx, userB, customerB.id, LINE);
    const draftB = await createInvoiceViaApi(ctx, userB, customerB.id, LINE);
    await finalizeInvoiceViaApi(ctx, userB, draftB.id);
  });

  it("B's product list excludes A rows; GET/PATCH/DELETE A product is 404", async () => {
    const list = await api(ctx.app, 'GET', '/v1/products?pageSize=100', { session: userB });
    expect(list.json<Paginated<ProductDto>>().items.map((p) => p.id)).not.toContain(productA.id);

    expect(
      (await api(ctx.app, 'GET', `/v1/products/${productA.id}`, { session: userB })).statusCode,
    ).toBe(404);
    expect(
      (
        await api(ctx.app, 'PATCH', `/v1/products/${productA.id}`, {
          session: userB,
          body: { name: 'Hijacked' },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await api(ctx.app, 'DELETE', `/v1/products/${productA.id}`, { session: userB })).statusCode,
    ).toBe(404);
    // Untouched in the DB.
    const row = await ctx.prisma.product.findUniqueOrThrow({ where: { id: productA.id } });
    expect(row.name).toBe('Alpha Product');
  });

  it("B's quote list excludes A rows; B cannot GET/mutate/convert A quote (404)", async () => {
    const list = await api(ctx.app, 'GET', '/v1/quotes?pageSize=100', { session: userB });
    expect(list.json<Paginated<QuoteDto>>().items.map((q) => q.id)).not.toContain(quoteA.id);

    expect(
      (await api(ctx.app, 'GET', `/v1/quotes/${quoteA.id}`, { session: userB })).statusCode,
    ).toBe(404);
    expect(
      (
        await api(ctx.app, 'PATCH', `/v1/quotes/${quoteA.id}`, {
          session: userB,
          body: { customerNotes: 'x' },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await api(ctx.app, 'POST', `/v1/quotes/${quoteA.id}/convert`, { session: userB }))
        .statusCode,
    ).toBe(404);
    // A's quote was not converted.
    const row = await ctx.prisma.quote.findUniqueOrThrow({ where: { id: quoteA.id } });
    expect(row.convertedInvoiceId).toBeNull();
  });

  it("B's invoice list excludes A rows; B cannot GET/PATCH/DELETE/finalize A invoice (404)", async () => {
    const list = await api(ctx.app, 'GET', '/v1/invoices?pageSize=100', { session: userB });
    expect(list.json<Paginated<InvoiceDto>>().items.map((i) => i.id)).not.toContain(invoiceA.id);

    for (const [method, url] of [
      ['GET', `/v1/invoices/${invoiceA.id}`],
      ['DELETE', `/v1/invoices/${invoiceA.id}`],
      ['POST', `/v1/invoices/${invoiceA.id}/finalize`],
    ] as const) {
      expect((await api(ctx.app, method, url, { session: userB })).statusCode, url).toBe(404);
    }
    expect(
      (
        await api(ctx.app, 'PATCH', `/v1/invoices/${invoiceA.id}`, {
          session: userB,
          body: { customerNotes: 'x' },
        })
      ).statusCode,
    ).toBe(404);
  });

  it("B cannot register a payment or a credit note on A's invoice (404 on parent)", async () => {
    const payment = await api(ctx.app, 'POST', `/v1/invoices/${invoiceA.id}/payments`, {
      session: userB,
      body: { amountMinor: 100, method: 'CASH', paidOn: '2026-01-20' },
    });
    expect(payment.statusCode).toBe(404);

    const credit = await api(ctx.app, 'POST', `/v1/invoices/${invoiceA.id}/credit-notes`, {
      session: userB,
      body: {},
    });
    expect(credit.statusCode).toBe(404);

    // A's child collections are unchanged (still exactly one payment, one CN).
    expect(await ctx.prisma.payment.count({ where: { invoiceId: invoiceA.id } })).toBe(1);
    expect(await ctx.prisma.creditNote.count({ where: { invoiceId: invoiceA.id } })).toBe(1);
  });

  it("B cannot read A's payments, credit notes, pdf-url or activity (404)", async () => {
    for (const path of ['payments', 'credit-notes', 'pdf-url', 'activity']) {
      const res = await api(ctx.app, 'GET', `/v1/invoices/${invoiceA.id}/${path}`, {
        session: userB,
      });
      expect(res.statusCode, path).toBe(404);
    }
  });
});
