import { randomUUID } from 'node:crypto';
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
  createCustomerViaApi,
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

async function listThreads(session: Actor, query = ''): Promise<EmailThreadDto[]> {
  const res = await api(ctx.app, 'GET', `/v1/email/threads${query ? `?${query}` : ''}`, {
    session,
  });
  expect(res.statusCode).toBe(200);
  return res.json<Paginated<EmailThreadDto>>().items;
}

describe('email thread operations (Phase 7)', () => {
  let owner: Actor;
  let account: EmailAccountDto;
  let threadId: string;

  beforeEach(async () => {
    await truncateAll(ctx.prisma);
    owner = await createUser(ctx.app, `p7-ops-owner-${Date.now()}@test.local`);
    await createOrgViaApi(ctx.app, owner, 'Threadops AB');
    account = await createEmailAccountViaApi(ctx, owner);
    const inbound = await postInbound(ctx.app, {
      to: account.address,
      from: uniqueAddress('sender'),
      subject: 'Zebra quarterly report',
      text: 'The aardvark figures are attached.',
      messageId: uniqueRfcMessageId(),
    });
    threadId = inbound.json<InboundResultDto>().threadId!;
  });

  it('mark read / unread flips the thread and its inbound messages', async () => {
    // Fresh inbound conversations are unread.
    expect((await listThreads(owner, 'unread=true')).map((t) => t.id)).toContain(threadId);

    const read = await api(ctx.app, 'POST', `/v1/email/threads/${threadId}/read`, {
      session: owner,
      body: { read: true },
    });
    expect(read.statusCode).toBe(200);
    const readDetail = read.json<EmailThreadDetailDto>();
    expect(readDetail.unread).toBe(false);
    expect(readDetail.messages.every((m) => m.isRead)).toBe(true);
    expect((await listThreads(owner, 'unread=true')).map((t) => t.id)).not.toContain(threadId);

    const unread = await api(ctx.app, 'POST', `/v1/email/threads/${threadId}/read`, {
      session: owner,
      body: { read: false },
    });
    expect(unread.json<EmailThreadDetailDto>().unread).toBe(true);
  });

  it('star and unstar, with the starred filter', async () => {
    const star = await api(ctx.app, 'POST', `/v1/email/threads/${threadId}/star`, {
      session: owner,
      body: { starred: true },
    });
    expect(star.statusCode).toBe(200);
    expect(star.json<EmailThreadDto>().isStarred).toBe(true);
    expect((await listThreads(owner, 'starred=true')).map((t) => t.id)).toContain(threadId);

    const unstar = await api(ctx.app, 'POST', `/v1/email/threads/${threadId}/star`, {
      session: owner,
      body: { starred: false },
    });
    expect(unstar.json<EmailThreadDto>().isStarred).toBe(false);
    expect((await listThreads(owner, 'starred=true')).map((t) => t.id)).not.toContain(threadId);
  });

  it('move to ARCHIVE leaves INBOX; TRASH and back to INBOX work; SENT is not a physical folder', async () => {
    const archive = await api(ctx.app, 'POST', `/v1/email/threads/${threadId}/move`, {
      session: owner,
      body: { folder: 'ARCHIVE' },
    });
    expect(archive.statusCode).toBe(200);
    expect(archive.json<EmailThreadDto>().folder).toBe('ARCHIVE');
    expect((await listThreads(owner, 'folder=INBOX')).map((t) => t.id)).not.toContain(threadId);
    expect((await listThreads(owner, 'folder=ARCHIVE')).map((t) => t.id)).toContain(threadId);

    const trash = await api(ctx.app, 'POST', `/v1/email/threads/${threadId}/move`, {
      session: owner,
      body: { folder: 'TRASH' },
    });
    expect(trash.json<EmailThreadDto>().folder).toBe('TRASH');
    expect((await listThreads(owner, 'folder=TRASH')).map((t) => t.id)).toContain(threadId);

    const back = await api(ctx.app, 'POST', `/v1/email/threads/${threadId}/move`, {
      session: owner,
      body: { folder: 'INBOX' },
    });
    expect(back.json<EmailThreadDto>().folder).toBe('INBOX');

    // SENT/DRAFTS are computed views, not move targets.
    const invalid = await api(ctx.app, 'POST', `/v1/email/threads/${threadId}/move`, {
      session: owner,
      body: { folder: 'SENT' },
    });
    expect(invalid.statusCode).toBe(400);
  });

  it('labels: add (idempotently), filter by labelId, remove', async () => {
    const label = await createEmailLabelViaApi(ctx, owner, { name: 'Urgent' });
    // A second, unlabeled thread proves the filter narrows.
    const other = await postInbound(ctx.app, {
      to: account.address,
      from: uniqueAddress('sender'),
      subject: 'Unlabeled',
      messageId: uniqueRfcMessageId(),
    });
    const otherThreadId = other.json<InboundResultDto>().threadId!;

    const add = await api(ctx.app, 'POST', `/v1/email/threads/${threadId}/labels`, {
      session: owner,
      body: { labelId: label.id },
    });
    expect(add.statusCode).toBe(200);
    expect(add.json<EmailThreadDto>().labels.map((l) => l.id)).toEqual([label.id]);

    // Adding the same label twice is idempotent.
    const again = await api(ctx.app, 'POST', `/v1/email/threads/${threadId}/labels`, {
      session: owner,
      body: { labelId: label.id },
    });
    expect(again.statusCode).toBe(200);
    expect(again.json<EmailThreadDto>().labels).toHaveLength(1);

    const filtered = await listThreads(owner, `labelId=${label.id}`);
    expect(filtered.map((t) => t.id)).toContain(threadId);
    expect(filtered.map((t) => t.id)).not.toContain(otherThreadId);

    const remove = await api(
      ctx.app,
      'DELETE',
      `/v1/email/threads/${threadId}/labels/${label.id}`,
      { session: owner },
    );
    expect(remove.statusCode).toBe(200);
    expect(remove.json<EmailThreadDto>().labels).toHaveLength(0);
    expect((await listThreads(owner, `labelId=${label.id}`)).map((t) => t.id)).not.toContain(
      threadId,
    );

    // A label id from nowhere is a 400.
    const unknown = await api(ctx.app, 'POST', `/v1/email/threads/${threadId}/labels`, {
      session: owner,
      body: { labelId: randomUUID() },
    });
    expect(unknown.statusCode).toBe(400);
    expect(errorCode(unknown.body)).toBe('unknown_label');
  });

  it('duplicate label names are rejected with 409', async () => {
    await createEmailLabelViaApi(ctx, owner, { name: 'Finance' });
    const dup = await api(ctx.app, 'POST', '/v1/email/labels', {
      session: owner,
      body: { name: 'Finance' },
    });
    expect(dup.statusCode).toBe(409);
    expect(errorCode(dup.body)).toBe('duplicate_label');
  });

  it('link to a customer, then unlink; unknown ids are 400', async () => {
    const customer = await createCustomerViaApi(ctx, owner);
    const link = await api(ctx.app, 'PATCH', `/v1/email/threads/${threadId}/link`, {
      session: owner,
      body: { customerId: customer.id },
    });
    expect(link.statusCode).toBe(200);
    expect(link.json<EmailThreadDto>().customerId).toBe(customer.id);
    expect((await listThreads(owner, `customerId=${customer.id}`)).map((t) => t.id)).toContain(
      threadId,
    );

    const unlink = await api(ctx.app, 'PATCH', `/v1/email/threads/${threadId}/link`, {
      session: owner,
      body: { customerId: null },
    });
    expect(unlink.json<EmailThreadDto>().customerId).toBeNull();

    const unknown = await api(ctx.app, 'PATCH', `/v1/email/threads/${threadId}/link`, {
      session: owner,
      body: { customerId: randomUUID() },
    });
    expect(unknown.statusCode).toBe(400);
    expect(errorCode(unknown.body)).toBe('unknown_customer');
  });

  it('search matches subject and body, case-insensitively', async () => {
    const other = await postInbound(ctx.app, {
      to: account.address,
      from: uniqueAddress('sender'),
      subject: 'Plain follow-up',
      text: 'Please pay the flamingo invoice today.',
      messageId: uniqueRfcMessageId(),
    });
    const otherThreadId = other.json<InboundResultDto>().threadId!;

    const bySubject = await listThreads(owner, 'search=zebra');
    expect(bySubject.map((t) => t.id)).toContain(threadId);
    expect(bySubject.map((t) => t.id)).not.toContain(otherThreadId);

    const byBody = await listThreads(owner, 'search=FLAMINGO');
    expect(byBody.map((t) => t.id)).toContain(otherThreadId);
    expect(byBody.map((t) => t.id)).not.toContain(threadId);

    expect(await listThreads(owner, 'search=nomatchxyz')).toHaveLength(0);
  });
});
