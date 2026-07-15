import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type {
  EmailAccountDto,
  EmailThreadDto,
  InboundResultDto,
  Paginated,
} from '@businessos/types';
import {
  addContactViaApi,
  api,
  createCustomerViaApi,
  createEmailAccountViaApi,
  createOrgViaApi,
  createTestContext,
  createUser,
  destroyTestContext,
  postInbound,
  truncateAll,
  uniqueAddress,
  uniqueRfcMessageId,
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

describe('email auto-link to customers (Phase 7)', () => {
  let owner: Actor;
  let orgId: string;
  let account: EmailAccountDto;

  beforeEach(async () => {
    await truncateAll(ctx.prisma);
    owner = await createUser(ctx.app, `p7-link-owner-${Date.now()}@test.local`);
    orgId = (await createOrgViaApi(ctx.app, owner, 'Autolink AB')).id;
    account = await createEmailAccountViaApi(ctx, owner);
  });

  it("an inbound from a customer's address links the thread and records email.received", async () => {
    const email = uniqueAddress('customer');
    const customer = await createCustomerViaApi(ctx, owner, { email });

    const res = await postInbound(ctx.app, {
      to: account.address,
      from: email,
      subject: 'Order question',
      messageId: uniqueRfcMessageId(),
    });
    const threadId = res.json<InboundResultDto>().threadId!;

    const detail = await api(ctx.app, 'GET', `/v1/email/threads/${threadId}`, { session: owner });
    expect(detail.json<EmailThreadDto>().customerId).toBe(customer.id);

    // Timeline entry on the customer.
    const activity = await ctx.prisma.activity.findFirst({
      where: { organizationId: orgId, type: 'email.received', customerId: customer.id },
    });
    expect(activity).not.toBeNull();
    expect(activity?.metadata).toMatchObject({ from: email, subject: 'Order question' });

    // The customer filter finds the conversation.
    const filtered = await api(ctx.app, 'GET', `/v1/email/threads?customerId=${customer.id}`, {
      session: owner,
    });
    expect(filtered.json<Paginated<EmailThreadDto>>().items.map((t) => t.id)).toContain(threadId);
  });

  it('matching is case-insensitive on the sender address', async () => {
    const customer = await createCustomerViaApi(ctx, owner, {
      email: 'Sales.Team@BigCorp.example',
    });
    const res = await postInbound(ctx.app, {
      to: account.address,
      from: 'sales.team@bigcorp.example',
      messageId: uniqueRfcMessageId(),
    });
    const detail = await api(
      ctx.app,
      'GET',
      `/v1/email/threads/${res.json<InboundResultDto>().threadId}`,
      { session: owner },
    );
    expect(detail.json<EmailThreadDto>().customerId).toBe(customer.id);
  });

  it("an inbound from a contact's address links to the contact's customer", async () => {
    const customer = await createCustomerViaApi(ctx, owner); // no direct email
    const contactEmail = uniqueAddress('contact');
    await addContactViaApi(ctx, owner, customer.id, { email: contactEmail });

    const res = await postInbound(ctx.app, {
      to: account.address,
      from: contactEmail,
      messageId: uniqueRfcMessageId(),
    });
    const detail = await api(
      ctx.app,
      'GET',
      `/v1/email/threads/${res.json<InboundResultDto>().threadId}`,
      { session: owner },
    );
    expect(detail.json<EmailThreadDto>().customerId).toBe(customer.id);
  });

  it('an inbound from an unknown address leaves customerId null and records no activity', async () => {
    const res = await postInbound(ctx.app, {
      to: account.address,
      from: uniqueAddress('stranger'),
      messageId: uniqueRfcMessageId(),
    });
    const detail = await api(
      ctx.app,
      'GET',
      `/v1/email/threads/${res.json<InboundResultDto>().threadId}`,
      { session: owner },
    );
    expect(detail.json<EmailThreadDto>().customerId).toBeNull();
    expect(
      await ctx.prisma.activity.count({ where: { organizationId: orgId, type: 'email.received' } }),
    ).toBe(0);
  });

  it('a thread already linked to a customer keeps its link when someone else replies', async () => {
    const customerA = await createCustomerViaApi(ctx, owner, { email: uniqueAddress('cust-a') });
    const customerB = await createCustomerViaApi(ctx, owner, { email: uniqueAddress('cust-b') });

    const rootId = uniqueRfcMessageId('root');
    const first = await postInbound(ctx.app, {
      to: account.address,
      from: customerA.email!,
      messageId: rootId,
    });
    const threadId = first.json<InboundResultDto>().threadId!;

    // Customer B replies into the same conversation (e.g. was CC'd).
    await postInbound(ctx.app, {
      to: account.address,
      from: customerB.email!,
      messageId: uniqueRfcMessageId(),
      inReplyTo: rootId,
    });

    const detail = await api(ctx.app, 'GET', `/v1/email/threads/${threadId}`, { session: owner });
    expect(detail.json<EmailThreadDto>().customerId).toBe(customerA.id);
  });
});
