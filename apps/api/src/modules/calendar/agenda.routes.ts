import {
  agendaItemDtoSchema,
  agendaQuerySchema,
  freeBusyDtoSchema,
  freeBusyQuerySchema,
  type AgendaItemDto,
} from '@businessos/types';
import type { CalendarEvent, EventException, Prisma } from '@businessos/db';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { errors } from '../../lib/errors.js';
import { orgContext, requirePermission } from '../../plugins/auth.js';
import { materializeOccurrences } from './service.js';

/** Loads events a user is on (organizer or attendee) that could hit [from,to],
 *  plus their exceptions, and expands them into occurrences. */
async function occurrencesForUser(
  app: FastifyInstance,
  organizationId: string,
  userId: string,
  from: Date,
  to: Date,
) {
  const where: Prisma.CalendarEventWhereInput = {
    organizationId,
    startsAt: { lte: to },
    OR: [{ organizerId: userId }, { attendees: { some: { userId } } }],
    AND: [
      {
        OR: [
          { recurrenceFreq: null, endsAt: { gte: from } },
          {
            recurrenceFreq: { not: null },
            OR: [{ recurrenceUntil: null }, { recurrenceUntil: { gte: from } }],
          },
        ],
      },
    ],
  };
  const events: CalendarEvent[] = await app.prisma.calendarEvent.findMany({ where });
  const ids = events.map((e) => e.id);
  const exceptions: EventException[] = ids.length
    ? await app.prisma.eventException.findMany({ where: { eventId: { in: ids } } })
    : [];
  const byEvent = new Map<string, EventException[]>();
  for (const ex of exceptions) {
    const list = byEvent.get(ex.eventId) ?? [];
    list.push(ex);
    byEvent.set(ex.eventId, list);
  }
  return events.flatMap((e) => materializeOccurrences(e, byEvent.get(e.id) ?? [], from, to));
}

export function registerAgendaRoutes(app: FastifyInstance): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // --- My agenda: events I'm on + tasks assigned to me, merged --------------
  r.route({
    method: 'GET',
    url: '/v1/agenda',
    preHandler: [requirePermission('calendar.read')],
    schema: {
      tags: ['calendar'],
      querystring: agendaQuerySchema,
      response: { 200: z.array(agendaItemDtoSchema) },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const userId = request.currentUser?.id;
      if (!userId) throw errors.unauthorized();
      const from = new Date(request.query.from);
      const to = new Date(request.query.to);

      const occurrences = await occurrencesForUser(app, organizationId, userId, from, to);
      const tasks = await app.prisma.task.findMany({
        where: {
          organizationId,
          assigneeId: userId,
          dueDate: { gte: from, lte: to },
          status: { not: 'DONE' },
        },
        select: {
          id: true,
          title: true,
          status: true,
          priority: true,
          dueDate: true,
          customerId: true,
        },
      });

      const items: AgendaItemDto[] = [
        ...occurrences
          .filter((o) => o.status !== 'CANCELLED')
          .map((o): AgendaItemDto => ({
            kind: 'event',
            id: o.eventId,
            occurrenceStart: o.occurrenceStart,
            start: o.start,
            end: o.end,
            title: o.title,
            status: o.status,
            customerId: o.customerId,
          })),
        ...tasks.map((t): AgendaItemDto => ({
          kind: 'task',
          id: t.id,
          start: t.dueDate!.toISOString(),
          title: t.title,
          status: t.status,
          priority: t.priority,
          customerId: t.customerId,
        })),
      ].sort((a, b) => a.start.localeCompare(b.start));

      return reply.send(items);
    },
  });

  // --- Free/busy for any org member (times only, never details) -------------
  r.route({
    method: 'GET',
    url: '/v1/calendar/free-busy',
    preHandler: [requirePermission('calendar.read')],
    schema: {
      tags: ['calendar'],
      querystring: freeBusyQuerySchema,
      response: { 200: freeBusyDtoSchema },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const targetUserId = request.query.userId;
      const member = await app.prisma.organizationMember.findFirst({
        where: { organizationId, userId: targetUserId },
        select: { id: true },
      });
      if (!member) throw errors.notFound('Member');
      const from = new Date(request.query.from);
      const to = new Date(request.query.to);

      const occurrences = await occurrencesForUser(app, organizationId, targetUserId, from, to);
      // Exclude cancelled occurrences and events the user declined.
      const declined = new Set(
        (
          await app.prisma.eventAttendee.findMany({
            where: { organizationId, userId: targetUserId, response: 'DECLINED' },
            select: { eventId: true },
          })
        ).map((a) => a.eventId),
      );
      const busy = occurrences
        .filter((o) => o.status !== 'CANCELLED' && !declined.has(o.eventId))
        .map((o) => ({ start: o.start, end: o.end }))
        .sort((a, b) => a.start.localeCompare(b.start));

      return reply.send({ userId: targetUserId, busy });
    },
  });
}
