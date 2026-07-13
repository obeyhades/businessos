import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CalendarDto, EventDto, OccurrenceDto } from '@businessos/types';
import {
  api,
  createCalendarViaApi,
  createEventViaApi,
  createOrgViaApi,
  createTestContext,
  createUser,
  destroyTestContext,
  isoAt,
  MONDAY,
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

const RANGE = `from=${encodeURIComponent(isoAt(MONDAY, 0))}&to=${encodeURIComponent(isoAt('2026-01-26', 0))}`;

// Every Phase 6 calendar resource of org A must be invisible and immutable to org B.
describe('tenant isolation (Phase 6 calendar)', () => {
  let userA: Actor;
  let userB: Actor;
  let calendarA: CalendarDto;
  let eventA: EventDto;

  beforeEach(async () => {
    await truncateAll(ctx.prisma);
    userA = await createUser(ctx.app, `p6-iso-a-${Date.now()}@test.local`);
    userB = await createUser(ctx.app, `p6-iso-b-${Date.now()}@test.local`);
    await createOrgViaApi(ctx.app, userA, 'Alpha Calendar');
    await createOrgViaApi(ctx.app, userB, 'Beta Calendar');

    calendarA = await createCalendarViaApi(ctx, userA, { name: 'A Team' });
    eventA = await createEventViaApi(ctx, userA, {
      calendarId: calendarA.id,
      title: 'A private planning',
      startsAt: isoAt(MONDAY, 9),
      endsAt: isoAt(MONDAY, 10),
    });

    // Org B gets its own data so lists are not trivially empty.
    const calendarB = await createCalendarViaApi(ctx, userB, { name: 'B Team' });
    await createEventViaApi(ctx, userB, {
      calendarId: calendarB.id,
      title: 'B sync',
      startsAt: isoAt(MONDAY, 9),
      endsAt: isoAt(MONDAY, 10),
    });
  });

  it("B's calendar list excludes A's calendar; PATCH/DELETE A calendar is 404", async () => {
    const list = await api(ctx.app, 'GET', '/v1/calendars', { session: userB });
    expect(list.json<CalendarDto[]>().map((c) => c.id)).not.toContain(calendarA.id);

    expect(
      (
        await api(ctx.app, 'PATCH', `/v1/calendars/${calendarA.id}`, {
          session: userB,
          body: { name: 'Hijacked' },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await api(ctx.app, 'DELETE', `/v1/calendars/${calendarA.id}`, { session: userB }))
        .statusCode,
    ).toBe(404);

    // A's calendar is untouched.
    const row = await ctx.prisma.calendar.findUniqueOrThrow({ where: { id: calendarA.id } });
    expect(row.name).toBe('A Team');
  });

  it("B's events range excludes A's event; GET/PATCH/DELETE/cancel A event is 404", async () => {
    const range = await api(ctx.app, 'GET', `/v1/events?${RANGE}`, { session: userB });
    expect(range.json<OccurrenceDto[]>().map((o) => o.eventId)).not.toContain(eventA.id);

    expect(
      (await api(ctx.app, 'GET', `/v1/events/${eventA.id}`, { session: userB })).statusCode,
    ).toBe(404);
    expect(
      (
        await api(ctx.app, 'PATCH', `/v1/events/${eventA.id}`, {
          session: userB,
          body: { title: 'Hijacked' },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await api(ctx.app, 'DELETE', `/v1/events/${eventA.id}`, { session: userB })).statusCode,
    ).toBe(404);
    expect(
      (await api(ctx.app, 'POST', `/v1/events/${eventA.id}/cancel`, { session: userB })).statusCode,
    ).toBe(404);

    // A's event is still there and unchanged.
    const row = await ctx.prisma.calendarEvent.findUniqueOrThrow({ where: { id: eventA.id } });
    expect(row.title).toBe('A private planning');
    expect(row.status).toBe('CONFIRMED');
  });

  it("B cannot add an attendee to A's event (404)", async () => {
    const res = await api(ctx.app, 'POST', `/v1/events/${eventA.id}/attendees`, {
      session: userB,
      body: { userId: userB.userId },
    });
    expect(res.statusCode).toBe(404);
  });

  it("B's agenda never includes A's event", async () => {
    const res = await api(ctx.app, 'GET', `/v1/agenda?${RANGE}`, { session: userB });
    expect(res.statusCode).toBe(200);
    expect(res.json<Array<{ id: string }>>().map((i) => i.id)).not.toContain(eventA.id);
  });

  it("B cannot query free/busy for A's user (404 — not a member of B's org)", async () => {
    const res = await api(
      ctx.app,
      'GET',
      `/v1/calendar/free-busy?userId=${userA.userId}&from=${encodeURIComponent(isoAt(MONDAY, 0))}&to=${encodeURIComponent(isoAt('2026-01-26', 0))}`,
      { session: userB },
    );
    expect(res.statusCode).toBe(404);
  });
});
