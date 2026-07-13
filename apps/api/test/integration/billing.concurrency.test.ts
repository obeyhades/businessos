import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CreditNoteDto, InvoiceDto, PaymentDto, QuoteDto } from '@businessos/types';
import {
  api,
  createCustomerViaApi,
  createInvoiceViaApi,
  createOrgViaApi,
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
    description: 'Svc',
    quantity: 1,
    unitPriceMinor: 100_000,
    discountPercent: 0,
    taxRatePercent: 25,
  },
];

// These exercise concurrent mutations of the SAME document, which the row-lock
// (SELECT ... FOR UPDATE) inside each transaction must serialize. Without it
// they double-finalize, lose payments, over-credit, or double-convert.
describe('billing concurrency (row-locked transitions)', () => {
  let owner: Actor;
  let customerId: string;

  beforeEach(async () => {
    await truncateAll(ctx.prisma);
    owner = await createUser(ctx.app, `billing-conc-${Date.now()}@test.local`);
    await createOrgViaApi(ctx.app, owner, 'Concurrency Co');
    customerId = (await createCustomerViaApi(ctx, owner, { name: 'Cust', email: 'c@test.local' }))
      .id;
  });

  it('two concurrent finalizes of one draft: exactly one succeeds, no wasted number', async () => {
    const draft = await createInvoiceViaApi(ctx, owner, customerId, LINE);
    const [a, b] = await Promise.all([
      api(ctx.app, 'POST', `/v1/invoices/${draft.id}/finalize`, { session: owner }),
      api(ctx.app, 'POST', `/v1/invoices/${draft.id}/finalize`, { session: owner }),
    ]);
    const codes = [a.statusCode, b.statusCode].sort();
    expect(codes).toEqual([200, 409]); // one finalizes, the other is rejected

    // The invoice has exactly one number, and the sequence advanced by exactly 1.
    const invoice = (
      await api(ctx.app, 'GET', `/v1/invoices/${draft.id}`, { session: owner })
    ).json<InvoiceDto>();
    expect(invoice.number).toBe('INV-0001');
    const seq = await ctx.prisma.numberSequence.findFirst({ where: { kind: 'INVOICE' } });
    expect(seq?.next).toBe(2); // consumed exactly one → no gap
  });

  it('two concurrent payments cannot overpay or lose an update', async () => {
    const draft = await createInvoiceViaApi(ctx, owner, customerId, LINE); // total 125000
    await finalizeInvoiceViaApi(ctx, owner, draft.id);
    // Amount due is 125000. Fire two payments of 100000 each concurrently.
    const [a, b] = await Promise.all([
      api(ctx.app, 'POST', `/v1/invoices/${draft.id}/payments`, {
        session: owner,
        body: { amountMinor: 100_000, method: 'CASH', paidOn: '2026-07-13' },
      }),
      api(ctx.app, 'POST', `/v1/invoices/${draft.id}/payments`, {
        session: owner,
        body: { amountMinor: 100_000, method: 'CASH', paidOn: '2026-07-13' },
      }),
    ]);
    const codes = [a.statusCode, b.statusCode].sort();
    // One fits (100000 <= 125000); the second would overpay (200000 > 125000) → 400.
    expect(codes).toEqual([201, 400]);

    const invoice = (
      await api(ctx.app, 'GET', `/v1/invoices/${draft.id}`, { session: owner })
    ).json<InvoiceDto>();
    // Recorded paid equals the single accepted payment; amount due never negative.
    const payments = (
      await api(ctx.app, 'GET', `/v1/invoices/${draft.id}/payments`, { session: owner })
    ).json<PaymentDto[]>();
    const totalPaid = payments.reduce((sum, p) => sum + p.amountMinor, 0);
    expect(invoice.amountPaidMinor).toBe(totalPaid);
    expect(invoice.amountDueMinor).toBeGreaterThanOrEqual(0);
  });

  it('two concurrent full credit notes cannot exceed the invoice total', async () => {
    const draft = await createInvoiceViaApi(ctx, owner, customerId, LINE); // total 125000
    await finalizeInvoiceViaApi(ctx, owner, draft.id);
    const [a, b] = await Promise.all([
      api(ctx.app, 'POST', `/v1/invoices/${draft.id}/credit-notes`, { session: owner, body: {} }),
      api(ctx.app, 'POST', `/v1/invoices/${draft.id}/credit-notes`, { session: owner, body: {} }),
    ]);
    const codes = [a.statusCode, b.statusCode].sort();
    expect(codes).toEqual([201, 400]); // one full credit, the other over_credit

    const creditNotes = (
      await api(ctx.app, 'GET', `/v1/invoices/${draft.id}/credit-notes`, { session: owner })
    ).json<CreditNoteDto[]>();
    const totalCredited = creditNotes.reduce((sum, c) => sum + c.totalMinor, 0);
    const invoice = (
      await api(ctx.app, 'GET', `/v1/invoices/${draft.id}`, { session: owner })
    ).json<InvoiceDto>();
    expect(totalCredited).toBeLessThanOrEqual(invoice.totalMinor);
    expect(invoice.creditedMinor).toBe(totalCredited);
  });

  it('two concurrent converts of one accepted quote create exactly one invoice', async () => {
    const quote: QuoteDto = await createQuoteViaApi(ctx, owner, customerId, LINE);
    await api(ctx.app, 'POST', `/v1/quotes/${quote.id}/accept`, { session: owner });
    const [a, b] = await Promise.all([
      api(ctx.app, 'POST', `/v1/quotes/${quote.id}/convert`, { session: owner }),
      api(ctx.app, 'POST', `/v1/quotes/${quote.id}/convert`, { session: owner }),
    ]);
    const codes = [a.statusCode, b.statusCode].sort();
    expect(codes).toEqual([201, 409]); // one converts, the other already_converted

    const invoices = await ctx.prisma.invoice.count({ where: { customerId } });
    expect(invoices).toBe(1); // exactly one invoice, never two
  });
});
