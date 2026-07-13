import { z } from 'zod';
import { timestampSchema, uuidSchema } from './common.js';

/** ISO 8601 timestamp with time+offset, e.g. "2026-07-13T09:00:00.000Z". */
export const isoDateTimeSchema = z.string().datetime({ offset: true });

// ---------------------------------------------------------------------------
// Calendars
// ---------------------------------------------------------------------------

export const calendarTypeSchema = z.enum(['TEAM', 'PERSONAL']);
export type CalendarType = z.infer<typeof calendarTypeSchema>;

const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Must be a hex color like #3b82f6');

export const calendarDtoSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  color: z.string(),
  type: calendarTypeSchema,
  ownerId: uuidSchema.nullable(),
  isDefault: z.boolean(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type CalendarDto = z.infer<typeof calendarDtoSchema>;

export const createCalendarBodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  color: colorSchema.default('#3b82f6'),
  // PERSONAL calendars are owned by the creating user; TEAM calendars are shared.
  type: calendarTypeSchema.default('TEAM'),
});
export type CreateCalendarBody = z.infer<typeof createCalendarBodySchema>;

export const updateCalendarBodySchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    color: colorSchema.optional(),
    isDefault: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });
export type UpdateCalendarBody = z.infer<typeof updateCalendarBodySchema>;

export const calendarIdParamsSchema = z.object({ calendarId: uuidSchema });
export type CalendarIdParams = z.infer<typeof calendarIdParamsSchema>;

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export const eventStatusSchema = z.enum(['CONFIRMED', 'TENTATIVE', 'CANCELLED']);
export type EventStatus = z.infer<typeof eventStatusSchema>;

export const eventVisibilitySchema = z.enum(['DEFAULT', 'PRIVATE']);
export type EventVisibility = z.infer<typeof eventVisibilitySchema>;

