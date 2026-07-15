import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { hasPermission } from '@businessos/types';
import type { EmailAccountDto, EmailLabelDto, EmailMessageDto } from '@businessos/types';
import {
  addMemberViaInvitation,
  api,
  composeDraftViaApi,
  createEmailAccountViaApi,
  createEmailLabelViaApi,
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

// Guards asserted against the matrix in packages/types/src/permissions.ts.
// (The inbound webhook is secret-authed, not RBAC — covered in email-inbound.test.ts.)
describe('RBAC (Phase 7 email)', () => {
  let owner: Actor;
  let manager: Actor;
  let employee: Actor;
  let readonly: Actor;
  let accountant: Actor;
  let account: EmailAccountDto;
  let label: EmailLabelDto;
  let draft: EmailMessageDto;
  let threadId: string;

  beforeEach(async () => {
    await truncateAll(ctx.prisma);
    owner = await createUser(ctx.app, `rbac7-owner-${Date.now()}@test.local`);
    await createOrgViaApi(ctx.app, owner, 'RBAC Email AB');
    manager = await addMemberViaInvitation(ctx, owner, 'rbac7-mgr@example.com', 'MANAGER');
    employee = await addMemberViaInvitation(ctx, owner, 'rbac7-emp@example.com', 'EMPLOYEE');
    readonly = await addMemberViaInvitation(ctx, owner, 'rbac7-ro@example.com', 'READONLY');
    accountant = await addMemberViaInvitation(ctx, owner, 'rbac7-acc@example.com', 'ACCOUNTANT');

    account = await createEmailAccountViaApi(ctx, owner);
    label = await createEmailLabelViaApi(ctx, owner);
    draft = await composeDraftViaApi(ctx, owner, { accountId: account.id });
    const inbound = await postInbound(ctx.app, {
      to: account.address,
      from: uniqueAddress('sender'),
      messageId: uniqueRfcMessageId(),
    });
    threadId = inbound.json<{ threadId: string }>().threadId;
  });

  it('matrix: email.read vs email.send per role', () => {
    for (const role of ['OWNER', 'ADMIN', 'MANAGER'] as const) {
      expect(hasPermission(role, 'email.read')).toBe(true);
      expect(hasPermission(role, 'email.send')).toBe(true);
    }
    expect(hasPermission('READONLY', 'email.read')).toBe(true);
    expect(hasPermission('READONLY', 'email.send')).toBe(false);
    for (const role of ['EMPLOYEE', 'ACCOUNTANT'] as const) {
      expect(hasPermission(role, 'email.read')).toBe(false);
      expect(hasPermission(role, 'email.send')).toBe(false);
    }
  });

  it('MANAGER can read and send (2xx across the surface)', async () => {
    expect((await api(ctx.app, 'GET', '/v1/email/accounts', { session: manager })).statusCode).toBe(
      200,
    );
    expect((await api(ctx.app, 'GET', '/v1/email/threads', { session: manager })).statusCode).toBe(
      200,
    );
    expect(
      (await api(ctx.app, 'GET', `/v1/email/threads/${threadId}`, { session: manager })).statusCode,
    ).toBe(200);

    const newAccount = await api(ctx.app, 'POST', '/v1/email/accounts', {
      session: manager,
      body: { address: uniqueAddress('mgr') },
    });
    expect(newAccount.statusCode).toBe(201);

    const compose = await api(ctx.app, 'POST', '/v1/email/messages', {
      session: manager,
      body: {
        accountId: account.id,
        to: ['x@customer.example'],
        subject: 'From the manager',
        bodyText: 'Hello',
      },
    });
    expect(compose.statusCode).toBe(201);
    const mgrDraft = compose.json<EmailMessageDto>();
    expect(
      (await api(ctx.app, 'POST', `/v1/email/messages/${mgrDraft.id}/send`, { session: manager }))
        .statusCode,
    ).toBe(200);

    expect(
      (
        await api(ctx.app, 'POST', `/v1/email/threads/${threadId}/star`, {
          session: manager,
          body: { starred: true },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await api(ctx.app, 'POST', `/v1/email/threads/${threadId}/move`, {
          session: manager,
          body: { folder: 'ARCHIVE' },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await api(ctx.app, 'POST', `/v1/email/threads/${threadId}/labels`, {
          session: manager,
          body: { labelId: label.id },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await api(ctx.app, 'POST', `/v1/email/threads/${threadId}/task`, {
          session: manager,
          body: {},
        })
      ).statusCode,
    ).toBe(201);
  });

  it('READONLY can GET but every mutation is 403', async () => {
    expect(
      (await api(ctx.app, 'GET', '/v1/email/accounts', { session: readonly })).statusCode,
    ).toBe(200);
    expect((await api(ctx.app, 'GET', '/v1/email/labels', { session: readonly })).statusCode).toBe(
      200,
    );
    expect((await api(ctx.app, 'GET', '/v1/email/threads', { session: readonly })).statusCode).toBe(
      200,
    );
    expect(
      (await api(ctx.app, 'GET', `/v1/email/threads/${threadId}`, { session: readonly }))
        .statusCode,
    ).toBe(200);

    const mutations: Array<Promise<{ statusCode: number }>> = [
      api(ctx.app, 'POST', '/v1/email/accounts', {
        session: readonly,
        body: { address: uniqueAddress('ro') },
      }),
      api(ctx.app, 'PATCH', `/v1/email/accounts/${account.id}`, {
        session: readonly,
        body: { displayName: 'Nope' },
      }),
      api(ctx.app, 'DELETE', `/v1/email/accounts/${account.id}`, { session: readonly }),
      api(ctx.app, 'POST', '/v1/email/labels', { session: readonly, body: { name: 'Nope' } }),
      api(ctx.app, 'DELETE', `/v1/email/labels/${label.id}`, { session: readonly }),
      api(ctx.app, 'POST', '/v1/email/messages', {
        session: readonly,
        body: { accountId: account.id, to: ['x@y.example'], subject: 'Nope', bodyText: 'Nope' },
      }),
      api(ctx.app, 'PATCH', `/v1/email/messages/${draft.id}`, {
        session: readonly,
        body: { subject: 'Nope' },
      }),
      api(ctx.app, 'DELETE', `/v1/email/messages/${draft.id}`, { session: readonly }),
      api(ctx.app, 'POST', `/v1/email/messages/${draft.id}/send`, { session: readonly }),
      api(ctx.app, 'POST', `/v1/email/threads/${threadId}/read`, {
        session: readonly,
        body: { read: true },
      }),
      api(ctx.app, 'POST', `/v1/email/threads/${threadId}/star`, {
        session: readonly,
        body: { starred: true },
      }),
      api(ctx.app, 'POST', `/v1/email/threads/${threadId}/move`, {
        session: readonly,
        body: { folder: 'ARCHIVE' },
      }),
      api(ctx.app, 'PATCH', `/v1/email/threads/${threadId}/link`, {
        session: readonly,
        body: { customerId: null },
      }),
      api(ctx.app, 'POST', `/v1/email/threads/${threadId}/labels`, {
        session: readonly,
        body: { labelId: label.id },
      }),
      api(ctx.app, 'DELETE', `/v1/email/threads/${threadId}/labels/${label.id}`, {
        session: readonly,
      }),
      api(ctx.app, 'POST', `/v1/email/threads/${threadId}/task`, {
        session: readonly,
        body: {},
      }),
    ];
    for (const response of await Promise.all(mutations)) {
      expect(response.statusCode).toBe(403);
    }
  });

  describe.each([
    ['EMPLOYEE', () => employee],
    ['ACCOUNTANT', () => accountant],
  ])('%s (no email access)', (_label, actorOf) => {
    it('is forbidden from every email endpoint (403)', async () => {
      const actor = actorOf();
      const requests: Array<Promise<{ statusCode: number }>> = [
        api(ctx.app, 'GET', '/v1/email/accounts', { session: actor }),
        api(ctx.app, 'GET', '/v1/email/labels', { session: actor }),
        api(ctx.app, 'GET', '/v1/email/threads', { session: actor }),
        api(ctx.app, 'GET', `/v1/email/threads/${threadId}`, { session: actor }),
        api(ctx.app, 'POST', '/v1/email/accounts', {
          session: actor,
          body: { address: uniqueAddress('nope') },
        }),
        api(ctx.app, 'POST', '/v1/email/messages', {
          session: actor,
          body: { accountId: account.id, to: ['x@y.example'], subject: 'Nope', bodyText: 'Nope' },
        }),
        api(ctx.app, 'POST', `/v1/email/threads/${threadId}/star`, {
          session: actor,
          body: { starred: true },
        }),
        api(ctx.app, 'POST', `/v1/email/threads/${threadId}/task`, { session: actor, body: {} }),
      ];
      for (const response of await Promise.all(requests)) {
        expect(response.statusCode).toBe(403);
      }
    });
  });
});
