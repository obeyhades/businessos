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
  errorCode,
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

async function range(session: Actor, eventId: string): Promise<OccurrenceDto[]> {
  const from = isoAt(MONDAY, 0);
  const to = isoAt('2026-01-25', 0);
  const res = await api(
    ctx.app,
    'GET',
    `/v1/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    { session },
  );
  expect(res.statusCode).toBe(200);
  return res.json<OccurrenceDto[]>().filter((o) => o.eventId === eventId);
}

describe('occurrence exceptions (Phase 6)', () => {
  let owner: Actor;
  let calendar: CalendarDto;
  let weekly: EventDto;

  // Weekly Monday standup: rule starts Jan 5, 12, 19 within the test window.
  const OCC_JAN5 = '2026-01-05T09:00:00.000Z';
  const OCC_JAN12 = '2026-01-12T09:00:00.000Z';
  const OCC_JAN19 = '2026-01-19T09:00:00.000Z';

  beforeEach(async () => {
    await truncateAll(ctx.prisma);
    owner = await createUser(ctx.app, `p6-occ-owner-${Date.now()}@test.local`);
    await createOrgViaApi(ctx.app, owner, 'Occurrence Co');
    calendar = await createCalendarViaApi(ctx, owner, { name: 'Team' });
    weekly = await createEventViaApi(ctx, owner, {
      calendarId: calendar.id,
      title: 'Weekly standup',
      startsAt: isoAt(MONDAY, 9),
      endsAt: isoAt(MONDAY, 9, 30),
      recurrence: { freq: 'WEEKLY', interval: 1, byWeekday: [WEEKDAY.MON] },
    });
  });

  it('baseline: three Monday occurrences before any exception', async () => {
    const occ = await range(owner, weekly.id);
    expect(occ.map((o) => o.start)).toEqual([OCC_JAN5, OCC_JAN12, OCC_JAN19]);
  });

  it('cancelling one occurrence removes it from the range', async () => {
    const res = await api(ctx.app, 'POST', `/v1/events/${weekly.id}/occurrences/cancel`, {
      session: owner,
      body: { occurrenceStart: OCC_JAN12 },
    });
    expect(res.statusCode).toBe(204);

    const occ = await range(owner, weekly.id);
    expect(occ.map((o) => o.start)).toEqual([OCC_JAN5, OCC_JAN19]);
    expect(occ.map((o) => o.occurrenceStart)).not.toContain(OCC_JAN12);
  });

  it('overriding one occurrence retitles it and moves its time, keeping occurrenceStart', async () => {
    const res = await api(ctx.app, 'POST', `/v1/events/${weekly.id}/occurrences/override`, {
      session: owner,
      body: {
        occurrenceStart: OCC_JAN19,
        title: 'Moved standup',
        startsAt: '2026-01-19T14:00:00.000Z',
        endsAt: '2026-01-19T15:00:00.000Z',
      },
    });
    expect(res.statusCode).toBe(204);

    const occ = await range(owner, weekly.id);
    const moved = occ.find((o) => o.occurrenceStart === OCC_JAN19);
    expect(moved).toBeDefined();
    expect(moved!.title).toBe('Moved standup');
    expect(moved!.start).toBe('2026-01-19T14:00:00.000Z');
    expect(moved!.end).toBe('2026-01-19T15:00:00.000Z');
    expect(moved!.isException).toBe(true);
    // The untouched occurrences keep their original title.
    const jan5 = occ.find((o) => o.occurrenceStart === OCC_JAN5);
    expect(jan5!.title).toBe('Weekly standup');
    expect(jan5!.isException).toBe(false);
  });

  it('rejects occurrence operations on a non-recurring event (400 not_recurring)', async () => {
    const single = await createEventViaApi(ctx, owner, {
      calendarId: calendar.id,
      title: 'One-off',
      startsAt: isoAt(MONDAY, 9),
      endsAt: isoAt(MONDAY, 10),
    });

    const cancel = await api(ctx.app, 'POST', `/v1/events/${single.id}/occurrences/cancel`, {
      session: owner,
      body: { occurrenceStart: isoAt(MONDAY, 9) },
    });
    expect(cancel.statusCode).toBe(400);
    expect(errorCode(cancel.body)).toBe('not_recurring');

    const override = await api(ctx.app, 'POST', `/v1/events/${single.id}/occurrences/override`, {
      session: owner,
      body: { occurrenceStart: isoAt(MONDAY, 9), title: 'Nope' },
    });
    expect(override.statusCode).toBe(400);
    expect(errorCode(override.body)).toBe('not_recurring');
  });
});
