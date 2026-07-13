import {
  addAttendeeBodySchema,
  attendeeIdParamsSchema,
  cancelOccurrenceBodySchema,
  createEventBodySchema,
  eventDtoSchema,
  eventIdParamsSchema,
  eventRangeQuerySchema,
  occurrenceDtoSchema,
  overrideOccurrenceBodySchema,
  rsvpBodySchema,
  updateEventBodySchema,
  type RecurrenceInput,
} from '@businessos/types';
import type { Prisma } from '@businessos/db';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { errors } from '../../lib/errors.js';
import { orgContext, requirePermission } from '../../plugins/auth.js';
import { auditContext, recordAudit } from '../audit/service.js';
import { recordActivity } from '../activity/service.js';
import { enqueueOutbox } from '../outbox/service.js';
import { eventInclude, toEventDto } from './mappers.js';
import {
  assertLinksInOrg,
  assertOrgMembers,
  canSeeEvent,
  materializeOccurrences,
  visibilityWhere,
} from './service.js';

function recurrenceFields(rec: RecurrenceInput | null | undefined) {
  if (!rec) {
    return {
      recurrenceFreq: null,
      recurrenceInterval: 1,
      recurrenceByWeekday: [] as number[],
      recurrenceCount: null,
      recurrenceUntil: null,
    };
  }
  return {
    recurrenceFreq: rec.freq,
    recurrenceInterval: rec.interval,
    recurrenceByWeekday: rec.byWeekday,
    recurrenceCount: rec.count ?? null,
    recurrenceUntil: rec.until ? new Date(rec.until) : null,
  };
}

async function loadEventForUser(
  app: FastifyInstance,
  organizationId: string,
  eventId: string,
  userId: string | undefined,
) {
  const event = await app.prisma.calendarEvent.findFirst({
    where: { id: eventId, organizationId },
    include: eventInclude,
  });
  if (!event) throw errors.notFound('Event');
  const attendeeIds = new Set(event.attendees.map((a) => a.userId));
  if (!canSeeEvent(event, attendeeIds, userId)) throw errors.notFound('Event');
  return event;
}

