import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { hasPermission } from '@businessos/types';
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

const RANGE = `from=${encodeURIComponent(isoAt(MONDAY, 0))}&to=${encodeURIComponent(isoAt('2026-01-26', 0))}`;

// Guards asserted against the matrix in packages/types/src/permissions.ts.
describe('RBAC (Phase 6 calendar)', () => {
  let owner: Actor;
  let manager: Actor;
  let employee: Actor;
  let readonly: Actor;
  let accountant: Actor;
  let calendar: CalendarDto;
  let event: EventDto;
  let recurring: EventDto;

  beforeEach(async () => {
    await truncateAll(ctx.prisma);
    owner = await createUser(ctx.app, `rbac6-owner-${Date.now()}@test.local`);
    await createOrgViaApi(ctx.app, owner, 'RBAC Calendar AB');
    manager = await addMemberViaInvitation(ctx, owner, 'rbac6-mgr@example.com', 'MANAGER');
    employee = await addMemberViaInvitation(ctx, owner, 'rbac6-emp@example.com', 'EMPLOYEE');
    readonly = await addMemberViaInvitation(ctx, owner, 'rbac6-ro@example.com', 'READONLY');
    accountant = await addMemberViaInvitation(ctx, owner, 'rbac6-acc@example.com', 'ACCOUNTANT');

    calendar = await createCalendarViaApi(ctx, owner, { name: 'Team' });
    event = await createEventViaApi(ctx, owner, {
      calendarId: calendar.id,
      startsAt: isoAt(MONDAY, 9),
      endsAt: isoAt(MONDAY, 10),
    });
    recurring = await createEventViaApi(ctx, owner, {
      calendarId: calendar.id,
      startsAt: isoAt(MONDAY, 11),
      endsAt: isoAt(MONDAY, 12),
      recurrence: { freq: 'WEEKLY', interval: 1, byWeekday: [WEEKDAY.MON] },
    });
  });

  it('matrix: read vs manage per role', () => {
    for (const role of ['OWNER', 'ADMIN', 'MANAGER'] as const) {
      expect(hasPermission(role, 'calendar.read')).toBe(true);
      expect(hasPermission(role, 'calendar.manage')).toBe(true);
    }
    for (const role of ['EMPLOYEE', 'READONLY'] as const) {
      expect(hasPermission(role, 'calendar.read')).toBe(true);
      expect(hasPermission(role, 'calendar.manage')).toBe(false);
    }
    expect(hasPermission('ACCOUNTANT', 'calendar.read')).toBe(false);
    expect(hasPermission('ACCOUNTANT', 'calendar.manage')).toBe(false);
  });

  it('MANAGER can manage calendars and events (2xx)', async () => {
    const cal = await api(ctx.app, 'POST', '/v1/calendars', {
      session: manager,
      body: { name: 'Manager cal' },
    });
    expect(cal.statusCode).toBe(201);

    const create = await api(ctx.app, 'POST', '/v1/events', {
      session: manager,
      body: {
        calendarId: calendar.id,
        title: 'Mgr event',
        startsAt: isoAt(MONDAY, 13),
        endsAt: isoAt(MONDAY, 14),
      },
    });
    expect(create.statusCode).toBe(201);

    const patch = await api(ctx.app, 'PATCH', `/v1/events/${event.id}`, {
      session: manager,
      body: { title: 'Managed' },
    });
    expect(patch.statusCode).toBe(200);

    const attendee = await api(ctx.app, 'POST', `/v1/events/${event.id}/attendees`, {
      session: manager,
      body: { userId: employee.userId },
    });
    expect(attendee.statusCode).toBe(200);

    const occCancel = await api(ctx.app, 'POST', `/v1/events/${recurring.id}/occurrences/cancel`, {
      session: manager,
      body: { occurrenceStart: isoAt(MONDAY, 11) },
    });
    expect(occCancel.statusCode).toBe(204);
  });

  describe.each([
    ['EMPLOYEE', () => employee],
    ['READONLY', () => readonly],
  ])('%s (read only)', (_label, actorOf) => {
    it('can read events and agenda (200)', async () => {
      const list = await api(ctx.app, 'GET', `/v1/events?${RANGE}`, { session: actorOf() });
      expect(list.statusCode).toBe(200);
      const agenda = await api(ctx.app, 'GET', `/v1/agenda?${RANGE}`, { session: actorOf() });
      expect(agenda.statusCode).toBe(200);
      const cals = await api(ctx.app, 'GET', '/v1/calendars', { session: actorOf() });
      expect(cals.statusCode).toBe(200);
    });

    it('cannot create, update, delete, add attendees, or run occurrence ops (403)', async () => {
      const actor = actorOf();
      const create = await api(ctx.app, 'POST', '/v1/events', {
        session: actor,
        body: {
          calendarId: calendar.id,
          title: 'Nope',
          startsAt: isoAt(MONDAY, 15),
          endsAt: isoAt(MONDAY, 16),
        },
      });
      expect(create.statusCode).toBe(403);

      const patch = await api(ctx.app, 'PATCH', `/v1/events/${event.id}`, {
        session: actor,
        body: { title: 'Nope' },
      });
      expect(patch.statusCode).toBe(403);

      const del = await api(ctx.app, 'DELETE', `/v1/events/${event.id}`, { session: actor });
      expect(del.statusCode).toBe(403);

      const attendee = await api(ctx.app, 'POST', `/v1/events/${event.id}/attendees`, {
        session: actor,
        body: { userId: actor.userId },
      });
      expect(attendee.statusCode).toBe(403);

      const occ = await api(ctx.app, 'POST', `/v1/events/${recurring.id}/occurrences/cancel`, {
        session: actor,
        body: { occurrenceStart: isoAt(MONDAY, 11) },
      });
      expect(occ.statusCode).toBe(403);

      const cal = await api(ctx.app, 'POST', '/v1/calendars', {
        session: actor,
        body: { name: 'Nope' },
      });
      expect(cal.statusCode).toBe(403);
    });
  });

  it('ACCOUNTANT is forbidden from every calendar endpoint (403)', async () => {
    expect((await api(ctx.app, 'GET', '/v1/calendars', { session: accountant })).statusCode).toBe(
      403,
    );
    expect(
      (await api(ctx.app, 'GET', `/v1/events?${RANGE}`, { session: accountant })).statusCode,
    ).toBe(403);
    expect(
      (await api(ctx.app, 'GET', `/v1/agenda?${RANGE}`, { session: accountant })).statusCode,
    ).toBe(403);
    const create = await api(ctx.app, 'POST', '/v1/events', {
      session: accountant,
      body: {
        calendarId: calendar.id,
        title: 'Nope',
        startsAt: isoAt(MONDAY, 15),
        endsAt: isoAt(MONDAY, 16),
      },
    });
    expect(create.statusCode).toBe(403);
  });
});
