import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CustomerDto, InvoiceDto } from '@businessos/types';
import {
  createCustomerViaApi,
  createInvoiceViaApi,
  createOrgViaApi,
  createTestContext,
  createUser,
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

// The server owns all money math (öre / integer minor units, HALF_UP at the
// line level). These specs feed tricky inputs through the real HTTP path and
// assert the persisted, returned totals to the öre — money must never drift.
describe('money correctness (server-computed totals)', () => {
  let owner: Actor;
  let customer: CustomerDto;

  beforeEach(async () => {
    await truncateAll(ctx.prisma);
    owner = await createUser(ctx.app, 'money-owner@example.com');
    await createOrgViaApi(ctx.app, owner, 'Money AB');
    customer = await createCustomerViaApi(ctx, owner, { name: 'Payer AB' });
  });

  it('(a) fractional qty + discount + VAT: net 22500, tax 5625, total 28125', async () => {
    const invoice = await createInvoiceViaApi(ctx, owner, customer.id, [
      {
        description: 'Consulting',
        quantity: 2.5,
        unitPriceMinor: 10000,
        discountPercent: 10,
        taxRatePercent: 25,
      },
    ]);
    expect(invoice.subtotalMinor).toBe(22500);
    expect(invoice.discountMinor).toBe(2500);
    expect(invoice.taxMinor).toBe(5625);
    expect(invoice.totalMinor).toBe(28125);
    const line = invoice.lineItems[0]!;
    expect(line.lineNetMinor).toBe(22500);
    expect(line.lineTaxMinor).toBe(5625);
    expect(line.lineTotalMinor).toBe(28125);
  });

  it('(b) half-up rounding line: qty 3 @ 333, 25% VAT → net 999, tax 250', async () => {
    // gross 999; VAT 249.75 rounds half-up to 250.
    const invoice = await createInvoiceViaApi(ctx, owner, customer.id, [
      {
        description: 'Odd unit',
        quantity: 3,
        unitPriceMinor: 333,
        discountPercent: 0,
        taxRatePercent: 25,
      },
    ]);
    expect(invoice.subtotalMinor).toBe(999);
    expect(invoice.taxMinor).toBe(250);
    expect(invoice.totalMinor).toBe(1249);
    const line = invoice.lineItems[0]!;
    expect(line.lineNetMinor).toBe(999);
    expect(line.lineTaxMinor).toBe(250);
  });

  it('(c) multi-rate invoice groups taxLines per rate and totals equal the line sums', async () => {
    const invoice = await createInvoiceViaApi(ctx, owner, customer.id, [
      {
        description: 'Standard-rated',
        quantity: 1,
        unitPriceMinor: 10000,
        discountPercent: 0,
        taxRatePercent: 25,
      },
      {
        description: 'Reduced-rated',
        quantity: 1,
        unitPriceMinor: 5000,
        discountPercent: 0,
        taxRatePercent: 12,
      },
    ]);
    // Grouped, ascending by rate.
    expect(invoice.taxLines).toEqual([
      { ratePercent: '12.00', baseMinor: 5000, taxMinor: 600 },
      { ratePercent: '25.00', baseMinor: 10000, taxMinor: 2500 },
    ]);
    // Header totals equal the exact sums of the rounded line amounts.
    const netSum = invoice.lineItems.reduce((acc, l) => acc + l.lineNetMinor, 0);
    const taxSum = invoice.lineItems.reduce((acc, l) => acc + l.lineTaxMinor, 0);
    expect(invoice.subtotalMinor).toBe(netSum);
    expect(invoice.subtotalMinor).toBe(15000);
    expect(invoice.taxMinor).toBe(taxSum);
    expect(invoice.taxMinor).toBe(3100);
    expect(invoice.totalMinor).toBe(18100);
    // taxLines base/tax sums reconcile with the header.
    const taxLineBase = invoice.taxLines.reduce((acc, t) => acc + t.baseMinor, 0);
    const taxLineTax = invoice.taxLines.reduce((acc, t) => acc + t.taxMinor, 0);
    expect(taxLineBase).toBe(invoice.subtotalMinor);
    expect(taxLineTax).toBe(invoice.taxMinor);
  });

  it('(d) line-level stored amounts match the returned DTO exactly', async () => {
    const invoice = await createInvoiceViaApi(ctx, owner, customer.id, [
      {
        description: 'Line A',
        quantity: 2,
        unitPriceMinor: 12345,
        discountPercent: 7.5,
        taxRatePercent: 25,
      },
      {
        description: 'Line B',
        quantity: 1.333,
        unitPriceMinor: 999,
        discountPercent: 0,
        taxRatePercent: 12,
      },
    ]);
    // Re-read persisted line items straight from the DB and compare to the DTO.
    const stored = await ctx.prisma.invoiceLineItem.findMany({
      where: { invoiceId: invoice.id },
      orderBy: { sortOrder: 'asc' },
    });
    expect(stored).toHaveLength(2);
    invoice.lineItems.forEach((dtoLine, i) => {
      const row = stored[i]!;
      expect(Number(row.lineNetMinor)).toBe(dtoLine.lineNetMinor);
      expect(Number(row.lineTaxMinor)).toBe(dtoLine.lineTaxMinor);
      expect(Number(row.lineTotalMinor)).toBe(dtoLine.lineTotalMinor);
      expect(Number(row.unitPriceMinor)).toBe(dtoLine.unitPriceMinor);
    });
    // Header equals the sum of stored lines.
    const netSum = stored.reduce((acc, l) => acc + Number(l.lineNetMinor), 0);
    const taxSum = stored.reduce((acc, l) => acc + Number(l.lineTaxMinor), 0);
    expect(invoice.subtotalMinor).toBe(netSum);
    expect(invoice.taxMinor).toBe(taxSum);
    expect(invoice.totalMinor).toBe(netSum + taxSum);
  });

  it('recomputing an invoice via PATCH replaces totals deterministically', async () => {
    const invoice: InvoiceDto = await createInvoiceViaApi(ctx, owner, customer.id, [
      {
        description: 'Initial',
        quantity: 1,
        unitPriceMinor: 10000,
        discountPercent: 0,
        taxRatePercent: 25,
      },
    ]);
    expect(invoice.totalMinor).toBe(12500);
    const patched = await ctx.app.inject({
      method: 'PATCH',
      url: `/v1/invoices/${invoice.id}`,
      headers: { origin: 'http://localhost:3100' },
      cookies: { bos_session: owner.cookie },
      payload: {
        lineItems: [
          {
            description: 'Replaced',
            quantity: 2.5,
            unitPriceMinor: 10000,
            discountPercent: 10,
            taxRatePercent: 25,
          },
        ],
      },
    });
    expect(patched.statusCode).toBe(200);
    const updated = patched.json<InvoiceDto>();
    expect(updated.lineItems).toHaveLength(1);
    expect(updated.totalMinor).toBe(28125);
    expect(updated.taxMinor).toBe(5625);
  });
});