export function registerEventRoutes(app: FastifyInstance): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // --- Range list: expanded occurrences, privacy-filtered ---------------------
  r.route({
    method: 'GET',
    url: '/v1/events',
    preHandler: [requirePermission('calendar.read')],
    schema: {
      tags: ['events'],
      querystring: eventRangeQuerySchema,
      response: { 200: z.array(occurrenceDtoSchema) },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const userId = request.currentUser?.id;
      const from = new Date(request.query.from);
      const to = new Date(request.query.to);
      if (to.getTime() < from.getTime()) {
        throw errors.badRequest('bad_range', 'to must be on or after from');
      }

      const and: Prisma.CalendarEventWhereInput[] = [
        visibilityWhere(userId),
        // Series that could have an occurrence overlapping the window.
        { startsAt: { lte: to } },
        {
          OR: [
            { recurrenceFreq: null, endsAt: { gte: from } },
            {
              recurrenceFreq: { not: null },
              OR: [{ recurrenceUntil: null }, { recurrenceUntil: { gte: from } }],
            },
          ],
        },
      ];
      if (request.query.calendarId) and.push({ calendarId: request.query.calendarId });
      if (request.query.customerId) and.push({ customerId: request.query.customerId });
      if (request.query.mine === 'true' && userId) {
        and.push({ OR: [{ organizerId: userId }, { attendees: { some: { userId } } }] });
      }

      const events = await app.prisma.calendarEvent.findMany({
        where: { organizationId, AND: and },
      });
      const eventIds = events.map((e) => e.id);
      const exceptions = eventIds.length
        ? await app.prisma.eventException.findMany({ where: { eventId: { in: eventIds } } })
        : [];
      const exByEvent = new Map<string, typeof exceptions>();
      for (const ex of exceptions) {
        const list = exByEvent.get(ex.eventId) ?? [];
        list.push(ex);
        exByEvent.set(ex.eventId, list);
      }

      const occurrences = events
        .flatMap((e) => materializeOccurrences(e, exByEvent.get(e.id) ?? [], from, to))
        .sort((a, b) => a.start.localeCompare(b.start));
      return reply.send(occurrences);
    },
  });

  // --- Create -----------------------------------------------------------------
  r.route({
    method: 'POST',
    url: '/v1/events',
    preHandler: [requirePermission('calendar.manage')],
    schema: { tags: ['events'], body: createEventBodySchema, response: { 201: eventDtoSchema } },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const body = request.body;
      const organizerId = request.currentUser?.id ?? null;

      const calendar = await app.prisma.calendar.findFirst({
        where: { id: body.calendarId, organizationId },
        select: { id: true },
      });
      if (!calendar)
        throw errors.badRequest('unknown_calendar', 'Calendar not found in this organization');
      await assertLinksInOrg(app.prisma, organizationId, body);
      // Attendees + organizer must all be org members.
      const attendeeIds = [
        ...new Set([...(organizerId ? [organizerId] : []), ...body.attendeeUserIds]),
      ];
      await assertOrgMembers(app.prisma, organizationId, attendeeIds);

      const event = await app.prisma.$transaction(async (tx) => {
        const created = await tx.calendarEvent.create({
          data: {
            organizationId,
            calendarId: body.calendarId,
            title: body.title,
            description: body.description ?? null,
            location: body.location ?? null,
            startsAt: new Date(body.startsAt),
            endsAt: new Date(body.endsAt),
            allDay: body.allDay,
            timezone: body.timezone,
            status: body.status,
            visibility: body.visibility,
            organizerId,
            customerId: body.customerId ?? null,
            projectId: body.projectId ?? null,
            taskId: body.taskId ?? null,
            ...recurrenceFields(body.recurrence),
            createdById: organizerId,
            attendees: {
              create: attendeeIds.map((userId) => ({
                organizationId,
                userId,
                response: userId === organizerId ? 'ACCEPTED' : 'NEEDS_ACTION',
                isOrganizer: userId === organizerId,
              })),
            },
            reminders: {
              create: body.reminders.map((rem) => ({
                organizationId,
                minutesBefore: rem.minutesBefore,
                method: 'EMAIL' as const,
              })),
            },
          },
          include: eventInclude,
        });
        await recordAudit(tx, {
          action: 'event.created',
          organizationId,
          ...auditContext(request),
          entityType: 'calendar_event',
          entityId: created.id,
          metadata: { title: created.title, recurring: created.recurrenceFreq != null },
        });
        if (created.customerId || created.projectId || created.taskId) {
          await recordActivity(tx, {
            organizationId,
            actorUserId: organizerId,
            type: 'event.scheduled',
            ref: {
              customerId: created.customerId,
              projectId: created.projectId,
              taskId: created.taskId,
              employeeId: null,
            },
            metadata: { title: created.title, startsAt: created.startsAt.toISOString() },
          });
        }
        await enqueueOutbox(tx, 'calendar.event.created', {
          organizationId,
          eventId: created.id,
          title: created.title,
        });
        return created;
      });
      return reply.code(201).send(toEventDto(event));
    },
  });

  // --- Read one ---------------------------------------------------------------
  r.route({
    method: 'GET',
    url: '/v1/events/:eventId',
    preHandler: [requirePermission('calendar.read')],
    schema: { tags: ['events'], params: eventIdParamsSchema, response: { 200: eventDtoSchema } },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const event = await loadEventForUser(
        app,
        organizationId,
        request.params.eventId,
        request.currentUser?.id,
      );
      return reply.send(toEventDto(event));
    },
  });

  // --- Update series ----------------------------------------------------------
  r.route({
    method: 'PATCH',
    url: '/v1/events/:eventId',
    preHandler: [requirePermission('calendar.manage')],
    schema: {
      tags: ['events'],
      params: eventIdParamsSchema,
      body: updateEventBodySchema,
      response: { 200: eventDtoSchema },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const body = request.body;
      const existing = await app.prisma.calendarEvent.findFirst({
        where: { id: request.params.eventId, organizationId },
        include: { attendees: true },
      });
      if (!existing) throw errors.notFound('Event');

      if (body.calendarId) {
        const cal = await app.prisma.calendar.findFirst({
          where: { id: body.calendarId, organizationId },
          select: { id: true },
        });
        if (!cal)
          throw errors.badRequest('unknown_calendar', 'Calendar not found in this organization');
      }
      await assertLinksInOrg(app.prisma, organizationId, body);
      if (body.attendeeUserIds)
        await assertOrgMembers(app.prisma, organizationId, body.attendeeUserIds);

      // startsAt/endsAt cross-validation on the merged result.
      const nextStart = body.startsAt ? new Date(body.startsAt) : existing.startsAt;
      const nextEnd = body.endsAt ? new Date(body.endsAt) : existing.endsAt;
      if (nextEnd.getTime() < nextStart.getTime()) {
        throw errors.badRequest('bad_range', 'endsAt must be on or after startsAt');
      }

      const event = await app.prisma.$transaction(async (tx) => {
        const data: Prisma.CalendarEventUpdateInput = {};
        if (body.calendarId) data.calendar = { connect: { id: body.calendarId } };
        if (body.title !== undefined) data.title = body.title;
        if (body.description !== undefined) data.description = body.description;
        if (body.location !== undefined) data.location = body.location;
        if (body.startsAt !== undefined) data.startsAt = new Date(body.startsAt);
        if (body.endsAt !== undefined) data.endsAt = new Date(body.endsAt);
        if (body.allDay !== undefined) data.allDay = body.allDay;
        if (body.timezone !== undefined) data.timezone = body.timezone;
        if (body.status !== undefined) data.status = body.status;
        if (body.visibility !== undefined) data.visibility = body.visibility;
        if (body.customerId !== undefined)
          data.customer = body.customerId
            ? { connect: { id: body.customerId } }
            : { disconnect: true };
        if (body.projectId !== undefined)
          data.project = body.projectId
            ? { connect: { id: body.projectId } }
            : { disconnect: true };
        if (body.taskId !== undefined)
          data.task = body.taskId ? { connect: { id: body.taskId } } : { disconnect: true };
        if (body.recurrence !== undefined) Object.assign(data, recurrenceFields(body.recurrence));

        await tx.calendarEvent.update({ where: { id: existing.id }, data });

        if (body.reminders !== undefined) {
          await tx.eventReminder.deleteMany({ where: { eventId: existing.id } });
          if (body.reminders.length > 0) {
            await tx.eventReminder.createMany({
              data: body.reminders.map((rem) => ({
                organizationId,
                eventId: existing.id,
                minutesBefore: rem.minutesBefore,
                method: 'EMAIL' as const,
              })),
            });
          }
        }

        if (body.attendeeUserIds !== undefined) {
          const organizerId = existing.organizerId;
          const keep = new Set([...body.attendeeUserIds, ...(organizerId ? [organizerId] : [])]);
          const current = new Set(existing.attendees.map((a) => a.userId));
          const toRemove = [...current].filter((id) => !keep.has(id));
          const toAdd = [...keep].filter((id) => !current.has(id));
          if (toRemove.length > 0) {
            await tx.eventAttendee.deleteMany({
              where: { eventId: existing.id, userId: { in: toRemove } },
            });
          }
          if (toAdd.length > 0) {
            await tx.eventAttendee.createMany({
              data: toAdd.map((userId) => ({
                organizationId,
                eventId: existing.id,
                userId,
                response: userId === organizerId ? 'ACCEPTED' : 'NEEDS_ACTION',
                isOrganizer: userId === organizerId,
              })),
            });
          }
        }

        const fresh = await tx.calendarEvent.findUniqueOrThrow({
          where: { id: existing.id },
          include: eventInclude,
        });
        await recordAudit(tx, {
          action: 'event.updated',
          organizationId,
          ...auditContext(request),
          entityType: 'calendar_event',
          entityId: existing.id,
          metadata: { fields: Object.keys(body) },
        });
        await enqueueOutbox(tx, 'calendar.event.updated', {
          organizationId,
          eventId: existing.id,
        });
        return fresh;
      });
      return reply.send(toEventDto(event));
    },
  });

  // --- Cancel whole series (soft) --------------------------------------------
  r.route({
    method: 'POST',
    url: '/v1/events/:eventId/cancel',
    preHandler: [requirePermission('calendar.manage')],
    schema: { tags: ['events'], params: eventIdParamsSchema, response: { 200: eventDtoSchema } },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const existing = await app.prisma.calendarEvent.findFirst({
        where: { id: request.params.eventId, organizationId },
        select: { id: true, customerId: true, projectId: true, taskId: true, title: true },
      });
      if (!existing) throw errors.notFound('Event');
      const event = await app.prisma.$transaction(async (tx) => {
        await tx.calendarEvent.update({
          where: { id: existing.id },
          data: { status: 'CANCELLED' },
        });
        await recordAudit(tx, {
          action: 'event.cancelled',
          organizationId,
          ...auditContext(request),
          entityType: 'calendar_event',
          entityId: existing.id,
          metadata: {},
        });
        if (existing.customerId || existing.projectId || existing.taskId) {
          await recordActivity(tx, {
            organizationId,
            actorUserId: request.currentUser?.id ?? null,
            type: 'event.cancelled',
            ref: {
              customerId: existing.customerId,
              projectId: existing.projectId,
              taskId: existing.taskId,
              employeeId: null,
            },
            metadata: { title: existing.title },
          });
        }
        await enqueueOutbox(tx, 'calendar.event.cancelled', {
          organizationId,
          eventId: existing.id,
        });
        return tx.calendarEvent.findUniqueOrThrow({
          where: { id: existing.id },
          include: eventInclude,
        });
      });
      return reply.send(toEventDto(event));
    },
  });

  // --- Delete series ----------------------------------------------------------
  r.route({
    method: 'DELETE',
    url: '/v1/events/:eventId',
    preHandler: [requirePermission('calendar.manage')],
    schema: { tags: ['events'], params: eventIdParamsSchema },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const existing = await app.prisma.calendarEvent.findFirst({
        where: { id: request.params.eventId, organizationId },
        select: { id: true },
      });
      if (!existing) throw errors.notFound('Event');
      await app.prisma.$transaction(async (tx) => {
        await tx.calendarEvent.delete({ where: { id: existing.id } });
        await recordAudit(tx, {
          action: 'event.deleted',
          organizationId,
          ...auditContext(request),
          entityType: 'calendar_event',
          entityId: existing.id,
          metadata: {},
        });
      });
      return reply.code(204).send();
    },
  });

  // --- Per-occurrence cancel (recurring only) ---------------------------------
  r.route({
    method: 'POST',
    url: '/v1/events/:eventId/occurrences/cancel',
    preHandler: [requirePermission('calendar.manage')],
    schema: {
      tags: ['events'],
      params: eventIdParamsSchema,
      body: cancelOccurrenceBodySchema,
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const event = await app.prisma.calendarEvent.findFirst({
        where: { id: request.params.eventId, organizationId },
        select: { id: true, recurrenceFreq: true, startsAt: true },
      });
      if (!event) throw errors.notFound('Event');
      if (!event.recurrenceFreq) {
        throw errors.badRequest(
          'not_recurring',
          'Only recurring events have occurrence-level operations',
        );
      }
      const occurrenceStart = new Date(request.body.occurrenceStart);
      await app.prisma.$transaction(async (tx) => {
        await tx.eventException.upsert({
          where: { eventId_occurrenceStart: { eventId: event.id, occurrenceStart } },
          create: { organizationId, eventId: event.id, occurrenceStart, type: 'CANCELLED' },
          update: {
            type: 'CANCELLED',
            title: null,
            description: null,
            location: null,
            startsAt: null,
            endsAt: null,
            status: null,
          },
        });
        await recordAudit(tx, {
          action: 'event.occurrence_cancelled',
          organizationId,
          ...auditContext(request),
          entityType: 'calendar_event',
          entityId: event.id,
          metadata: { occurrenceStart: occurrenceStart.toISOString() },
        });
      });
      return reply.code(204).send();
    },
  });

  // --- Per-occurrence override (recurring only) -------------------------------
  r.route({
    method: 'POST',
    url: '/v1/events/:eventId/occurrences/override',
    preHandler: [requirePermission('calendar.manage')],
    schema: {
      tags: ['events'],
      params: eventIdParamsSchema,
      body: overrideOccurrenceBodySchema,
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const body = request.body;
      const event = await app.prisma.calendarEvent.findFirst({
        where: { id: request.params.eventId, organizationId },
        select: { id: true, recurrenceFreq: true },
      });
      if (!event) throw errors.notFound('Event');
      if (!event.recurrenceFreq) {
        throw errors.badRequest(
          'not_recurring',
          'Only recurring events have occurrence-level operations',
        );
      }
      if (
        body.startsAt &&
        body.endsAt &&
        new Date(body.endsAt).getTime() < new Date(body.startsAt).getTime()
      ) {
        throw errors.badRequest('bad_range', 'endsAt must be on or after startsAt');
      }
      const occurrenceStart = new Date(body.occurrenceStart);
      const fields = {
        type: 'OVERRIDE' as const,
        title: body.title ?? null,
        description: body.description ?? null,
        location: body.location ?? null,
        startsAt: body.startsAt ? new Date(body.startsAt) : null,
        endsAt: body.endsAt ? new Date(body.endsAt) : null,
        status: body.status ?? null,
      };
      await app.prisma.$transaction(async (tx) => {
        await tx.eventException.upsert({
          where: { eventId_occurrenceStart: { eventId: event.id, occurrenceStart } },
          create: { organizationId, eventId: event.id, occurrenceStart, ...fields },
          update: fields,
        });
        await recordAudit(tx, {
          action: 'event.occurrence_overridden',
          organizationId,
          ...auditContext(request),
          entityType: 'calendar_event',
          entityId: event.id,
          metadata: { occurrenceStart: occurrenceStart.toISOString() },
        });
      });
      return reply.code(204).send();
    },
  });

  // --- Attendees --------------------------------------------------------------
  r.route({
    method: 'POST',
    url: '/v1/events/:eventId/attendees',
    preHandler: [requirePermission('calendar.manage')],
    schema: {
      tags: ['events'],
      params: eventIdParamsSchema,
      body: addAttendeeBodySchema,
      response: { 200: eventDtoSchema },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const event = await app.prisma.calendarEvent.findFirst({
        where: { id: request.params.eventId, organizationId },
        select: { id: true },
      });
      if (!event) throw errors.notFound('Event');
      await assertOrgMembers(app.prisma, organizationId, [request.body.userId]);
      const updated = await app.prisma.$transaction(async (tx) => {
        await tx.eventAttendee.upsert({
          where: { eventId_userId: { eventId: event.id, userId: request.body.userId } },
          create: { organizationId, eventId: event.id, userId: request.body.userId },
          update: {},
        });
        await recordAudit(tx, {
          action: 'event_attendee.added',
          organizationId,
          ...auditContext(request),
          entityType: 'calendar_event',
          entityId: event.id,
          metadata: { userId: request.body.userId },
        });
        return tx.calendarEvent.findUniqueOrThrow({
          where: { id: event.id },
          include: eventInclude,
        });
      });
      return reply.send(toEventDto(updated));
    },
  });

  r.route({
    method: 'DELETE',
    url: '/v1/events/:eventId/attendees/:userId',
    preHandler: [requirePermission('calendar.manage')],
    schema: { tags: ['events'], params: attendeeIdParamsSchema, response: { 200: eventDtoSchema } },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const attendee = await app.prisma.eventAttendee.findFirst({
        where: { eventId: request.params.eventId, userId: request.params.userId, organizationId },
        select: { id: true, isOrganizer: true, eventId: true },
      });
      if (!attendee) throw errors.notFound('Attendee');
      if (attendee.isOrganizer) {
        throw errors.conflict('cannot_remove_organizer', 'The organizer cannot be removed');
      }
      const updated = await app.prisma.$transaction(async (tx) => {
        await tx.eventAttendee.delete({ where: { id: attendee.id } });
        await recordAudit(tx, {
          action: 'event_attendee.removed',
          organizationId,
          ...auditContext(request),
          entityType: 'calendar_event',
          entityId: attendee.eventId,
          metadata: { userId: request.params.userId },
        });
        return tx.calendarEvent.findUniqueOrThrow({
          where: { id: attendee.eventId },
          include: eventInclude,
        });
      });
      return reply.send(toEventDto(updated));
    },
  });

  // --- RSVP (attendee responds for themselves) --------------------------------
  r.route({
    method: 'POST',
    url: '/v1/events/:eventId/rsvp',
    preHandler: [requirePermission('calendar.read')],
    schema: {
      tags: ['events'],
      params: eventIdParamsSchema,
      body: rsvpBodySchema,
      response: { 200: eventDtoSchema },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const userId = request.currentUser?.id;
      if (!userId) throw errors.unauthorized();
      const attendee = await app.prisma.eventAttendee.findFirst({
        where: { eventId: request.params.eventId, userId, organizationId },
        select: { id: true, eventId: true },
      });
      if (!attendee) throw errors.forbidden('You are not an attendee of this event');
      const updated = await app.prisma.$transaction(async (tx) => {
        await tx.eventAttendee.update({
          where: { id: attendee.id },
          data: { response: request.body.response },
        });
        await recordAudit(tx, {
          action: 'event_attendee.responded',
          organizationId,
          ...auditContext(request),
          entityType: 'calendar_event',
          entityId: attendee.eventId,
          metadata: { response: request.body.response },
        });
        return tx.calendarEvent.findUniqueOrThrow({
          where: { id: attendee.eventId },
          include: eventInclude,
        });
      });
      return reply.send(toEventDto(updated));
    },
  });
}
