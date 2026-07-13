import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CalendarDto } from '@businessos/types';
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
  makeCalendarDefault,
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

describe('calendars (Phase 6)', () => {
  let owner: Actor;
  let member: Actor;

  beforeEach(async () => {
    await truncateAll(ctx.prisma);
    owner = await createUser(ctx.app, `p6-cal-owner-${Date.now()}@test.local`);
    await createOrgViaApi(ctx.app, owner, 'Calendar Co');
    member = await addMemberViaInvitation(ctx, owner, 'p6-cal-member@example.com', 'MANAGER');
  });

  it('creates, lists, patches, and deletes a calendar', async () => {
    const created = await createCalendarViaApi(ctx, owner, { name: 'Projects', color: '#10b981' });
    expect(created.name).toBe('Projects');
    expect(created.color).toBe('#10b981');
    expect(created.type).toBe('TEAM');
    expect(created.isDefault).toBe(false);

    const list = await api(ctx.app, 'GET', '/v1/calendars', { session: owner });
    expect(list.statusCode).toBe(200);
    expect(list.json<CalendarDto[]>().map((c) => c.id)).toContain(created.id);

    const patched = await api(ctx.app, 'PATCH', `/v1/calendars/${created.id}`, {
      session: owner,
      body: { name: 'Renamed' },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json<CalendarDto>().name).toBe('Renamed');

    const del = await api(ctx.app, 'DELETE', `/v1/calendars/${created.id}`, { session: owner });
    expect(del.statusCode).toBe(204);
    const after = await api(ctx.app, 'GET', '/v1/calendars', { session: owner });
    expect(after.json<CalendarDto[]>().map((c) => c.id)).not.toContain(created.id);
  });

  it('refuses to delete the default calendar (409 calendar_is_default)', async () => {
    const cal = await createCalendarViaApi(ctx, owner, { name: 'Team' });
    await makeCalendarDefault(ctx, owner, cal.id);

    const del = await api(ctx.app, 'DELETE', `/v1/calendars/${cal.id}`, { session: owner });
    expect(del.statusCode).toBe(409);
    expect(errorCode(del.body)).toBe('calendar_is_default');

    // Still present.
    const list = await api(ctx.app, 'GET', '/v1/calendars', { session: owner });
    expect(list.json<CalendarDto[]>().find((c) => c.id === cal.id)?.isDefault).toBe(true);
  });

  it('refuses to delete a calendar that still has events (409 calendar_in_use)', async () => {
    const cal = await createCalendarViaApi(ctx, owner, { name: 'Busy' });
    await createEventViaApi(ctx, owner, {
      calendarId: cal.id,
      startsAt: isoAt(MONDAY, 9),
      endsAt: isoAt(MONDAY, 10),
    });

    const del = await api(ctx.app, 'DELETE', `/v1/calendars/${cal.id}`, { session: owner });
    expect(del.statusCode).toBe(409);
    expect(errorCode(del.body)).toBe('calendar_in_use');
  });

  it('shows a PERSONAL calendar only to its owner, not to other members', async () => {
    const personal = await createCalendarViaApi(ctx, owner, {
      name: 'My focus',
      type: 'PERSONAL',
    });
    expect(personal.type).toBe('PERSONAL');
    expect(personal.ownerId).toBe(owner.userId);

    const ownerList = await api(ctx.app, 'GET', '/v1/calendars', { session: owner });
    expect(ownerList.json<CalendarDto[]>().map((c) => c.id)).toContain(personal.id);

    const memberList = await api(ctx.app, 'GET', '/v1/calendars', { session: member });
    expect(memberList.json<CalendarDto[]>().map((c) => c.id)).not.toContain(personal.id);
  });

  it('scopes calendars per tenant: another org cannot see, patch, or delete them', async () => {
    const cal = await createCalendarViaApi(ctx, owner, { name: 'A private team cal' });

    const outsider = await createUser(ctx.app, `p6-cal-outsider-${Date.now()}@test.local`);
    await createOrgViaApi(ctx.app, outsider, 'Other Org');

    const list = await api(ctx.app, 'GET', '/v1/calendars', { session: outsider });
    expect(list.json<CalendarDto[]>().map((c) => c.id)).not.toContain(cal.id);

    expect(
      (
        await api(ctx.app, 'PATCH', `/v1/calendars/${cal.id}`, {
          session: outsider,
          body: { name: 'Hijacked' },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await api(ctx.app, 'DELETE', `/v1/calendars/${cal.id}`, { session: outsider })).statusCode,
    ).toBe(404);
  });
});
