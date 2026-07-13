import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CalendarDto, EventDto } from '@businessos/types';
import {
  api,
  createCalendarViaApi,
  createCustomerViaApi,
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

describe('events CRUD (Phase 6)', () => {
  let owner: Actor;
  let calendar: CalendarDto;

  beforeEach(async () => {
    await truncateAll(ctx.prisma);
    owner = await createUser(ctx.app, `p6-ev-owner-${Date.now()}@test.local`);
    await createOrgViaApi(ctx.app, owner, 'Events Co');
    calendar = await createCalendarViaApi(ctx, owner, { name: 'Team' });
  });

  it('creates an event and auto-adds the organizer as an ACCEPTED attendee', async () => {
    const event = await createEventViaApi(ctx, owner, {
      calendarId: calendar.id,
      title: 'Kickoff',
      startsAt: isoAt(MONDAY, 9),
      endsAt: isoAt(MONDAY, 10),
    });

    expect(event.title).toBe('Kickoff');
    expect(event.organizerId).toBe(owner.userId);
    expect(event.status).toBe('CONFIRMED');
    expect(event.visibility).toBe('DEFAULT');
    expect(event.recurrence).toBeNull();
    expect(event.attendees).toHaveLength(1);
    expect(event.attendees[0]).toMatchObject({
      userId: owner.userId,
      response: 'ACCEPTED',
      isOrganizer: true,
    });
  });

  it('gets an event by id', async () => {
    const created = await createEventViaApi(ctx, owner, {
      calendarId: calendar.id,
      startsAt: isoAt(MONDAY, 9),
      endsAt: isoAt(MONDAY, 10),
    });
    const res = await api(ctx.app, 'GET', `/v1/events/${created.id}`, { session: owner });
    expect(res.statusCode).toBe(200);
    expect(res.json<EventDto>().id).toBe(created.id);
  });

  it('patches an event (title + location)', async () => {
    const created = await createEventViaApi(ctx, owner, {
      calendarId: calendar.id,
      startsAt: isoAt(MONDAY, 9),
      endsAt: isoAt(MONDAY, 10),
    });
    const res = await api(ctx.app, 'PATCH', `/v1/events/${created.id}`, {
      session: owner,
      body: { title: 'Renamed', location: 'Room 2' },
    });
    expect(res.statusCode).toBe(200);
    const dto = res.json<EventDto>();
    expect(dto.title).toBe('Renamed');
    expect(dto.location).toBe('Room 2');
  });

  it('deletes an event (subsequent GET is 404)', async () => {
    const created = await createEventViaApi(ctx, owner, {
      calendarId: calendar.id,
      startsAt: isoAt(MONDAY, 9),
      endsAt: isoAt(MONDAY, 10),
    });
    const del = await api(ctx.app, 'DELETE', `/v1/events/${created.id}`, { session: owner });
    expect(del.statusCode).toBe(204);
    const get = await api(ctx.app, 'GET', `/v1/events/${created.id}`, { session: owner });
    expect(get.statusCode).toBe(404);
  });

  it('cancels an event (status → CANCELLED)', async () => {
    const created = await createEventViaApi(ctx, owner, {
      calendarId: calendar.id,
      startsAt: isoAt(MONDAY, 9),
      endsAt: isoAt(MONDAY, 10),
    });
    const res = await api(ctx.app, 'POST', `/v1/events/${created.id}/cancel`, { session: owner });
    expect(res.statusCode).toBe(200);
    expect(res.json<EventDto>().status).toBe('CANCELLED');
  });

  it('rejects an event whose endsAt precedes startsAt (400)', async () => {
    const res = await api(ctx.app, 'POST', '/v1/events', {
      session: owner,
      body: {
        calendarId: calendar.id,
        title: 'Backwards',
        startsAt: isoAt(MONDAY, 10),
        endsAt: isoAt(MONDAY, 9),
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects unknown calendar / customer / attendee links (400)', async () => {
    const start = isoAt(MONDAY, 9);
    const end = isoAt(MONDAY, 10);

    const badCalendar = await api(ctx.app, 'POST', '/v1/events', {
      session: owner,
      body: { calendarId: randomUUID(), title: 'X', startsAt: start, endsAt: end },
    });
    expect(badCalendar.statusCode).toBe(400);
    expect(errorCode(badCalendar.body)).toBe('unknown_calendar');

    const badCustomer = await api(ctx.app, 'POST', '/v1/events', {
      session: owner,
      body: {
        calendarId: calendar.id,
        title: 'X',
        startsAt: start,
        endsAt: end,
        customerId: randomUUID(),
      },
    });
    expect(badCustomer.statusCode).toBe(400);
    expect(errorCode(badCustomer.body)).toBe('unknown_customer');

    const badAttendee = await api(ctx.app, 'POST', '/v1/events', {
      session: owner,
      body: {
        calendarId: calendar.id,
        title: 'X',
        startsAt: start,
        endsAt: end,
        attendeeUserIds: [randomUUID()],
      },
    });
    expect(badAttendee.statusCode).toBe(400);
    expect(errorCode(badAttendee.body)).toBe('unknown_attendee');
  });

  it('accepts a valid in-org customer link', async () => {
    const customer = await createCustomerViaApi(ctx, owner);
    const event = await createEventViaApi(ctx, owner, {
      calendarId: calendar.id,
      startsAt: isoAt(MONDAY, 9),
      endsAt: isoAt(MONDAY, 10),
      customerId: customer.id,
    });
    expect(event.customerId).toBe(customer.id);
  });
});
