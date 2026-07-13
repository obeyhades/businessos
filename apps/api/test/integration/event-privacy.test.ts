import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CalendarDto, EventDto, OccurrenceDto } from '@businessos/types';
import {
  addMemberViaInvitation,
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

async function rangeEventIds(session: Actor): Promise<string[]> {
  const from = isoAt(MONDAY, 0);
  const to = isoAt('2026-01-06', 0);
  const res = await api(
    ctx.app,
    'GET',
    `/v1/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    { session },
  );
  expect(res.statusCode).toBe(200);
  return res.json<OccurrenceDto[]>().map((o) => o.eventId);
}

describe('event privacy (Phase 6)', () => {
  let owner: Actor;
  let outsiderMember: Actor; // in the org, but not an attendee of the private event
  let readonlyMember: Actor;
  let calendar: CalendarDto;
  let privateEvent: EventDto;
  let defaultEvent: EventDto;

  beforeEach(async () => {
    await truncateAll(ctx.prisma);
    owner = await createUser(ctx.app, `p6-priv-owner-${Date.now()}@test.local`);
    await createOrgViaApi(ctx.app, owner, 'Privacy Co');
    outsiderMember = await addMemberViaInvitation(ctx, owner, 'p6-priv-b@example.com', 'EMPLOYEE');
    readonlyMember = await addMemberViaInvitation(ctx, owner, 'p6-priv-ro@example.com', 'READONLY');
    calendar = await createCalendarViaApi(ctx, owner, { name: 'Team' });

    privateEvent = await createEventViaApi(ctx, owner, {
      calendarId: calendar.id,
      title: 'Secret 1:1',
      startsAt: isoAt(MONDAY, 9),
      endsAt: isoAt(MONDAY, 10),
      visibility: 'PRIVATE',
    });
    defaultEvent = await createEventViaApi(ctx, owner, {
      calendarId: calendar.id,
      title: 'Team sync',
      startsAt: isoAt(MONDAY, 11),
      endsAt: isoAt(MONDAY, 12),
      visibility: 'DEFAULT',
    });
  });

  it('hides a PRIVATE event from a non-attendee (absent from range, 404 on detail)', async () => {
    const ids = await rangeEventIds(outsiderMember);
    expect(ids).not.toContain(privateEvent.id);

    const detail = await api(ctx.app, 'GET', `/v1/events/${privateEvent.id}`, {
      session: outsiderMember,
    });
    expect(detail.statusCode).toBe(404);
  });

  it('shows a PRIVATE event to its organizer', async () => {
    const ids = await rangeEventIds(owner);
    expect(ids).toContain(privateEvent.id);

    const detail = await api(ctx.app, 'GET', `/v1/events/${privateEvent.id}`, { session: owner });
    expect(detail.statusCode).toBe(200);
    expect(detail.json<EventDto>().id).toBe(privateEvent.id);
  });

  it('shows a PRIVATE event to an added attendee', async () => {
    await api(ctx.app, 'POST', `/v1/events/${privateEvent.id}/attendees`, {
      session: owner,
      body: { userId: outsiderMember.userId },
    });

    const ids = await rangeEventIds(outsiderMember);
    expect(ids).toContain(privateEvent.id);

    const detail = await api(ctx.app, 'GET', `/v1/events/${privateEvent.id}`, {
      session: outsiderMember,
    });
    expect(detail.statusCode).toBe(200);
  });

  it('shows a DEFAULT event to every calendar reader', async () => {
    for (const reader of [owner, outsiderMember, readonlyMember]) {
      const ids = await rangeEventIds(reader);
      expect(ids).toContain(defaultEvent.id);

      const detail = await api(ctx.app, 'GET', `/v1/events/${defaultEvent.id}`, {
        session: reader,
      });
      expect(detail.statusCode).toBe(200);
    }
  });
});
