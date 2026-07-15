import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type {
  EmailAccountDto,
  EmailMessageDto,
  EmailThreadDetailDto,
  EmailThreadDto,
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
  sendMessageViaApi,
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

async function threadIdsIn(session: Actor, folder: string): Promise<string[]> {
  const res = await api(ctx.app, 'GET', `/v1/email/threads?folder=${folder}`, { session });
  expect(res.statusCode).toBe(200);
  return res.json<Paginated<EmailThreadDto>>().items.map((t) => t.id);
}

describe('email compose / send (Phase 7)', () => {
  let owner: Actor;
  let account: EmailAccountDto;

  beforeEach(async () => {
    await truncateAll(ctx.prisma);
    owner = await createUser(ctx.app, `p7-send-owner-${Date.now()}@test.local`);
    await createOrgViaApi(ctx.app, owner, 'Compose AB');
    account = await createEmailAccountViaApi(ctx, owner);
  });

  it('composing without a threadId creates a DRAFT in a new thread (DRAFTS view, not INBOX)', async () => {
    const draft = await composeDraftViaApi(ctx, owner, {
      accountId: account.id,
      subject: 'Fresh compose',
      bodyText: 'Hello there',
    });
    expect(draft.direction).toBe('OUTBOUND');
    expect(draft.status).toBe('DRAFT');
    expect(draft.fromAddress).toBe(account.address);
    expect(draft.messageId).toBeNull();
    expect(draft.threadId).toBeTruthy();

    expect(await threadIdsIn(owner, 'DRAFTS')).toContain(draft.threadId);
    expect(await threadIdsIn(owner, 'INBOX')).not.toContain(draft.threadId);

    const detail = await api(ctx.app, 'GET', `/v1/email/threads/${draft.threadId}`, {
      session: owner,
    });
    expect(detail.statusCode).toBe(200);
    const thread = detail.json<EmailThreadDetailDto>();
    expect(thread.subject).toBe('Fresh compose');
    expect(thread.unread).toBe(false);
    expect(thread.messageCount).toBe(1);
    expect(thread.messages.map((m) => m.id)).toEqual([draft.id]);
  });

  it('editing a draft updates its content and the thread snippet', async () => {
    const draft = await composeDraftViaApi(ctx, owner, { accountId: account.id });
    const patched = await api(ctx.app, 'PATCH', `/v1/email/messages/${draft.id}`, {
      session: owner,
      body: {
        subject: 'Edited subject',
        bodyText: 'Edited body text',
        to: ['new-recipient@customer.example'],
      },
    });
    expect(patched.statusCode).toBe(200);
    const updated = patched.json<EmailMessageDto>();
    expect(updated.subject).toBe('Edited subject');
    expect(updated.bodyText).toBe('Edited body text');
    expect(updated.toAddresses).toEqual(['new-recipient@customer.example']);
    expect(updated.status).toBe('DRAFT');

    const detail = await api(ctx.app, 'GET', `/v1/email/threads/${draft.threadId}`, {
      session: owner,
    });
    expect(detail.json<EmailThreadDetailDto>().snippet).toBe('Edited body text');
  });

  it('sending a draft queues it (QUEUED, RFC Message-ID, sentAt) and enqueues the worker jobs', async () => {
    const draft = await composeDraftViaApi(ctx, owner, { accountId: account.id });
    const detail = await sendMessageViaApi(ctx, owner, draft.id);

    const sent = detail.messages.find((m) => m.id === draft.id);
    expect(sent).toBeDefined();
    // No worker runs in integration tests, so the message stays QUEUED (not SENT).
    expect(sent?.status).toBe('QUEUED');
    expect(sent?.messageId).toMatch(/^<.+@.+>$/);
    // sentAt is stamped by the worker on actual delivery, not at queue time.
    expect(sent?.sentAt).toBeNull();

    // Gone from DRAFTS.
    expect(await threadIdsIn(owner, 'DRAFTS')).not.toContain(draft.threadId);

    // Handed off to the shared email pipeline via the transactional outbox.
    const sendJob = await ctx.prisma.outboxMessage.findFirst({ where: { type: 'email.send' } });
    expect(sendJob).not.toBeNull();
    expect(sendJob?.payload).toMatchObject({ emailMessageId: draft.id });
    expect(await ctx.prisma.outboxMessage.count({ where: { type: 'email.sent' } })).toBeGreaterThan(
      0,
    );
  });

  it('a sent thread appears in the SENT view', async () => {
    const draft = await composeDraftViaApi(ctx, owner, { accountId: account.id });
    await sendMessageViaApi(ctx, owner, draft.id);
    // A just-sent conversation appears under SENT immediately: folderViewWhere
    // treats OUTBOUND QUEUED as sent-in-progress (the worker later flips it to
    // SENT). It is NOT in the INBOX view (inbound-only).
    expect(await threadIdsIn(owner, 'SENT')).toContain(draft.threadId);
    expect(await threadIdsIn(owner, 'INBOX')).not.toContain(draft.threadId);
  });

  it('once the worker marks the message SENT the thread is in the SENT view', async () => {
    const draft = await composeDraftViaApi(ctx, owner, { accountId: account.id });
    await sendMessageViaApi(ctx, owner, draft.id);
    // Simulate the worker's completion callback (integration tests run no worker).
    await ctx.prisma.emailMessage.update({ where: { id: draft.id }, data: { status: 'SENT' } });
    expect(await threadIdsIn(owner, 'SENT')).toContain(draft.threadId);
  });

  it('replying into an existing thread sets In-Reply-To/References from the latest message', async () => {
    const first = await composeDraftViaApi(ctx, owner, {
      accountId: account.id,
      subject: 'Original',
    });
    const detail = await sendMessageViaApi(ctx, owner, first.id);
    const sentRfcId = detail.messages[0]?.messageId;
    expect(sentRfcId).toBeTruthy();

    const reply = await composeDraftViaApi(ctx, owner, {
      accountId: account.id,
      threadId: first.threadId,
      subject: 'Re: Original',
      bodyText: 'Following up',
    });
    expect(reply.threadId).toBe(first.threadId);
    expect(reply.inReplyTo).toBe(sentRfcId);

    const after = await api(ctx.app, 'GET', `/v1/email/threads/${first.threadId}`, {
      session: owner,
    });
    const thread = after.json<EmailThreadDetailDto>();
    expect(thread.messageCount).toBe(2);
    expect(thread.messages.map((m) => m.id)).toEqual([first.id, reply.id]);
  });

  it('editing, re-sending, or deleting a non-draft is a 409', async () => {
    const draft = await composeDraftViaApi(ctx, owner, { accountId: account.id });
    await sendMessageViaApi(ctx, owner, draft.id);

    const patch = await api(ctx.app, 'PATCH', `/v1/email/messages/${draft.id}`, {
      session: owner,
      body: { subject: 'Too late' },
    });
    expect(patch.statusCode).toBe(409);
    expect(errorCode(patch.body)).toBe('not_a_draft');

    const resend = await api(ctx.app, 'POST', `/v1/email/messages/${draft.id}/send`, {
      session: owner,
    });
    expect(resend.statusCode).toBe(409);
    expect(errorCode(resend.body)).toBe('already_sent');

    const del = await api(ctx.app, 'DELETE', `/v1/email/messages/${draft.id}`, {
      session: owner,
    });
    expect(del.statusCode).toBe(409);
    expect(errorCode(del.body)).toBe('not_a_draft');
  });

  it('deleting a lone draft removes its now-empty thread', async () => {
    const draft = await composeDraftViaApi(ctx, owner, { accountId: account.id });
    const del = await api(ctx.app, 'DELETE', `/v1/email/messages/${draft.id}`, {
      session: owner,
    });
    expect(del.statusCode).toBe(204);

    expect(
      (await api(ctx.app, 'GET', `/v1/email/threads/${draft.threadId}`, { session: owner }))
        .statusCode,
    ).toBe(404);
    expect(await ctx.prisma.emailThread.findUnique({ where: { id: draft.threadId } })).toBeNull();
  });

  it('deleting a reply draft keeps the thread and recomputes its aggregates', async () => {
    const first = await composeDraftViaApi(ctx, owner, { accountId: account.id });
    await sendMessageViaApi(ctx, owner, first.id);
    const reply = await composeDraftViaApi(ctx, owner, {
      accountId: account.id,
      threadId: first.threadId,
    });

    const del = await api(ctx.app, 'DELETE', `/v1/email/messages/${reply.id}`, {
      session: owner,
    });
    expect(del.statusCode).toBe(204);

    const detail = await api(ctx.app, 'GET', `/v1/email/threads/${first.threadId}`, {
      session: owner,
    });
    expect(detail.statusCode).toBe(200);
    const thread = detail.json<EmailThreadDetailDto>();
    expect(thread.messageCount).toBe(1);
    expect(thread.messages.map((m) => m.id)).toEqual([first.id]);
  });

  it('replying to a thread that belongs to a different mailbox is a 400 unknown_thread', async () => {
    const other = await createEmailAccountViaApi(ctx, owner);
    const draft = await composeDraftViaApi(ctx, owner, { accountId: account.id });

    const res = await api(ctx.app, 'POST', '/v1/email/messages', {
      session: owner,
      body: {
        accountId: other.id,
        threadId: draft.threadId,
        to: ['x@customer.example'],
        subject: 'Cross-mailbox reply',
        bodyText: 'Nope',
      },
    });
    expect(res.statusCode).toBe(400);
    expect(errorCode(res.body)).toBe('unknown_thread');
  });
});
