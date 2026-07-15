import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type {
  EmailAccountDto,
  EmailThreadDetailDto,
  EmailThreadDto,
  InboundResultDto,
  Paginated,
} from '@businessos/types';
import {
  api,
  composeDraftViaApi,
  createEmailAccountViaApi,
  createOrgViaApi,
  createTestContext,
  createUser,
  destroyTestContext,
  errorCode,
  postInbound,
  sendMessageViaApi,
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

describe('email inbound webhook (Phase 7)', () => {
  let owner: Actor;
  let account: EmailAccountDto;

  beforeEach(async () => {
    await truncateAll(ctx.prisma);
    owner = await createUser(ctx.app, `p7-inb-owner-${Date.now()}@test.local`);
    await createOrgViaApi(ctx.app, owner, 'Inbound AB');
    account = await createEmailAccountViaApi(ctx, owner);
  });

  it('creates an unread INBOUND message in a new INBOX thread (subject normalized on the thread)', async () => {
    const res = await postInbound(ctx.app, {
      to: account.address,
      from: 'anna@customer.example',
      fromName: 'Anna Andersson',
      subject: 'Re: Fwd: Quote request',
      text: 'Could you send the quote again?',
      messageId: uniqueRfcMessageId(),
    });
    expect(res.statusCode).toBe(200);
    const result = res.json<InboundResultDto>();
    expect(result.status).toBe('created');
    expect(result.threadId).toBeTruthy();
    expect(result.messageId).toBeTruthy();

    const detail = await api(ctx.app, 'GET', `/v1/email/threads/${result.threadId}`, {
      session: owner,
    });
    expect(detail.statusCode).toBe(200);
    const thread = detail.json<EmailThreadDetailDto>();
    // Reply/forward prefixes are stripped for the thread; the message keeps the raw subject.
    expect(thread.subject).toBe('Quote request');
    expect(thread.folder).toBe('INBOX');
    expect(thread.unread).toBe(true);
    expect(thread.messageCount).toBe(1);
    const message = thread.messages[0]!;
    expect(message.direction).toBe('INBOUND');
    expect(message.status).toBe('RECEIVED');
    expect(message.isRead).toBe(false);
    expect(message.fromAddress).toBe('anna@customer.example');
    expect(message.fromName).toBe('Anna Andersson');
    expect(message.subject).toBe('Re: Fwd: Quote request');

    const inbox = await api(ctx.app, 'GET', '/v1/email/threads?folder=INBOX', { session: owner });
    expect(inbox.json<Paginated<EmailThreadDto>>().items.map((t) => t.id)).toContain(
      result.threadId,
    );
  });

  it('rejects a wrong or missing secret with 401 and stores nothing', async () => {
    const wrong = await postInbound(
      ctx.app,
      { to: account.address, from: uniqueAddress('sender') },
      'not-the-secret',
    );
    expect(wrong.statusCode).toBe(401);
    expect(errorCode(wrong.body)).toBe('unauthorized');

    const missing = await postInbound(
      ctx.app,
      { to: account.address, from: uniqueAddress('sender') },
      null,
    );
    expect(missing.statusCode).toBe(401);

    expect(await ctx.prisma.emailThread.count()).toBe(0);
    expect(await ctx.prisma.emailMessage.count()).toBe(0);
  });

  it('an unknown mailbox yields unknown_account and stores nothing', async () => {
    const res = await postInbound(ctx.app, {
      to: 'nobody-here@unknown.test.local',
      from: uniqueAddress('sender'),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<InboundResultDto>()).toEqual({
      status: 'unknown_account',
      threadId: null,
      messageId: null,
    });
    expect(await ctx.prisma.emailThread.count()).toBe(0);
  });

  it('an inactive mailbox is treated as unknown', async () => {
    await api(ctx.app, 'PATCH', `/v1/email/accounts/${account.id}`, {
      session: owner,
      body: { isActive: false },
    });
    const res = await postInbound(ctx.app, {
      to: account.address,
      from: uniqueAddress('sender'),
    });
    expect(res.json<InboundResultDto>().status).toBe('unknown_account');
  });

  it('is idempotent by Message-ID: the second delivery is a duplicate, one message stored', async () => {
    const messageId = uniqueRfcMessageId('dup');
    const first = await postInbound(ctx.app, {
      to: account.address,
      from: 'anna@customer.example',
      subject: 'Once only',
      messageId,
    });
    expect(first.json<InboundResultDto>().status).toBe('created');
    const threadId = first.json<InboundResultDto>().threadId;

    const second = await postInbound(ctx.app, {
      to: account.address,
      from: 'anna@customer.example',
      subject: 'Once only',
      messageId,
    });
    expect(second.statusCode).toBe(200);
    const dup = second.json<InboundResultDto>();
    expect(dup.status).toBe('duplicate');
    expect(dup.threadId).toBe(threadId);
    expect(dup.messageId).toBe(first.json<InboundResultDto>().messageId);

    expect(await ctx.prisma.emailMessage.count({ where: { messageId } })).toBe(1);
    const thread = await ctx.prisma.emailThread.findUniqueOrThrow({ where: { id: threadId! } });
    expect(thread.messageCount).toBe(1);
  });

  it('threads by In-Reply-To onto the existing conversation', async () => {
    const rootId = uniqueRfcMessageId('root');
    const first = await postInbound(ctx.app, {
      to: account.address,
      from: 'anna@customer.example',
      subject: 'Project kickoff',
      messageId: rootId,
    });
    const threadId = first.json<InboundResultDto>().threadId;

    const reply = await postInbound(ctx.app, {
      to: account.address,
      from: 'anna@customer.example',
      subject: 'Re: Project kickoff',
      messageId: uniqueRfcMessageId('reply'),
      inReplyTo: rootId,
    });
    expect(reply.json<InboundResultDto>().status).toBe('created');
    expect(reply.json<InboundResultDto>().threadId).toBe(threadId);

    const detail = await api(ctx.app, 'GET', `/v1/email/threads/${threadId}`, { session: owner });
    expect(detail.json<EmailThreadDetailDto>().messageCount).toBe(2);
  });

  it('threads by References when In-Reply-To is absent', async () => {
    const rootId = uniqueRfcMessageId('root');
    const first = await postInbound(ctx.app, {
      to: account.address,
      from: 'anna@customer.example',
      messageId: rootId,
    });
    const threadId = first.json<InboundResultDto>().threadId;

    const reply = await postInbound(ctx.app, {
      to: account.address,
      from: 'bertil@customer.example',
      messageId: uniqueRfcMessageId('ref'),
      references: [uniqueRfcMessageId('unrelated'), rootId],
    });
    expect(reply.json<InboundResultDto>().threadId).toBe(threadId);
  });

  it('an inbound reply to a sent message joins the composed thread (full loop)', async () => {
    const draft = await composeDraftViaApi(ctx, owner, {
      accountId: account.id,
      to: ['anna@customer.example'],
      subject: 'Offer',
    });
    const detail = await sendMessageViaApi(ctx, owner, draft.id);
    const rfcId = detail.messages[0]!.messageId!;

    const reply = await postInbound(ctx.app, {
      to: account.address,
      from: 'anna@customer.example',
      subject: 'Re: Offer',
      messageId: uniqueRfcMessageId('customer-reply'),
      inReplyTo: rfcId,
    });
    expect(reply.json<InboundResultDto>().status).toBe('created');
    expect(reply.json<InboundResultDto>().threadId).toBe(draft.threadId);

    // The reply makes the conversation unread again.
    const after = await api(ctx.app, 'GET', `/v1/email/threads/${draft.threadId}`, {
      session: owner,
    });
    expect(after.json<EmailThreadDetailDto>().unread).toBe(true);
    expect(after.json<EmailThreadDetailDto>().messageCount).toBe(2);
  });

  it('an unrelated inbound with an identical subject starts a NEW thread (no subject-merge)', async () => {
    const first = await postInbound(ctx.app, {
      to: account.address,
      from: 'anna@customer.example',
      subject: 'Invoice',
      messageId: uniqueRfcMessageId(),
    });
    const second = await postInbound(ctx.app, {
      to: account.address,
      from: 'bertil@other.example',
      subject: 'Invoice',
      messageId: uniqueRfcMessageId(),
    });
    expect(second.json<InboundResultDto>().status).toBe('created');
    expect(second.json<InboundResultDto>().threadId).not.toBe(
      first.json<InboundResultDto>().threadId,
    );
    expect(await ctx.prisma.emailThread.count()).toBe(2);
  });
});
