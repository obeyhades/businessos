import type { Calendar, CalendarEvent, EventAttendee, EventReminder, Prisma } from '@businessos/db';
import type { AttendeeDto, CalendarDto, EventDto, ReminderDto } from '@businessos/types';

export function toCalendarDto(c: Calendar): CalendarDto {
  return {
    id: c.id,
    name: c.name,
    color: c.color,
    type: c.type,
    ownerId: c.ownerId,
    isDefault: c.isDefault,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

type AttendeeWithUser = EventAttendee & { user: { id: string; name: string; email: string } };

export function toAttendeeDto(a: AttendeeWithUser): AttendeeDto {
  return {
    id: a.id,
    userId: a.userId,
    name: a.user.name,
    email: a.user.email,
    response: a.response,
    isOrganizer: a.isOrganizer,
  };
}

export function toReminderDto(r: EventReminder): ReminderDto {
  return { id: r.id, minutesBefore: r.minutesBefore, method: 'EMAIL' };
}

export type EventWithRelations = CalendarEvent & {
  attendees: AttendeeWithUser[];
  reminders: EventReminder[];
};

export function toEventDto(e: EventWithRelations): EventDto {
  return {
    id: e.id,
    calendarId: e.calendarId,
    title: e.title,
    description: e.description,
    location: e.location,
    startsAt: e.startsAt.toISOString(),
    endsAt: e.endsAt.toISOString(),
    allDay: e.allDay,
    timezone: e.timezone,
    status: e.status,
    visibility: e.visibility,
    organizerId: e.organizerId,
    customerId: e.customerId,
    projectId: e.projectId,
    taskId: e.taskId,
    recurrence: e.recurrenceFreq
      ? {
          freq: e.recurrenceFreq,
          interval: e.recurrenceInterval,
          byWeekday: e.recurrenceByWeekday,
          count: e.recurrenceCount,
          until: e.recurrenceUntil?.toISOString() ?? null,
        }
      : null,
    reminders: e.reminders.map(toReminderDto),
    attendees: e.attendees.map(toAttendeeDto),
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
  };
}

export const eventInclude = {
  attendees: {
    include: { user: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: 'asc' },
  },
  reminders: { orderBy: { minutesBefore: 'asc' } },
} satisfies Prisma.CalendarEventInclude;