export const recurrenceFreqSchema = z.enum(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY']);
export type RecurrenceFreq = z.infer<typeof recurrenceFreqSchema>;

export const attendeeResponseSchema = z.enum(['NEEDS_ACTION', 'ACCEPTED', 'DECLINED', 'TENTATIVE']);
export type AttendeeResponse = z.infer<typeof attendeeResponseSchema>;

export const recurrenceInputSchema = z
  .object({
    freq: recurrenceFreqSchema,
    interval: z.number().int().min(1).max(365).default(1),
    /** UTC weekdays 0=Sun..6=Sat (WEEKLY only). */
    byWeekday: z.array(z.number().int().min(0).max(6)).max(7).default([]),
    count: z.number().int().min(1).max(1000).nullable().optional(),
    until: isoDateTimeSchema.nullable().optional(),
  })
  .refine((v) => !(v.count != null && v.until != null), {
    message: 'Provide count or until, not both',
  });
export type RecurrenceInput = z.infer<typeof recurrenceInputSchema>;

export const reminderInputSchema = z.object({
  minutesBefore: z.number().int().min(0).max(40320), // up to 4 weeks
  method: z.literal('EMAIL').default('EMAIL'),
});
export type ReminderInput = z.infer<typeof reminderInputSchema>;

export const reminderDtoSchema = z.object({
  id: uuidSchema,
  minutesBefore: z.number().int(),
  method: z.literal('EMAIL'),
});
export type ReminderDto = z.infer<typeof reminderDtoSchema>;

export const attendeeDtoSchema = z.object({
  id: uuidSchema,
  userId: uuidSchema,
  name: z.string(),
  email: z.string(),
  response: attendeeResponseSchema,
  isOrganizer: z.boolean(),
});
export type AttendeeDto = z.infer<typeof attendeeDtoSchema>;

const eventLinks = {
  customerId: uuidSchema.nullable().optional(),
  projectId: uuidSchema.nullable().optional(),
  taskId: uuidSchema.nullable().optional(),
};

export const createEventBodySchema = z
  .object({
    calendarId: uuidSchema,
    title: z.string().trim().min(1).max(300),
    description: z.string().trim().max(5000).optional(),
    location: z.string().trim().max(500).optional(),
    startsAt: isoDateTimeSchema,
    endsAt: isoDateTimeSchema,
    allDay: z.boolean().default(false),
    timezone: z.string().min(1).max(64).default('Europe/Stockholm'),
    status: eventStatusSchema.default('CONFIRMED'),
    visibility: eventVisibilitySchema.default('DEFAULT'),
    ...eventLinks,
    recurrence: recurrenceInputSchema.nullable().optional(),
    reminders: z.array(reminderInputSchema).max(5).default([]),
    attendeeUserIds: z.array(uuidSchema).max(200).default([]),
  })
  .refine((v) => new Date(v.endsAt).getTime() >= new Date(v.startsAt).getTime(), {
    message: 'endsAt must be on or after startsAt',
    path: ['endsAt'],
  });
export type CreateEventBody = z.infer<typeof createEventBodySchema>;

export const updateEventBodySchema = z
  .object({
    calendarId: uuidSchema.optional(),
    title: z.string().trim().min(1).max(300).optional(),
    description: z.string().trim().max(5000).nullable().optional(),
    location: z.string().trim().max(500).nullable().optional(),
    startsAt: isoDateTimeSchema.optional(),
    endsAt: isoDateTimeSchema.optional(),
    allDay: z.boolean().optional(),
    timezone: z.string().min(1).max(64).optional(),
    status: eventStatusSchema.optional(),
    visibility: eventVisibilitySchema.optional(),
    ...eventLinks,
    // null clears recurrence (series becomes a single event).
    recurrence: recurrenceInputSchema.nullable().optional(),
    reminders: z.array(reminderInputSchema).max(5).optional(),
    attendeeUserIds: z.array(uuidSchema).max(200).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' })
  .refine(
    (v) =>
      v.startsAt === undefined ||
      v.endsAt === undefined ||
      new Date(v.endsAt).getTime() >= new Date(v.startsAt).getTime(),
    { message: 'endsAt must be on or after startsAt', path: ['endsAt'] },
  );
export type UpdateEventBody = z.infer<typeof updateEventBodySchema>;

const recurrenceDtoSchema = z.object({
  freq: recurrenceFreqSchema,
  interval: z.number().int(),
  byWeekday: z.array(z.number().int()),
  count: z.number().int().nullable(),
  until: timestampSchema.nullable(),
});

/** The stored master event (series definition). */
export const eventDtoSchema = z.object({
  id: uuidSchema,
  calendarId: uuidSchema,
  title: z.string(),
  description: z.string().nullable(),
  location: z.string().nullable(),
  startsAt: timestampSchema,
  endsAt: timestampSchema,
  allDay: z.boolean(),
  timezone: z.string(),
  status: eventStatusSchema,
  visibility: eventVisibilitySchema,
  organizerId: uuidSchema.nullable(),
  customerId: uuidSchema.nullable(),
  projectId: uuidSchema.nullable(),
  taskId: uuidSchema.nullable(),
  recurrence: recurrenceDtoSchema.nullable(),
  reminders: z.array(reminderDtoSchema),
  attendees: z.array(attendeeDtoSchema),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type EventDto = z.infer<typeof eventDtoSchema>;

/** A single materialized occurrence returned by the range/agenda queries. */
export const occurrenceDtoSchema = z.object({
  eventId: uuidSchema,
  calendarId: uuidSchema,
  /** Original rule-generated start (occurrence identity for overrides). */
  occurrenceStart: timestampSchema,
  start: timestampSchema,
  end: timestampSchema,
  title: z.string(),
  location: z.string().nullable(),
  allDay: z.boolean(),
  status: eventStatusSchema,
  visibility: eventVisibilitySchema,
  isRecurring: z.boolean(),
  isException: z.boolean(),
  organizerId: uuidSchema.nullable(),
  customerId: uuidSchema.nullable(),
  projectId: uuidSchema.nullable(),
  taskId: uuidSchema.nullable(),
});
export type OccurrenceDto = z.infer<typeof occurrenceDtoSchema>;

export const eventRangeQuerySchema = z.object({
  from: isoDateTimeSchema,
  to: isoDateTimeSchema,
  calendarId: uuidSchema.optional(),
  customerId: uuidSchema.optional(),
  /** Only occurrences the current user organizes or attends. */
  mine: z.enum(['true', 'false']).optional(),
});
export type EventRangeQuery = z.infer<typeof eventRangeQuerySchema>;

export const eventIdParamsSchema = z.object({ eventId: uuidSchema });
export type EventIdParams = z.infer<typeof eventIdParamsSchema>;

export const overrideOccurrenceBodySchema = z.object({
  occurrenceStart: isoDateTimeSchema,
  title: z.string().trim().min(1).max(300).optional(),
  description: z.string().trim().max(5000).nullable().optional(),
  location: z.string().trim().max(500).nullable().optional(),
  startsAt: isoDateTimeSchema.optional(),
  endsAt: isoDateTimeSchema.optional(),
  status: eventStatusSchema.optional(),
});
export type OverrideOccurrenceBody = z.infer<typeof overrideOccurrenceBodySchema>;

export const cancelOccurrenceBodySchema = z.object({ occurrenceStart: isoDateTimeSchema });
export type CancelOccurrenceBody = z.infer<typeof cancelOccurrenceBodySchema>;

export const rsvpBodySchema = z.object({ response: attendeeResponseSchema });
export type RsvpBody = z.infer<typeof rsvpBodySchema>;

export const addAttendeeBodySchema = z.object({ userId: uuidSchema });
export type AddAttendeeBody = z.infer<typeof addAttendeeBodySchema>;

export const attendeeIdParamsSchema = z.object({
  eventId: uuidSchema,
  userId: uuidSchema,
});
export type AttendeeIdParams = z.infer<typeof attendeeIdParamsSchema>;

// ---------------------------------------------------------------------------
// Agenda & free/busy
// ---------------------------------------------------------------------------

export const agendaQuerySchema = z.object({
  from: isoDateTimeSchema,
  to: isoDateTimeSchema,
});
export type AgendaQuery = z.infer<typeof agendaQuerySchema>;

export const agendaItemDtoSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('event'),
    id: uuidSchema,
    occurrenceStart: timestampSchema,
    start: timestampSchema,
    end: timestampSchema,
    title: z.string(),
    status: eventStatusSchema,
    customerId: uuidSchema.nullable(),
  }),
  z.object({
    kind: z.literal('task'),
    id: uuidSchema,
    start: timestampSchema,
    title: z.string(),
    status: z.string(),
    priority: z.string(),
    customerId: uuidSchema.nullable(),
  }),
]);
export type AgendaItemDto = z.infer<typeof agendaItemDtoSchema>;

export const freeBusyQuerySchema = z.object({
  userId: uuidSchema,
  from: isoDateTimeSchema,
  to: isoDateTimeSchema,
});
export type FreeBusyQuery = z.infer<typeof freeBusyQuerySchema>;

export const freeBusyDtoSchema = z.object({
  userId: uuidSchema,
  busy: z.array(z.object({ start: timestampSchema, end: timestampSchema })),
});
export type FreeBusyDto = z.infer<typeof freeBusyDtoSchema>;
