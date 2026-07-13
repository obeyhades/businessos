import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AgendaItemDto, CalendarDto, EventDto, FreeBusyDto } from '@businessos/types';
import {
  addMemberViaInvitation,
  api,
  createCalendarViaApi,
  createEventViaApi,
  createOrgViaApi,
  createTaskViaApi,
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

const FROM = isoAt(MONDAY, 0);
const TO = isoAt('2026-01-06', 0);

async function agenda(session: Actor): Promise<AgendaItemDto[]> {
  const res = await api(
    ctx.app,
    'GET',
    `/v1/agenda?from=${encodeURIComponent(FROM)}&to=${encodeURIComponent(TO)}`,
    { session },
  );
  expect(res.statusCode).toBe(200);
  return res.json<AgendaItemDto[]>();
}

async function freeBusy(session: Actor, userId: string): Promise<FreeBusyDto['busy']> {
  const res = await api(
    ctx.app,
    'GET',
    `/v1/calendar/free-busy?userId=${userId}&from=${encodeURIComponent(FROM)}&to=${encodeURIComponent(TO)}`,
    { session },
  );
  expect(res.statusCode).toBe(200);
  return res.json<FreeBusyDto>().busy;
}

describe('agenda & free/busy (Phase 6)', () => {
  let owner: Actor;
  let memberB: Actor;
  let calendar: CalendarDto;

  beforeEach(async () => {
    await truncateAll(ctx.prisma);
    owner = await createUser(ctx.app, `p6-ag-owner-${Date.now()}@test.local`);
    await createOrgViaApi(ctx.app, owner, 'Agenda Co');
    memberB = await addMemberViaInvitation(ctx, owner, 'p6-ag-b@example.com', 'EMPLOYEE');
    calendar = await createCalendarViaApi(ctx, owner, { name: 'Team' });
  });

  it("merges the user's events and their due, not-done, assigned tasks", async () => {
    const event = await createEventViaApi(ctx, owner, {
      calendarId: calendar.id,
      title: 'Client call',
      startsAt: isoAt(MONDAY, 9),
      endsAt: isoAt(MONDAY, 10),
    });
    const dueTask = await createTaskViaApi(ctx, owner, {
      title: 'Prepare deck',
      assigneeId: owner.userId,
      dueDate: isoAt(MONDAY, 15),
      status: 'TODO',
    });
    // Excluded: a DONE task in range, and an assigned task due outside the window.
    await createTaskViaApi(ctx, owner, {
      title: 'Already finished',
      assigneeId: owner.userId,
      dueDate: isoAt(MONDAY, 16),
      status: 'DONE',
    });
    await createTaskViaApi(ctx, owner, {
      title: 'Later',
      assigneeId: owner.userId,
      dueDate: isoAt('2026-02-01', 9),
      status: 'TODO',
    });

    const items = await agenda(owner);
    const events = items.filter((i) => i.kind === 'event');
    const tasks = items.filter((i) => i.kind === 'task');

    expect(events.map((e) => e.id)).toContain(event.id);
    expect(tasks.map((t) => t.id)).toEqual([dueTask.id]);
    // Sorted ascending by start across both kinds.
    for (let i = 1; i < items.length; i += 1) {
      expect(items[i]!.start >= items[i - 1]!.start).toBe(true);
    }
  });

  it('free/busy returns the busy blocks for a user', async () => {
    await createEventViaApi(ctx, owner, {
      calendarId: calendar.id,
      title: 'Busy block',
      startsAt: isoAt(MONDAY, 9),
      endsAt: isoAt(MONDAY, 10),
    });
    const busy = await freeBusy(owner, owner.userId);
    expect(busy).toContainEqual({
      start: '2026-01-05T09:00:00.000Z',
      end: '2026-01-05T10:00:00.000Z',
    });
  });

  it('free/busy excludes a cancelled event', async () => {
    const cancelled = await createEventViaApi(ctx, owner, {
      calendarId: calendar.id,
      title: 'Will cancel',
      startsAt: isoAt(MONDAY, 13),
      endsAt: isoAt(MONDAY, 14),
    });
    await api(ctx.app, 'POST', `/v1/events/${cancelled.id}/cancel`, { session: owner });

    const busy = await freeBusy(owner, owner.userId);
    expect(busy).not.toContainEqual({
      start: '2026-01-05T13:00:00.000Z',
      end: '2026-01-05T14:00:00.000Z',
    });
  });

  it('free/busy excludes an event the target user has DECLINED', async () => {
    const event: EventDto = await createEventViaApi(ctx, owner, {
      calendarId: calendar.id,
      title: 'Optional review',
      startsAt: isoAt(MONDAY, 15),
      endsAt: isoAt(MONDAY, 16),
      attendeeUserIds: [memberB.userId],
    });

    // Before declining, the block is busy for memberB.
    const before = await freeBusy(owner, memberB.userId);
    expect(before).toContainEqual({
      start: '2026-01-05T15:00:00.000Z',
      end: '2026-01-05T16:00:00.000Z',
    });

    // memberB declines; their free/busy drops the block.
    const rsvp = await api(ctx.app, 'POST', `/v1/events/${event.id}/rsvp`, {
      session: memberB,
      body: { response: 'DECLINED' },
    });
    expect(rsvp.statusCode).toBe(200);

    const after = await freeBusy(owner, memberB.userId);
    expect(after).not.toContainEqual({
      start: '2026-01-05T15:00:00.000Z',
      end: '2026-01-05T16:00:00.000Z',
    });
  });
});
