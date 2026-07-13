import type { CalendarEvent, EventException, Prisma, PrismaClient } from '@businessos/db';
import { expandOccurrences, type OccurrenceDto, type RecurrenceSpec } from '@businessos/types';
import { errors } from '../../lib/errors.js';

type Db = Prisma.TransactionClient | PrismaClient;

type RecurrenceFields = Pick<
  CalendarEvent,
  | 'startsAt'
  | 'recurrenceFreq'
  | 'recurrenceInterval'
  | 'recurrenceByWeekday'
  | 'recurrenceCount'
  | 'recurrenceUntil'
>;

/** Builds the pure-function recurrence spec from a stored event row. */
export function buildRecurrenceSpec(event: RecurrenceFields): RecurrenceSpec {
  return {
    startsAt: event.startsAt,
    freq: event.recurrenceFreq,
    interval: event.recurrenceInterval,
    byWeekday: event.recurrenceByWeekday,
    count: event.recurrenceCount,
    until: event.recurrenceUntil,
  };
}

/**
 * Prisma `where` fragment enforcing event privacy: a PRIVATE event is only
 * visible to its organizer or an attendee. DEFAULT events are visible to anyone
 * who can read the calendar module.
 */
export function visibilityWhere(userId: string | undefined): Prisma.CalendarEventWhereInput {
  return {
    OR: [
      { visibility: 'DEFAULT' },
      ...(userId ? [{ organizerId: userId }, { attendees: { some: { userId } } }] : []),
    ],
  };
}

/** Whether the given user may see a PRIVATE event (organizer or attendee). */
export function canSeeEvent(
  event: { visibility: string; organizerId: string | null },
  attendeeUserIds: Set<string>,
  userId: string | undefined,
): boolean {
  if (event.visibility === 'DEFAULT') return true;
  if (!userId) return false;
  return event.organizerId === userId || attendeeUserIds.has(userId);
}

/**
 * Expands one event into its concrete occurrences overlapping [from, to],
 * applying per-occurrence exceptions (cancellations + overrides), including
 * overrides that moved an occurrence into the window from just outside it.
 */
export function materializeOccurrences(
  event: CalendarEvent,
  exceptions: EventException[],
  from: Date,
  to: Date,
): OccurrenceDto[] {
  const durationMs = Math.max(0, event.endsAt.getTime() - event.startsAt.getTime());
  const rule = expandOccurrences(buildRecurrenceSpec(event), durationMs, from, to);
  const exByStart = new Map(exceptions.map((e) => [e.occurrenceStart.toISOString(), e]));
  const seen = new Set<string>();
  const overlaps = (s: Date, e: Date): boolean =>
    s.getTime() < to.getTime() && e.getTime() > from.getTime();
  const isRecurring = event.recurrenceFreq != null;

  const make = (
    occurrenceStart: Date,
    start: Date,
    end: Date,
    title: string,
    location: string | null,
    status: OccurrenceDto['status'],
    isException: boolean,
  ): OccurrenceDto => ({
    eventId: event.id,
    calendarId: event.calendarId,
    occurrenceStart: occurrenceStart.toISOString(),
    start: start.toISOString(),
    end: end.toISOString(),
    title,
    location,
    allDay: event.allDay,
    status,
    visibility: event.visibility,
    isRecurring,
    isException,
    organizerId: event.organizerId,
    customerId: event.customerId,
    projectId: event.projectId,
    taskId: event.taskId,
  });

  const out: OccurrenceDto[] = [];
  for (const occ of rule) {
    const key = occ.start.toISOString();
    seen.add(key);
    const ex = exByStart.get(key);
    if (ex?.type === 'CANCELLED') continue;
    if (ex?.type === 'OVERRIDE') {
      const start = ex.startsAt ?? occ.start;
      const end = ex.endsAt ?? occ.end;
      if (!overlaps(start, end)) continue; // moved out of the window
      out.push(
        make(
          occ.start,
          start,
          end,
          ex.title ?? event.title,
          ex.location ?? event.location,
          ex.status ?? event.status,
          true,
        ),
      );
    } else {
      out.push(
        make(occ.start, occ.start, occ.end, event.title, event.location, event.status, false),
      );
    }
  }

  // Overrides whose rule slot was outside the window but which were moved in.
  for (const ex of exceptions) {
    if (ex.type !== 'OVERRIDE' || seen.has(ex.occurrenceStart.toISOString()) || !ex.startsAt) {
      continue;
    }
    const start = ex.startsAt;
    const end = ex.endsAt ?? new Date(start.getTime() + durationMs);
    if (!overlaps(start, end)) continue;
    out.push(
      make(
        ex.occurrenceStart,
        start,
        end,
        ex.title ?? event.title,
        ex.location ?? event.location,
        ex.status ?? event.status,
        true,
      ),
    );
  }

  out.sort((a, b) => a.start.localeCompare(b.start));
  return out;
}

/** Validates that any provided customer/project/task links belong to the org. */
export async function assertLinksInOrg(
  db: Db,
  organizationId: string,
  links: { customerId?: string | null; projectId?: string | null; taskId?: string | null },
): Promise<void> {
  const checks: Array<Promise<unknown>> = [];
  if (links.customerId) {
    checks.push(
      db.customer
        .findFirst({ where: { id: links.customerId, organizationId }, select: { id: true } })
        .then((r) => {
          if (!r)
            throw errors.badRequest('unknown_customer', 'Customer not found in this organization');
        }),
    );
  }
  if (links.projectId) {
    checks.push(
      db.project
        .findFirst({ where: { id: links.projectId, organizationId }, select: { id: true } })
        .then((r) => {
          if (!r)
            throw errors.badRequest('unknown_project', 'Project not found in this organization');
        }),
    );
  }
  if (links.taskId) {
    checks.push(
      db.task
        .findFirst({ where: { id: links.taskId, organizationId }, select: { id: true } })
        .then((r) => {
          if (!r) throw errors.badRequest('unknown_task', 'Task not found in this organization');
        }),
    );
  }
  await Promise.all(checks);
}

/** Validates that all given user ids are members of the org. */
export async function assertOrgMembers(
  db: Db,
  organizationId: string,
  userIds: string[],
): Promise<void> {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return;
  const count = await db.organizationMember.count({
    where: { organizationId, userId: { in: unique } },
  });
  if (count !== unique.length) {
    throw errors.badRequest(
      'unknown_attendee',
      'One or more attendees are not members of this organization',
    );
  }
}
