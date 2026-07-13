import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CustomerDto, InvoiceDto, QuoteDto } from '@businessos/types';
import {
  api,
  createCustomerViaApi,
  createOrgViaApi,
  createQuoteViaApi,
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

const LINE = [
  {
    description: 'Design work',
    quantity: 2,
    unitPriceMinor: 10000,
    discountPercent: 0,
    taxRatePercent: 25,
  },
];

function errorCode(body: string): string {
  return (JSON.parse(body) as { error: { code: string } }).error.code;
}

describe('quotes lifecycle', () => {
  let owner: Actor;
  let customer: CustomerDto;

  beforeEach(async () => {
    await truncateAll(ctx.prisma);
    owner = await createUser(ctx.app, 'quote-owner@example.com');
    await createOrgViaApi(ctx.app, owner, 'Quote AB');
    customer = await createCustomerViaApi(ctx, owner, { name: 'Prospect AB' });
  });

  it('creates a DRAFT quote with server-computed totals', async () => {
    const quote = await createQuoteViaApi(ctx, owner, customer.id, LINE);
    expect(quote.status).toBe('DRAFT');
    expect(quote.subtotalMinor).toBe(20000);
    expect(quote.taxMinor).toBe(5000);
    expect(quote.totalMinor).toBe(25000);
    expect(quote.convertedInvoiceId).toBeNull();
  });

  it('a DRAFT quote can be edited; a SENT quote cannot (409 quote_not_draft)', async () => {
    const quote = await createQuoteViaApi(ctx, owner, customer.id, LINE);
    const edit = await api(ctx.app, 'PATCH', `/v1/quotes/${quote.id}`, {
      session: owner,
      body: { customerNotes: 'Draft note' },
    });
    expect(edit.statusCode).toBe(200);

    const sent = await api(ctx.app, 'POST', `/v1/quotes/${quote.id}/send`, { session: owner });
    expect(sent.statusCode).toBe(200);
    expect(sent.json<QuoteDto>().status).toBe('SENT');

    const editSent = await api(ctx.app, 'PATCH', `/v1/quotes/${quote.id}`, {
      session: owner,
      body: { customerNotes: 'Too late' },
    });
    expect(editSent.statusCode).toBe(409);
    expect(errorCode(editSent.body)).toBe('quote_not_draft');
  });

  it('supports send → accept and blocks invalid transitions', async () => {
    const quote = await createQuoteViaApi(ctx, owner, customer.id, LINE);

    const send = await api(ctx.app, 'POST', `/v1/quotes/${quote.id}/send`, { session: owner });
    expect(send.statusCode).toBe(200);
    const accept = await api(ctx.app, 'POST', `/v1/quotes/${quote.id}/accept`, { session: owner });
    expect(accept.statusCode).toBe(200);
    const accepted = accept.json<QuoteDto>();
    expect(accepted.status).toBe('ACCEPTED');
    expect(accepted.acceptedAt).not.toBeNull();

    // An ACCEPTED quote cannot be re-sent or declined.
    const reSend = await api(ctx.app, 'POST', `/v1/quotes/${quote.id}/send`, { session: owner });
    expect(reSend.statusCode).toBe(409);
    expect(errorCode(reSend.body)).toBe('invalid_transition');
    const decline = await api(ctx.app, 'POST', `/v1/quotes/${quote.id}/decline`, {
      session: owner,
    });
    expect(decline.statusCode).toBe(409);
    expect(errorCode(decline.body)).toBe('invalid_transition');
  });

  it('can decline a draft/sent quote and then not accept it', async () => {
    const quote = await createQuoteViaApi(ctx, owner, customer.id, LINE);
    const decline = await api(ctx.app, 'POST', `/v1/quotes/${quote.id}/decline`, {
      session: owner,
    });
    expect(decline.statusCode).toBe(200);
    expect(decline.json<QuoteDto>().status).toBe('DECLINED');

    const accept = await api(ctx.app, 'POST', `/v1/quotes/${quote.id}/accept`, { session: owner });
    expect(accept.statusCode).toBe(409);
    expect(errorCode(accept.body)).toBe('invalid_transition');
  });

  it('converts an ACCEPTED quote into a DRAFT invoice mirroring lines + totals', async () => {
    const quote = await createQuoteViaApi(ctx, owner, customer.id, [
      {
        description: 'Standard',
        quantity: 1,
        unitPriceMinor: 10000,
        discountPercent: 0,
        taxRatePercent: 25,
      },
      {
        description: 'Reduced',
        quantity: 1,
        unitPriceMinor: 5000,
        discountPercent: 0,
        taxRatePercent: 12,
      },
    ]);
    await api(ctx.app, 'POST', `/v1/quotes/${quote.id}/accept`, { session: owner });

    const convert = await api(ctx.app, 'POST', `/v1/quotes/${quote.id}/convert`, {
      session: owner,
    });
    expect(convert.statusCode).toBe(201);
    const invoice = convert.json<InvoiceDto>();
    expect(invoice.status).toBe('DRAFT');
    expect(invoice.number).toBeNull();
    // Totals mirror the quote.
    expect(invoice.subtotalMinor).toBe(quote.subtotalMinor);
    expect(invoice.taxMinor).toBe(quote.taxMinor);
    expect(invoice.totalMinor).toBe(quote.totalMinor);
    expect(invoice.taxLines).toEqual(quote.taxLines);
    // Lines mirror the quote line-for-line (net/tax/total).
    expect(invoice.lineItems).toHaveLength(quote.lineItems.length);
    invoice.lineItems.forEach((line, i) => {
      const src = quote.lineItems[i]!;
      expect(line.description).toBe(src.description);
      expect(line.lineNetMinor).toBe(src.lineNetMinor);
      expect(line.lineTaxMinor).toBe(src.lineTaxMinor);
      expect(line.lineTotalMinor).toBe(src.lineTotalMinor);
    });

    // convertedInvoiceId is now set on the quote.
    const refreshed = await api(ctx.app, 'GET', `/v1/quotes/${quote.id}`, { session: owner });
    expect(refreshed.json<QuoteDto>().convertedInvoiceId).toBe(invoice.id);
  });

  it('converting twice is 409 already_converted', async () => {
    const quote = await createQuoteViaApi(ctx, owner, customer.id, LINE);
    await api(ctx.app, 'POST', `/v1/quotes/${quote.id}/accept`, { session: owner });
    const first = await api(ctx.app, 'POST', `/v1/quotes/${quote.id}/convert`, { session: owner });
    expect(first.statusCode).toBe(201);
    const second = await api(ctx.app, 'POST', `/v1/quotes/${quote.id}/convert`, { session: owner });
    expect(second.statusCode).toBe(409);
    expect(errorCode(second.body)).toBe('already_converted');
  });

  it('converting a non-accepted quote is 409 quote_not_accepted', async () => {
    const quote = await createQuoteViaApi(ctx, owner, customer.id, LINE);
    const convert = await api(ctx.app, 'POST', `/v1/quotes/${quote.id}/convert`, {
      session: owner,
    });
    expect(convert.statusCode).toBe(409);
    expect(errorCode(convert.body)).toBe('quote_not_accepted');
  });

  it('a DRAFT quote can be deleted; a SENT quote cannot', async () => {
    const draft = await createQuoteViaApi(ctx, owner, customer.id, LINE);
    const del = await api(ctx.app, 'DELETE', `/v1/quotes/${draft.id}`, { session: owner });
    expect(del.statusCode).toBe(204);

    const sentQuote = await createQuoteViaApi(ctx, owner, customer.id, LINE);
    await api(ctx.app, 'POST', `/v1/quotes/${sentQuote.id}/send`, { session: owner });
    const delSent = await api(ctx.app, 'DELETE', `/v1/quotes/${sentQuote.id}`, { session: owner });
    expect(delSent.statusCode).toBe(409);
    expect(errorCode(delSent.body)).toBe('quote_not_draft');
  });
});
