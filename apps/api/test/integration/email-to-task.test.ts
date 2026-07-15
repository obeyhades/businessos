import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type {
  CustomerDto,
  EmailAccountDto,
  EmailThreadDto,
  InboundResultDto,
  TaskDto,
} from '@businessos/types';
import {
  addMemberViaInvitation,
  api,
  createCustomerViaApi,
  createEmailAccountViaApi,
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

describe('email to task (Phase 7)', () => {
  let owner: Actor;
  let orgId: string;
  let account: EmailAccountDto;
  let customer: CustomerDto;
  let threadId: string;

  beforeEach(async () => {
    await truncateAll(ctx.prisma);
    owner = await createUser(ctx.app, `p7-task-owner-${Date.now()}@test.local`);
    orgId = (await createOrgViaApi(ctx.app, owner, 'Taskify AB')).id;
    account = await createEmailAccountViaApi(ctx, owner);
    customer = await createCustomerViaApi(ctx, owner, { email: uniqueAddress('customer') });
    const inbound = await postInbound(ctx.app, {
      to: account.address,
      from: customer.email!,
      subject: 'Broken gearbox',
      text: 'The gearbox on machine 4 is rattling, please have a look.',
      messageId: uniqueRfcMessageId(),
    });
    threadId = inbound.json<InboundResultDto>().threadId!;
  });

  it("converting a thread creates a task linked to the thread's customer and back-links the thread", async () => {
    const res = await api(ctx.app, 'POST', `/v1/email/threads/${threadId}/task`, {
      session: owner,
      body: {},
    });
    expect(res.statusCode).toBe(201);
    const task = res.json<TaskDto>();
    // Title defaults to the (normalized) thread subject; description to the last message snippet.
    expect(task.title).toBe('Broken gearbox');
    expect(task.description).toContain('machine 4');
    expect(task.customer?.id).toBe(customer.id);
    expect(task.assignee).toBeNull();

    const thread = await api(ctx.app, 'GET', `/v1/email/threads/${threadId}`, { session: owner });
    expect(thread.json<EmailThreadDto>().taskId).toBe(task.id);

    // The task exists in this org and carries the customer link.
    const row = await ctx.prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(row.organizationId).toBe(orgId);
    expect(row.customerId).toBe(customer.id);
  });

  it('accepts an explicit title, assignee, and due date', async () => {
    const manager = await addMemberViaInvitation(ctx, owner, 'p7-task-mgr@example.com', 'MANAGER');
    const res = await api(ctx.app, 'POST', `/v1/email/threads/${threadId}/task`, {
      session: owner,
      body: {
        title: 'Inspect gearbox on machine 4',
        assigneeId: manager.userId,
        dueDate: '2026-08-01T09:00:00.000Z',
      },
    });
    expect(res.statusCode).toBe(201);
    const task = res.json<TaskDto>();
    expect(task.title).toBe('Inspect gearbox on machine 4');
    expect(task.assignee?.id).toBe(manager.userId);
    expect(task.dueDate).toBe('2026-08-01T09:00:00.000Z');
  });

  it('rejects an assignee who is not a member of the org (400 unknown_assignee)', async () => {
    const outsider = await createUser(ctx.app, `p7-task-outsider-${Date.now()}@test.local`);
    const res = await api(ctx.app, 'POST', `/v1/email/threads/${threadId}/task`, {
      session: owner,
      body: { assigneeId: outsider.userId },
    });
    expect(res.statusCode).toBe(400);
    expect(errorCode(res.body)).toBe('unknown_assignee');
    // Nothing was created and the thread is untouched.
    expect(await ctx.prisma.task.count({ where: { organizationId: orgId } })).toBe(0);
    const thread = await ctx.prisma.emailThread.findUniqueOrThrow({ where: { id: threadId } });
    expect(thread.taskId).toBeNull();
  });

  it('an unlinked thread converts to a task without a customer', async () => {
    const inbound = await postInbound(ctx.app, {
      to: account.address,
      from: uniqueAddress('stranger'),
      subject: 'Anonymous tip',
      messageId: uniqueRfcMessageId(),
    });
    const res = await api(
      ctx.app,
      'POST',
      `/v1/email/threads/${inbound.json<InboundResultDto>().threadId}/task`,
      { session: owner, body: {} },
    );
    expect(res.statusCode).toBe(201);
    expect(res.json<TaskDto>().customer).toBeNull();
  });
});
