import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CalendarDto, OccurrenceDto } from '@businessos/types';
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
  WEEKDAY,
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

async function range(session: Actor, from: string, to: string): Promise<OccurrenceDto[]> {
  const res = await api(
    ctx.app,
    'GET',
    `/v1/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    { session },
  );
  expect(res.statusCode).toBe(200);
  return res.json<OccurrenceDto[]>();
}

describe('recurrence range expansion (Phase 6)', () => {
  let owner: Actor;
  let calendar: CalendarDto;

  beforeEach(async () => {
    await truncateAll(ctx.prisma);
    owner = await createUser(ctx.app, `p6-rec-owner-${Date.now()}@test.local`);
    await createOrgViaApi(ctx.app, owner, 'Recurring Co');
    calendar = await createCalendarViaApi(ctx, owner, { name: 'Team' });
  });

  it('expands a weekly Mon/Wed event into the right occurrences across three weeks', async () => {
    const event = await createEventViaApi(ctx, owner, {
      calendarId: calendar.id,
      title: 'Standup',
      startsAt: isoAt(MONDAY, 9), // 2026-01-05T09:00Z (Monday)
      endsAt: isoAt(MONDAY, 9, 30),
      recurrence: { freq: 'WEEKLY', interval: 1, byWeekday: [WEEKDAY.MON, WEEKDAY.WED] },
    });

    // Window Jan 5..Jan 25: three Mon/Wed pairs (Jan 26 Monday falls outside).
    const occ = (await range(owner, isoAt(MONDAY, 0), isoAt('2026-01-25', 0))).filter(
      (o) => o.eventId === event.id,
    );

    expect(occ.map((o) => o.start)).toEqual([
      '2026-01-05T09:00:00.000Z',
      '2026-01-07T09:00:00.000Z',
      '2026-01-12T09:00:00.000Z',
      '2026-01-14T09:00:00.000Z',
      '2026-01-19T09:00:00.000Z',
      '2026-01-21T09:00:00.000Z',
    ]);

    // Every occurrence is a Monday or Wednesday at 09:00Z, flagged recurring, and
    // the payload comes back chronologically sorted.
    for (const o of occ) {
      const day = new Date(o.start).getUTCDay();
      expect([WEEKDAY.MON, WEEKDAY.WED]).toContain(day);
      expect(new Date(o.start).getUTCHours()).toBe(9);
      expect(o.isRecurring).toBe(true);
      expect(o.isException).toBe(false);
      // occurrenceStart equals start for un-modified occurrences.
      expect(o.occurrenceStart).toBe(o.start);
    }
    for (let i = 1; i < occ.length; i += 1) {
      expect(occ[i]!.start >= occ[i - 1]!.start).toBe(true);
    }
  });

  it('returns a single (non-recurring) event exactly once', async () => {
    const single = await createEventViaApi(ctx, owner, {
      calendarId: calendar.id,
      title: 'One-off',
      startsAt: isoAt('2026-01-14', 13),
      endsAt: isoAt('2026-01-14', 14),
    });

    const occ = (await range(owner, isoAt(MONDAY, 0), isoAt('2026-01-25', 0))).filter(
      (o) => o.eventId === single.id,
    );
    expect(occ).toHaveLength(1);
    expect(occ[0]!.isRecurring).toBe(false);
    expect(occ[0]!.start).toBe('2026-01-14T13:00:00.000Z');
  });

  it('honours the count bound: a daily count=3 series yields three occurrences', async () => {
    const event = await createEventViaApi(ctx, owner, {
      calendarId: calendar.id,
      title: 'Daily brief',
      startsAt: isoAt(MONDAY, 8),
      endsAt: isoAt(MONDAY, 8, 15),
      recurrence: { freq: 'DAILY', interval: 1, count: 3 },
    });
    const occ = (await range(owner, isoAt(MONDAY, 0), isoAt('2026-02-01', 0))).filter(
      (o) => o.eventId === event.id,
    );
    expect(occ.map((o) => o.start)).toEqual([
      '2026-01-05T08:00:00.000Z',
      '2026-01-06T08:00:00.000Z',
      '2026-01-07T08:00:00.000Z',
    ]);
  });
});
