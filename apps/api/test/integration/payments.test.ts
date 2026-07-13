import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CustomerDto, InvoiceDto, PaymentDto } from '@businessos/types';
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
    description: 'Work',
    quantity: 2,
    unitPriceMinor: 10000,
    discountPercent: 0,
    taxRatePercent: 25,
  },
]; // total 25000

const PAY_ON = '2026-01-20';

function errorCode(body: string): string {
  return (JSON.parse(body) as { error: { code: string } }).error.code;
}

async function pay(
  owner: Actor,
  invoiceId: string,
  amountMinor: number,
): Promise<{ statusCode: number; body: string; json: () => PaymentDto }> {
  const res = await api(ctx.app, 'POST', `/v1/invoices/${invoiceId}/payments`, {
    session: owner,
    body: { amountMinor, method: 'BANK_TRANSFER', paidOn: PAY_ON },
  });
  return { statusCode: res.statusCode, body: res.body, json: () => res.json<PaymentDto>() };
}

async function getInvoice(owner: Actor, id: string): Promise<InvoiceDto> {
  const res = await api(ctx.app, 'GET', `/v1/invoices/${id}`, { session: owner });
  return res.json<InvoiceDto>();
}

describe('payments and invoice status recomputation', () => {
  let owner: Actor;
  let customer: CustomerDto;

  beforeEach(async () => {
    await truncateAll(ctx.prisma);
    owner = await createUser(ctx.app, 'pay-owner@example.com');
    await createOrgViaApi(ctx.app, owner, 'Payments AB');
    customer = await createCustomerViaApi(ctx, owner, {
      name: 'Debtor AB',
      email: 'debtor@example.com',
    });
  });

  async function openInvoice(): Promise<InvoiceDto> {
    const draft = await createInvoiceViaApi(ctx, owner, customer.id, LINE);
    return finalizeInvoiceViaApi(ctx, owner, draft.id);
  }

  it('a partial payment yields PARTIALLY_PAID and drops the amount due', async () => {
    const invoice = await openInvoice();
    expect(invoice.amountDueMinor).toBe(25000);

    const first = await pay(owner, invoice.id, 10000);
    expect(first.statusCode).toBe(201);

    const after = await getInvoice(owner, invoice.id);
    expect(after.status).toBe('PARTIALLY_PAID');
    expect(after.amountPaidMinor).toBe(10000);
    expect(after.amountDueMinor).toBe(15000);
    expect(after.paidAt).toBeNull();
  });

  it('paying the remainder yields PAID with paidAt set', async () => {
    const invoice = await openInvoice();
    await pay(owner, invoice.id, 10000);
    const remainder = await pay(owner, invoice.id, 15000);
    expect(remainder.statusCode).toBe(201);

    const after = await getInvoice(owner, invoice.id);
    expect(after.status).toBe('PAID');
    expect(after.amountDueMinor).toBe(0);
    expect(after.paidAt).not.toBeNull();
  });

  it('overpayment beyond the amount due is 400 overpayment', async () => {
    const invoice = await openInvoice();
    const over = await pay(owner, invoice.id, 25001);
    expect(over.statusCode).toBe(400);
    expect(errorCode(over.body)).toBe('overpayment');

    // A payment that would exceed the remaining due after a partial is also rejected.
    await pay(owner, invoice.id, 20000);
    const overRemainder = await pay(owner, invoice.id, 5001);
    expect(overRemainder.statusCode).toBe(400);
    expect(errorCode(overRemainder.body)).toBe('overpayment');
    // Nothing changed from the rejected attempt.
    const after = await getInvoice(owner, invoice.id);
    expect(after.amountPaidMinor).toBe(20000);
    expect(after.status).toBe('PARTIALLY_PAID');
  });

  it('deleting a payment recomputes the status back', async () => {
    const invoice = await openInvoice();
    const first = await pay(owner, invoice.id, 25000);
    const paymentId = first.json().id;
    expect((await getInvoice(owner, invoice.id)).status).toBe('PAID');

    const del = await api(ctx.app, 'DELETE', `/v1/invoices/${invoice.id}/payments/${paymentId}`, {
      session: owner,
    });
    expect(del.statusCode).toBe(204);

    const after = await getInvoice(owner, invoice.id);
    expect(after.amountPaidMinor).toBe(0);
    expect(after.amountDueMinor).toBe(25000);
    // Back to OPEN (never sent), no paidAt.
    expect(after.status).toBe('OPEN');
    expect(after.paidAt).toBeNull();
  });

  it('paying a DRAFT invoice is 409 not_payable', async () => {
    const draft = await createInvoiceViaApi(ctx, owner, customer.id, LINE);
    const res = await pay(owner, draft.id, 100);
    expect(res.statusCode).toBe(409);
    expect(errorCode(res.body)).toBe('not_payable');
  });

  it('paying a CANCELLED invoice is 409 not_payable', async () => {
    const invoice = await openInvoice();
    const cancel = await api(ctx.app, 'POST', `/v1/invoices/${invoice.id}/cancel`, {
      session: owner,
    });
    expect(cancel.statusCode).toBe(200);
    const res = await pay(owner, invoice.id, 100);
    expect(res.statusCode).toBe(409);
    expect(errorCode(res.body)).toBe('not_payable');
  });

  it('a full payment on a SENT invoice yields PAID', async () => {
    const invoice = await openInvoice();
    const send = await api(ctx.app, 'POST', `/v1/invoices/${invoice.id}/send`, {
      session: owner,
      body: {},
    });
    expect(send.statusCode).toBe(200);
    expect(send.json<InvoiceDto>().status).toBe('SENT');

    const paid = await pay(owner, invoice.id, 25000);
    expect(paid.statusCode).toBe(201);
    const after = await getInvoice(owner, invoice.id);
    expect(after.status).toBe('PAID');
    expect(after.amountDueMinor).toBe(0);
  });
});
