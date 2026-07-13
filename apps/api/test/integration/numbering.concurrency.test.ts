import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CreditNoteDto, CustomerDto, InvoiceDto, QuoteDto } from '@businessos/types';
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
    description: 'Widget',
    quantity: 1,
    unitPriceMinor: 10000,
    discountPercent: 0,
    taxRatePercent: 25,
  },
];

/** Extracts the integer sequence value from a document number like "INV-0007". */
function numericPart(number: string): number {
  const match = /(\d+)$/.exec(number);
  if (!match) throw new Error(`No numeric suffix in "${number}"`);
  return Number(match[1]);
}

async function seedDraftInvoices(owner: Actor, customerId: string, n: number): Promise<string[]> {
  const drafts = await Promise.all(
    Array.from({ length: n }, () => createInvoiceViaApi(ctx, owner, customerId, LINE)),
  );
  return drafts.map((d) => d.id);
}

/**
 * Finalizes the first invoice sequentially (which creates the org's INVOICE
 * sequence row), then races the remaining `total - 1` finalizations against the
 * same app so they contend on the row-locked atomic increment. Returns all
 * assigned numbers.
 *
 * The warm-up is required because of the KNOWN BUG documented below: racing the
 * VERY FIRST finalizations for an org+kind explodes on the non-atomic upsert.
 * Once the row exists, the increment path is genuinely concurrency-safe, which
 * is what this helper exercises.
 */
async function warmUpThenRace(owner: Actor, customerId: string, total: number): Promise<string[]> {
  const ids = await seedDraftInvoices(owner, customerId, total);
  const first = await finalizeInvoiceViaApi(ctx, owner, ids[0]!);
  const rest = await Promise.all(ids.slice(1).map((id) => finalizeInvoiceViaApi(ctx, owner, id)));
  return [first, ...rest].map((inv) => inv.number!);
}

describe('numbering concurrency + per-org isolation', () => {
  let ownerA: Actor;
  let customerA: CustomerDto;

  beforeEach(async () => {
    await truncateAll(ctx.prisma);
    ownerA = await createUser(ctx.app, 'num-a@example.com');
    await createOrgViaApi(ctx.app, ownerA, 'Numbering Alpha');
    customerA = await createCustomerViaApi(ctx, ownerA, { name: 'Alpha Customer' });
  });

  it('10 concurrent finalizations (existing sequence) are distinct, gap-free and prefixed', async () => {
    const numbers = await warmUpThenRace(ownerA, customerA.id, 10);

    // Every one got a non-empty INV- number.
    expect(numbers.every((n) => typeof n === 'string' && n.startsWith('INV-'))).toBe(true);
    // Distinct.
    expect(new Set(numbers).size).toBe(10);
    // Gap-free sequential run 1..10.
    const seq = numbers.map(numericPart).sort((a, b) => a - b);
    expect(seq).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    // Zero-padded to 4 digits.
    expect(numbers).toContain('INV-0001');
    expect(numbers).toContain('INV-0010');
  });

  // Racing the FIRST finalizations of a brand-new sequence (no row yet) must
  // not collide: allocateNumber creates the row via an atomic INSERT ... ON
  // CONFLICT DO NOTHING before the row-locked increment, so every concurrent
  // finalize succeeds with a distinct, gap-free number.
  it('racing the first finalizations of a fresh sequence all succeed with distinct numbers', async () => {
    const ids = await seedDraftInvoices(ownerA, customerA.id, 10);
    const results = await Promise.all(
      ids.map((id) => api(ctx.app, 'POST', `/v1/invoices/${id}/finalize`, { session: ownerA })),
    );
    expect(results.every((r) => r.statusCode === 200)).toBe(true);
    const numbers = results.map((r) => r.json<InvoiceDto>().number).filter(Boolean) as string[];
    expect(new Set(numbers).size).toBe(10); // distinct
    const nums = numbers.map(numericPart).sort((a, b) => a - b);
    expect(nums).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]); // gap-free 1..10
  });

  it('per-org sequences are independent (org B restarts at INV-0001)', async () => {
    const numbersA = await warmUpThenRace(ownerA, customerA.id, 5);
    expect(numbersA.map(numericPart).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);

    const ownerB = await createUser(ctx.app, 'num-b@example.com');
    await createOrgViaApi(ctx.app, ownerB, 'Numbering Beta');
    const customerB = await createCustomerViaApi(ctx, ownerB, { name: 'Beta Customer' });
    const numbersB = await warmUpThenRace(ownerB, customerB.id, 5);

    // B's sequence is its own — restarts at 1 regardless of A's activity.
    expect(numbersB.map(numericPart).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });

  it('quotes, invoices and credit notes draw from SEPARATE sequences', async () => {
    // Quotes are never assigned a number by the API (no route allocates one).
    const quote: QuoteDto = await createQuoteViaApi(ctx, ownerA, customerA.id, LINE);
    expect(quote.number).toBeNull();

    // First invoice → INV-0001.
    const draft = await createInvoiceViaApi(ctx, ownerA, customerA.id, LINE);
    const invoice: InvoiceDto = await finalizeInvoiceViaApi(ctx, ownerA, draft.id);
    expect(invoice.number).toBe('INV-0001');

    // First credit note against it → CN-0001 (its own counter, not INV-0002).
    const cnResponse = await api(ctx.app, 'POST', `/v1/invoices/${invoice.id}/credit-notes`, {
      session: ownerA,
      body: {},
    });
    expect(cnResponse.statusCode).toBe(201);
    const creditNote = cnResponse.json<CreditNoteDto>();
    expect(creditNote.number).toBe('CN-0001');

    // A second invoice advances only the INVOICE sequence → INV-0002.
    const draft2 = await createInvoiceViaApi(ctx, ownerA, customerA.id, LINE);
    const invoice2 = await finalizeInvoiceViaApi(ctx, ownerA, draft2.id);
    expect(invoice2.number).toBe('INV-0002');

    // The DB holds distinct sequence rows per kind for this org.
    const org = await ctx.prisma.organization.findFirstOrThrow({
      where: { name: 'Numbering Alpha' },
    });
    const sequences = await ctx.prisma.numberSequence.findMany({
      where: { organizationId: org.id },
    });
    const byKind = Object.fromEntries(sequences.map((s) => [s.kind, s.next]));
    // INVOICE consumed 2 (next=3), CREDIT_NOTE consumed 1 (next=2), QUOTE untouched.
    expect(byKind.INVOICE).toBe(3);
    expect(byKind.CREDIT_NOTE).toBe(2);
    expect(byKind.QUOTE).toBeUndefined();
  });
});
