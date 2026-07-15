import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type {
  EmailAccountDto,
  EmailLabelDto,
  EmailMessageDto,
  EmailThreadDto,
  InboundResultDto,
  Paginated,
} from '@businessos/types';
import {
  api,
  composeDraftViaApi,
  createEmailAccountViaApi,
  createEmailLabelViaApi,
  createOrgViaApi,
  createTestContext,
  createUser,
  destroyTestContext,
  errorCode,
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

// Every Phase 7 email resource of org A must be invisible and immutable to org B.
describe('tenant isolation (Phase 7 email)', () => {
  let userA: Actor;
  let userB: Actor;
  let orgAId: string;
  let orgBId: string;
  let accountA: EmailAccountDto;
  let labelA: EmailLabelDto;
  let draftA: EmailMessageDto;
  let threadAId: string;
  let accountB: EmailAccountDto;

  beforeEach(async () => {
    await truncateAll(ctx.prisma);
    userA = await createUser(ctx.app, `p7-iso-a-${Date.now()}@test.local`);
    userB = await createUser(ctx.app, `p7-iso-b-${Date.now()}@test.local`);
    orgAId = (await createOrgViaApi(ctx.app, userA, 'Alpha Mail')).id;
    orgBId = (await createOrgViaApi(ctx.app, userB, 'Beta Mail')).id;

    accountA = await createEmailAccountViaApi(ctx, userA);
    labelA = await createEmailLabelViaApi(ctx, userA, { name: 'Alpha only' });
    const inboundA = await postInbound(ctx.app, {
      to: accountA.address,
      from: uniqueAddress('sender'),
      subject: 'A confidential thread',
      messageId: uniqueRfcMessageId(),
    });
    threadAId = inboundA.json<InboundResultDto>().threadId!;
    draftA = await composeDraftViaApi(ctx, userA, { accountId: accountA.id });

    // Org B gets its own data so lists are not trivially empty.
    accountB = await createEmailAccountViaApi(ctx, userB);
    await createEmailLabelViaApi(ctx, userB, { name: 'Beta only' });
    await postInbound(ctx.app, {
      to: accountB.address,
      from: uniqueAddress('sender'),
      subject: 'B thread',
      messageId: uniqueRfcMessageId(),
    });
  });

  it("B's account, label, and thread lists exclude A's resources", async () => {
    const accounts = await api(ctx.app, 'GET', '/v1/email/accounts', { session: userB });
    expect(accounts.json<EmailAccountDto[]>().map((a) => a.id)).not.toContain(accountA.id);

    const labels = await api(ctx.app, 'GET', '/v1/email/labels', { session: userB });
    expect(labels.json<EmailLabelDto[]>().map((l) => l.id)).not.toContain(labelA.id);
    expect(labels.json<EmailLabelDto[]>().map((l) => l.name)).not.toContain('Alpha only');

    const threads = await api(ctx.app, 'GET', '/v1/email/threads', { session: userB });
    const ids = threads.json<Paginated<EmailThreadDto>>().items.map((t) => t.id);
    expect(ids).not.toContain(threadAId);
    expect(ids).not.toContain(draftA.threadId);
  });

  it("B cannot read or operate on A's thread (404 everywhere) and A's thread is untouched", async () => {
    const labelB = await createEmailLabelViaApi(ctx, userB, { name: 'B label for hijack' });
    const ops = [
      api(ctx.app, 'GET', `/v1/email/threads/${threadAId}`, { session: userB }),
      api(ctx.app, 'POST', `/v1/email/threads/${threadAId}/read`, {
        session: userB,
        body: { read: true },
      }),
      api(ctx.app, 'POST', `/v1/email/threads/${threadAId}/star`, {
        session: userB,
        body: { starred: true },
      }),
      api(ctx.app, 'POST', `/v1/email/threads/${threadAId}/move`, {
        session: userB,
        body: { folder: 'TRASH' },
      }),
      api(ctx.app, 'PATCH', `/v1/email/threads/${threadAId}/link`, {
        session: userB,
        body: { customerId: null },
      }),
      api(ctx.app, 'POST', `/v1/email/threads/${threadAId}/labels`, {
        session: userB,
        body: { labelId: labelB.id },
      }),
      api(ctx.app, 'DELETE', `/v1/email/threads/${threadAId}/labels/${labelA.id}`, {
        session: userB,
      }),
      api(ctx.app, 'POST', `/v1/email/threads/${threadAId}/task`, { session: userB, body: {} }),
    ];
    for (const response of await Promise.all(ops)) {
      expect(response.statusCode).toBe(404);
    }

    const row = await ctx.prisma.emailThread.findUniqueOrThrow({ where: { id: threadAId } });
    expect(row.folder).toBe('INBOX');
    expect(row.isStarred).toBe(false);
    expect(row.unread).toBe(true);
    expect(row.taskId).toBeNull();
  });

  it("B cannot manage A's mailbox or label (404)", async () => {
    expect(
      (
        await api(ctx.app, 'PATCH', `/v1/email/accounts/${accountA.id}`, {
          session: userB,
          body: { isActive: false },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await api(ctx.app, 'DELETE', `/v1/email/accounts/${accountA.id}`, { session: userB }))
        .statusCode,
    ).toBe(404);
    expect(
      (await api(ctx.app, 'DELETE', `/v1/email/labels/${labelA.id}`, { session: userB }))
        .statusCode,
    ).toBe(404);

    // Still alive and unchanged in org A.
    const account = await ctx.prisma.emailAccount.findUniqueOrThrow({
      where: { id: accountA.id },
    });
    expect(account.isActive).toBe(true);
    expect(await ctx.prisma.emailLabel.findUnique({ where: { id: labelA.id } })).not.toBeNull();
  });

  it("B cannot compose from A's mailbox, reply into A's thread, or use A's label (400 unknown_*)", async () => {
    const compose = await api(ctx.app, 'POST', '/v1/email/messages', {
      session: userB,
      body: {
        accountId: accountA.id,
        to: ['x@customer.example'],
        subject: 'Hijack',
        bodyText: 'Nope',
      },
    });
    expect(compose.statusCode).toBe(400);
    expect(errorCode(compose.body)).toBe('unknown_account');

    const reply = await api(ctx.app, 'POST', '/v1/email/messages', {
      session: userB,
      body: {
        accountId: accountB.id,
        threadId: threadAId,
        to: ['x@customer.example'],
        subject: 'Hijack reply',
        bodyText: 'Nope',
      },
    });
    expect(reply.statusCode).toBe(400);
    expect(errorCode(reply.body)).toBe('unknown_thread');

    // A's label on B's own thread is unknown in org B.
    const threadsB = await api(ctx.app, 'GET', '/v1/email/threads', { session: userB });
    const threadBId = threadsB.json<Paginated<EmailThreadDto>>().items[0]!.id;
    const attach = await api(ctx.app, 'POST', `/v1/email/threads/${threadBId}/labels`, {
      session: userB,
      body: { labelId: labelA.id },
    });
    expect(attach.statusCode).toBe(400);
    expect(errorCode(attach.body)).toBe('unknown_label');
  });

  it("B cannot edit, delete, or send A's draft (404)", async () => {
    expect(
      (
        await api(ctx.app, 'PATCH', `/v1/email/messages/${draftA.id}`, {
          session: userB,
          body: { subject: 'Hijacked' },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await api(ctx.app, 'DELETE', `/v1/email/messages/${draftA.id}`, { session: userB }))
        .statusCode,
    ).toBe(404);
    expect(
      (await api(ctx.app, 'POST', `/v1/email/messages/${draftA.id}/send`, { session: userB }))
        .statusCode,
    ).toBe(404);

    const row = await ctx.prisma.emailMessage.findUniqueOrThrow({ where: { id: draftA.id } });
    expect(row.status).toBe('DRAFT');
    expect(row.subject).toBe(draftA.subject);
  });

  it('an active mailbox address is globally unique — org B cannot claim org A address', async () => {
    // Addresses are globally unique among active mailboxes so inbound routing
    // derives exactly one tenant and no org can hijack another org's mail.
    const shared = uniqueAddress('same-name');
    await createEmailAccountViaApi(ctx, userA, { address: shared });
    const inB = await api(ctx.app, 'POST', '/v1/email/accounts', {
      session: userB,
      body: { address: shared.toUpperCase() }, // case-insensitive collision too
    });
    expect(inB.statusCode).toBe(409);
  });

  it("an inbound to A's mailbox lands only in org A and stays invisible to B", async () => {
    const res = await postInbound(ctx.app, {
      to: accountA.address,
      from: uniqueAddress('sender'),
      subject: 'For A only',
      messageId: uniqueRfcMessageId(),
    });
    const newThreadId = res.json<InboundResultDto>().threadId!;

    const row = await ctx.prisma.emailThread.findUniqueOrThrow({ where: { id: newThreadId } });
    expect(row.organizationId).toBe(orgAId);

    expect(
      (await api(ctx.app, 'GET', `/v1/email/threads/${newThreadId}`, { session: userB }))
        .statusCode,
    ).toBe(404);
    const threadsB = await api(ctx.app, 'GET', '/v1/email/threads', { session: userB });
    expect(threadsB.json<Paginated<EmailThreadDto>>().items.map((t) => t.id)).not.toContain(
      newThreadId,
    );
    // Org B's thread count is unchanged.
    expect(await ctx.prisma.emailThread.count({ where: { organizationId: orgBId } })).toBe(1);
  });
});
