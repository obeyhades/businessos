import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { EmailAccountDto, EmailThreadDto, Paginated } from '@businessos/types';
import {
  addMemberViaInvitation,
  api,
  createEmailAccountViaApi,
  createOrgViaApi,
  createTestContext,
  createUser,
  destroyTestContext,
  errorCode,
  postInbound,
  truncateAll,
  uniqueAddress,
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

describe('email accounts (Phase 7)', () => {
  let owner: Actor;
  let admin: Actor;

  beforeEach(async () => {
    await truncateAll(ctx.prisma);
    owner = await createUser(ctx.app, `p7-acc-owner-${Date.now()}@test.local`);
    await createOrgViaApi(ctx.app, owner, 'Mailrooms AB');
    admin = await addMemberViaInvitation(ctx, owner, 'p7-acc-admin@example.com', 'ADMIN');
  });

  it('creates a SHARED mailbox with a normalized address and lists it', async () => {
    const created = await api(ctx.app, 'POST', '/v1/email/accounts', {
      session: owner,
      body: { address: 'Info@Shared.Test.Local', displayName: 'Info' },
    });
    expect(created.statusCode).toBe(201);
    const account = created.json<EmailAccountDto>();
    expect(account.address).toBe('info@shared.test.local');
    expect(account.type).toBe('SHARED');
    expect(account.ownerId).toBeNull();
    expect(account.displayName).toBe('Info');
    expect(account.isActive).toBe(true);

    const list = await api(ctx.app, 'GET', '/v1/email/accounts', { session: owner });
    expect(list.statusCode).toBe(200);
    expect(list.json<EmailAccountDto[]>().map((a) => a.id)).toContain(account.id);
  });

  it('creates a PERSONAL mailbox owned by its creator', async () => {
    const account = await createEmailAccountViaApi(ctx, owner, { type: 'PERSONAL' });
    expect(account.type).toBe('PERSONAL');
    expect(account.ownerId).toBe(owner.userId);
  });

  it('updates displayName/isActive and deletes an unused mailbox', async () => {
    const account = await createEmailAccountViaApi(ctx, owner);

    const patched = await api(ctx.app, 'PATCH', `/v1/email/accounts/${account.id}`, {
      session: owner,
      body: { displayName: 'Renamed', isActive: false },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json<EmailAccountDto>().displayName).toBe('Renamed');
    expect(patched.json<EmailAccountDto>().isActive).toBe(false);

    const del = await api(ctx.app, 'DELETE', `/v1/email/accounts/${account.id}`, {
      session: owner,
    });
    expect(del.statusCode).toBe(204);

    const list = await api(ctx.app, 'GET', '/v1/email/accounts', { session: owner });
    expect(list.json<EmailAccountDto[]>().map((a) => a.id)).not.toContain(account.id);
  });

  it('rejects a duplicate address in the same org with 409 duplicate_address (case-insensitive)', async () => {
    await createEmailAccountViaApi(ctx, owner, { address: 'support@dup.test.local' });
    const dup = await api(ctx.app, 'POST', '/v1/email/accounts', {
      session: owner,
      // Different case — the schema lower-cases, so it hits the same unique key.
      body: { address: 'SUPPORT@dup.test.local' },
    });
    expect(dup.statusCode).toBe(409);
    expect(errorCode(dup.body)).toBe('duplicate_address');
  });

  it('refuses to delete a mailbox that has threads (409 account_in_use)', async () => {
    const account = await createEmailAccountViaApi(ctx, owner);
    const inbound = await postInbound(ctx.app, {
      to: account.address,
      from: uniqueAddress('sender'),
      messageId: undefined,
    });
    expect(inbound.statusCode).toBe(200);
    expect(inbound.json<{ status: string }>().status).toBe('created');

    const del = await api(ctx.app, 'DELETE', `/v1/email/accounts/${account.id}`, {
      session: owner,
    });
    expect(del.statusCode).toBe(409);
    expect(errorCode(del.body)).toBe('account_in_use');

    // The mailbox is untouched.
    expect(await ctx.prisma.emailAccount.findUnique({ where: { id: account.id } })).not.toBeNull();
  });

  it('a PERSONAL mailbox and its threads are invisible to other members (list + 404 on ops)', async () => {
    const personal = await createEmailAccountViaApi(ctx, owner, { type: 'PERSONAL' });
    const inbound = await postInbound(ctx.app, {
      to: personal.address,
      from: uniqueAddress('sender'),
      subject: 'Private matter',
    });
    const threadId = inbound.json<{ threadId: string }>().threadId;

    // Owner sees the mailbox and the thread.
    const ownList = await api(ctx.app, 'GET', '/v1/email/accounts', { session: owner });
    expect(ownList.json<EmailAccountDto[]>().map((a) => a.id)).toContain(personal.id);
    const ownThreads = await api(ctx.app, 'GET', '/v1/email/threads', { session: owner });
    expect(ownThreads.json<Paginated<EmailThreadDto>>().items.map((t) => t.id)).toContain(threadId);

    // Another member (full email permissions) sees neither.
    const otherList = await api(ctx.app, 'GET', '/v1/email/accounts', { session: admin });
    expect(otherList.json<EmailAccountDto[]>().map((a) => a.id)).not.toContain(personal.id);
    const otherThreads = await api(ctx.app, 'GET', '/v1/email/threads', { session: admin });
    expect(otherThreads.json<Paginated<EmailThreadDto>>().items.map((t) => t.id)).not.toContain(
      threadId,
    );

    // Ops on the personal thread are 404 for the other member.
    expect(
      (await api(ctx.app, 'GET', `/v1/email/threads/${threadId}`, { session: admin })).statusCode,
    ).toBe(404);
    expect(
      (
        await api(ctx.app, 'POST', `/v1/email/threads/${threadId}/star`, {
          session: admin,
          body: { starred: true },
        })
      ).statusCode,
    ).toBe(404);

    // Composing from someone else's personal mailbox is 404 too.
    const compose = await api(ctx.app, 'POST', '/v1/email/messages', {
      session: admin,
      body: {
        accountId: personal.id,
        to: ['x@customer.example'],
        subject: 'Nope',
        bodyText: 'Nope',
      },
    });
    expect(compose.statusCode).toBe(404);
  });

  it('composing from an inactive mailbox is rejected (400 inactive_account)', async () => {
    const account = await createEmailAccountViaApi(ctx, owner);
    await api(ctx.app, 'PATCH', `/v1/email/accounts/${account.id}`, {
      session: owner,
      body: { isActive: false },
    });
    const compose = await api(ctx.app, 'POST', '/v1/email/messages', {
      session: owner,
      body: {
        accountId: account.id,
        to: ['x@customer.example'],
        subject: 'Nope',
        bodyText: 'Nope',
      },
    });
    expect(compose.statusCode).toBe(400);
    expect(errorCode(compose.body)).toBe('inactive_account');
  });
});
