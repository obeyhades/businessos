import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CalendarDto, EventDto } from '@businessos/types';
import {
  addMemberViaInvitation,
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

function attendee(event: EventDto, userId: string) {
  return event.attendees.find((a) => a.userId === userId);
}

describe('attendees & RSVP (Phase 6)', () => {
  let owner: Actor;
  let memberB: Actor;
  let memberC: Actor;
  let calendar: CalendarDto;
  let event: EventDto;

  beforeEach(async () => {
    await truncateAll(ctx.prisma);
    owner = await createUser(ctx.app, `p6-att-owner-${Date.now()}@test.local`);
    await createOrgViaApi(ctx.app, owner, 'Attendees Co');
    memberB = await addMemberViaInvitation(ctx, owner, 'p6-att-b@example.com', 'EMPLOYEE');
    memberC = await addMemberViaInvitation(ctx, owner, 'p6-att-c@example.com', 'EMPLOYEE');
    calendar = await createCalendarViaApi(ctx, owner, { name: 'Team' });
    event = await createEventViaApi(ctx, owner, {
      calendarId: calendar.id,
      title: 'Planning',
      startsAt: isoAt(MONDAY, 9),
      endsAt: isoAt(MONDAY, 10),
    });
  });

  it('adds an org member as an attendee (NEEDS_ACTION by default)', async () => {
    const res = await api(ctx.app, 'POST', `/v1/events/${event.id}/attendees`, {
      session: owner,
      body: { userId: memberB.userId },
    });
    expect(res.statusCode).toBe(200);
    const dto = res.json<EventDto>();
    expect(attendee(dto, memberB.userId)).toMatchObject({
      userId: memberB.userId,
      response: 'NEEDS_ACTION',
      isOrganizer: false,
    });
  });

  it('refuses to add a non-member as an attendee (400 unknown_attendee)', async () => {
    const outsider = await createUser(ctx.app, `p6-att-outsider-${Date.now()}@test.local`);
    await createOrgViaApi(ctx.app, outsider, 'Outsider Org');

    const res = await api(ctx.app, 'POST', `/v1/events/${event.id}/attendees`, {
      session: owner,
      body: { userId: outsider.userId },
    });
    expect(res.statusCode).toBe(400);
    expect(errorCode(res.body)).toBe('unknown_attendee');
  });

  it('removes an attendee', async () => {
    await api(ctx.app, 'POST', `/v1/events/${event.id}/attendees`, {
      session: owner,
      body: { userId: memberB.userId },
    });
    const res = await api(ctx.app, 'DELETE', `/v1/events/${event.id}/attendees/${memberB.userId}`, {
      session: owner,
    });
    expect(res.statusCode).toBe(200);
    expect(attendee(res.json<EventDto>(), memberB.userId)).toBeUndefined();
  });

  it('refuses to remove the organizer (409 cannot_remove_organizer)', async () => {
    const res = await api(ctx.app, 'DELETE', `/v1/events/${event.id}/attendees/${owner.userId}`, {
      session: owner,
    });
    expect(res.statusCode).toBe(409);
    expect(errorCode(res.body)).toBe('cannot_remove_organizer');
  });

  it('lets an attendee RSVP ACCEPTED then DECLINED for themselves', async () => {
    await api(ctx.app, 'POST', `/v1/events/${event.id}/attendees`, {
      session: owner,
      body: { userId: memberB.userId },
    });

    const accepted = await api(ctx.app, 'POST', `/v1/events/${event.id}/rsvp`, {
      session: memberB,
      body: { response: 'ACCEPTED' },
    });
    expect(accepted.statusCode).toBe(200);
    expect(attendee(accepted.json<EventDto>(), memberB.userId)?.response).toBe('ACCEPTED');

    const declined = await api(ctx.app, 'POST', `/v1/events/${event.id}/rsvp`, {
      session: memberB,
      body: { response: 'DECLINED' },
    });
    expect(declined.statusCode).toBe(200);
    expect(attendee(declined.json<EventDto>(), memberB.userId)?.response).toBe('DECLINED');
  });

  it('forbids RSVP from a member who is not an attendee (403)', async () => {
    const res = await api(ctx.app, 'POST', `/v1/events/${event.id}/rsvp`, {
      session: memberC,
      body: { response: 'ACCEPTED' },
    });
    expect(res.statusCode).toBe(403);
  });
});
