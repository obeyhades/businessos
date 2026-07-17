import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CustomerDto, Paginated, RecordingDto } from '@businessos/types';
import {
  api,
  createCallLogViaApi,
  createCustomerViaApi,
  createOrgViaApi,
  createTestContext,
  createUser,
  createVoiceNoteViaApi,
  destroyTestContext,
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

// Every Phase 8 recording of org A must be invisible and immutable to org B.
describe('tenant isolation (Phase 8 recordings)', () => {
  let userA: Actor;
  let userB: Actor;
  let orgAId: string;
  let orgBId: string;
  let customerA: CustomerDto;
  let voiceA: RecordingDto;
  let callA: RecordingDto;

  beforeEach(async () => {
    await truncateAll(ctx.prisma);
    userA = await createUser(ctx.app, `p8-iso-a-${Date.now()}@test.local`);
    userB = await createUser(ctx.app, `p8-iso-b-${Date.now()}@test.local`);
    orgAId = (await createOrgViaApi(ctx.app, userA, 'Alpha Voice')).id;
    orgBId = (await createOrgViaApi(ctx.app, userB, 'Beta Voice')).id;

    customerA = await createCustomerViaApi(ctx, userA);
    voiceA = await createVoiceNoteViaApi(ctx.app, userA, {
      title: 'Alpha confidential note',
      customerId: customerA.id,
    });
    callA = await createCallLogViaApi(ctx, userA, { title: 'Alpha call log' });

    // Org B gets its own recording so its list is not trivially empty.
    await createVoiceNoteViaApi(ctx.app, userB, { title: 'Beta note' });
  });

  it("B's recording list excludes A's recordings", async () => {
    const res = await api(ctx.app, 'GET', '/v1/recordings', { session: userB });
    expect(res.statusCode).toBe(200);
    const ids = res.json<Paginated<RecordingDto>>().items.map((r) => r.id);
    expect(ids).not.toContain(voiceA.id);
    expect(ids).not.toContain(callA.id);
    // B only sees its own single recording.
    expect(res.json<Paginated<RecordingDto>>().totalItems).toBe(1);
  });

  it("B's search never returns A's recordings", async () => {
    const res = await api(ctx.app, 'GET', '/v1/recordings?search=Alpha', { session: userB });
    expect(res.statusCode).toBe(200);
    expect(res.json<Paginated<RecordingDto>>().items).toHaveLength(0);
  });

  it("B cannot read A's recording (404)", async () => {
    const res = await api(ctx.app, 'GET', `/v1/recordings/${voiceA.id}`, { session: userB });
    expect(res.statusCode).toBe(404);
  });

  it("B cannot mutate, download, or convert A's recording (404 everywhere) and A's recording is untouched", async () => {
    const ops = [
      api(ctx.app, 'PATCH', `/v1/recordings/${voiceA.id}`, {
        session: userB,
        body: { title: 'Hijacked' },
      }),
      api(ctx.app, 'DELETE', `/v1/recordings/${voiceA.id}`, { session: userB }),
      api(ctx.app, 'GET', `/v1/recordings/${voiceA.id}/audio`, { session: userB }),
      api(ctx.app, 'POST', `/v1/recordings/${voiceA.id}/retranscribe`, { session: userB }),
      api(ctx.app, 'POST', `/v1/recordings/${voiceA.id}/task`, { session: userB, body: {} }),
      api(ctx.app, 'POST', `/v1/recordings/${voiceA.id}/invoice`, {
        session: userB,
        body: { unitPriceMinor: 1000, quantity: 1, taxRatePercent: 25 },
      }),
    ];
    for (const response of await Promise.all(ops)) {
      expect(response.statusCode).toBe(404);
    }

    // Still present and unchanged in org A.
    const row = await ctx.prisma.recording.findUniqueOrThrow({ where: { id: voiceA.id } });
    expect(row.organizationId).toBe(orgAId);
    expect(row.title).toBe('Alpha confidential note');
    expect(row.taskId).toBeNull();
    expect(await ctx.prisma.task.count({ where: { organizationId: orgBId } })).toBe(0);
    expect(await ctx.prisma.invoice.count({ where: { organizationId: orgBId } })).toBe(0);
  });

  it("B cannot link A's recording to a customer (still 404, not a cross-org link)", async () => {
    const customerB = await createCustomerViaApi(ctx, userB);
    const res = await api(ctx.app, 'PATCH', `/v1/recordings/${voiceA.id}`, {
      session: userB,
      body: { customerId: customerB.id },
    });
    expect(res.statusCode).toBe(404);
    const row = await ctx.prisma.recording.findUniqueOrThrow({ where: { id: voiceA.id } });
    expect(row.customerId).toBe(customerA.id);
  });
});
