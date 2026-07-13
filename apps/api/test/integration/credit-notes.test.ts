import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CreditNoteDto, CustomerDto, InvoiceDto } from '@businessos/types';
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
    description: 'Consulting',
    quantity: 2,
    unitPriceMinor: 10000,
    discountPercent: 0,
    taxRatePercent: 25,
  },
]; // net 20000, tax 5000, total 25000

function errorCode(body: string): string {
  return (JSON.parse(body) as { error: { code: string } }).error.code;
}

async function getInvoice(owner: Actor, id: string): Promise<InvoiceDto> {
  const res = await api(ctx.app, 'GET', `/v1/invoices/${id}`, { session: owner });
  return res.json<InvoiceDto>();
}

describe('credit notes', () => {
  let owner: Actor;
  let customer: CustomerDto;

  beforeEach(async () => {
    await truncateAll(ctx.prisma);
    owner = await createUser(ctx.app, 'cn-owner@example.com');
    await createOrgViaApi(ctx.app, owner, 'Credit AB');
    customer = await createCustomerViaApi(ctx, owner, { name: 'Credited AB' });
  });

  async function finalizedInvoice(): Promise<InvoiceDto> {
    const draft = await createInvoiceViaApi(ctx, owner, customer.id, LINE);
    return finalizeInvoiceViaApi(ctx, owner, draft.id);
  }

  it('a full credit (no lines) mirrors invoice net, sets CREDITED and zeroes amount due', async () => {
    const invoice = await finalizedInvoice();
    const res = await api(ctx.app, 'POST', `/v1/invoices/${invoice.id}/credit-notes`, {
      session: owner,
      body: {},
    });
    expect(res.statusCode).toBe(201);
    const cn = res.json<CreditNoteDto>();
    // Credit note math is exact and mirrors the invoice.
    expect(cn.subtotalMinor).toBe(20000);
    expect(cn.taxMinor).toBe(5000);
    expect(cn.totalMinor).toBe(25000);
    expect(cn.status).toBe('ISSUED');
    expect(cn.number).toBe('CN-0001');

    const after = await getInvoice(owner, invoice.id);
    expect(after.status).toBe('CREDITED');
    expect(after.creditedMinor).toBe(25000);
    expect(after.amountDueMinor).toBe(0);
  });

  it('a partial credit leaves the invoice not fully credited', async () => {
    const invoice = await finalizedInvoice();
    const res = await api(ctx.app, 'POST', `/v1/invoices/${invoice.id}/credit-notes`, {
      session: owner,
      body: {
        lineItems: [
          { description: 'Partial refund', quantity: 1, unitPriceMinor: 5000, taxRatePercent: 25 },
        ],
      },
    });
    expect(res.statusCode).toBe(201);
    const cn = res.json<CreditNoteDto>();
    expect(cn.totalMinor).toBe(6250); // 5000 + 25% VAT

    const after = await getInvoice(owner, invoice.id);
    expect(after.status).not.toBe('CREDITED');
    expect(after.creditedMinor).toBe(6250);
    expect(after.amountDueMinor).toBe(18750);
  });

  it('over-crediting (sum exceeds invoice total) is 400 over_credit', async () => {
    const invoice = await finalizedInvoice();
    // A single note bigger than the whole invoice.
    const tooBig = await api(ctx.app, 'POST', `/v1/invoices/${invoice.id}/credit-notes`, {
      session: owner,
      body: {
        lineItems: [
          { description: 'Too much', quantity: 1, unitPriceMinor: 30000, taxRatePercent: 0 },
        ],
      },
    });
    expect(tooBig.statusCode).toBe(400);
    expect(errorCode(tooBig.body)).toBe('over_credit');

    // Cumulative check: a valid partial, then a second note that would exceed the total.
    const first = await api(ctx.app, 'POST', `/v1/invoices/${invoice.id}/credit-notes`, {
      session: owner,
      body: {
        lineItems: [
          { description: 'Half', quantity: 1, unitPriceMinor: 20000, taxRatePercent: 25 },
        ],
      },
    });
    expect(first.statusCode).toBe(201); // 25000 credited exactly → now fully credited
    const second = await api(ctx.app, 'POST', `/v1/invoices/${invoice.id}/credit-notes`, {
      session: owner,
      body: {
        lineItems: [{ description: 'More', quantity: 1, unitPriceMinor: 100, taxRatePercent: 0 }],
      },
    });
    expect(second.statusCode).toBe(400);
    expect(errorCode(second.body)).toBe('over_credit');
  });

  it('crediting a DRAFT invoice is 409 invoice_not_finalized', async () => {
    const draft = await createInvoiceViaApi(ctx, owner, customer.id, LINE);
    const res = await api(ctx.app, 'POST', `/v1/invoices/${draft.id}/credit-notes`, {
      session: owner,
      body: {},
    });
    expect(res.statusCode).toBe(409);
    expect(errorCode(res.body)).toBe('invoice_not_finalized');
  });

  it('credit notes draw their own CN- sequence', async () => {
    const inv1 = await finalizedInvoice();
    const inv2 = await finalizedInvoice();
    const cn1 = (
      await api(ctx.app, 'POST', `/v1/invoices/${inv1.id}/credit-notes`, {
        session: owner,
        body: {},
      })
    ).json<CreditNoteDto>();
    const cn2 = (
      await api(ctx.app, 'POST', `/v1/invoices/${inv2.id}/credit-notes`, {
        session: owner,
        body: {},
      })
    ).json<CreditNoteDto>();
    expect(cn1.number).toBe('CN-0001');
    expect(cn2.number).toBe('CN-0002');
  });
});
