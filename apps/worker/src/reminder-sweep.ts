import { expandOccurrences, type RecurrenceSpec } from '@businessos/types';
import { Prisma, type PrismaClient } from '@businessos/db';
import type { Logger } from 'pino';

// Look far enough ahead to cover the largest reminder lead time (4 weeks) with
// headroom, while bounding recurrence expansion per event.
const LOOKAHEAD_MS = 30 * 24 * 60 * 60 * 1000;

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

/**
 * Periodically finds event reminders whose fire time has arrived for an
 * upcoming occurrence and enqueues an email to each (non-declined) attendee.
 * Idempotency is enforced by the sent_reminders unique (reminderId,
 * occurrenceStart): the claim row and the outbox emails are written in one
 * transaction, so a duplicate claim rolls the whole thing back — no double
 * notification, even across restarts or overlapping sweeps.
 */
export function startReminderSweep(
  prisma: PrismaClient,
  intervalSeconds: number,
  logger: Logger,
): { stop: () => void } {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;

  async function sweep(): Promise<void> {
    try {
      const now = new Date();
      const horizon = new Date(now.getTime() + LOOKAHEAD_MS);
      const events = await prisma.calendarEvent.findMany({
        where: {
          status: { not: 'CANCELLED' },
          startsAt: { lte: horizon },
          reminders: { some: {} },
          OR: [
            { recurrenceFreq: null, endsAt: { gte: now } },
            { recurrenceFreq: { not: null }, recurrenceUntil: null },
            { recurrenceFreq: { not: null }, recurrenceUntil: { gte: now } },
          ],
        },
        include: {
          reminders: true,
          exceptions: true,
          attendees: {
            where: { response: { not: 'DECLINED' } },
            include: { user: { select: { email: true } } },
          },
        },
        take: 500,
      });

      let enqueued = 0;
      for (const event of events) {
        if (event.attendees.length === 0 || event.reminders.length === 0) continue;
        const spec: RecurrenceSpec = {
          startsAt: event.startsAt,
          freq: event.recurrenceFreq,
          interval: event.recurrenceInterval,
          byWeekday: event.recurrenceByWeekday,
          count: event.recurrenceCount,
          until: event.recurrenceUntil,
        };
        const durationMs = Math.max(0, event.endsAt.getTime() - event.startsAt.getTime());
        const occs = expandOccurrences(spec, durationMs, now, horizon);
        const exByStart = new Map(
          event.exceptions.map((e) => [e.occurrenceStart.toISOString(), e]),
        );

        for (const occ of occs) {
          const ex = exByStart.get(occ.start.toISOString());
          if (ex?.type === 'CANCELLED') continue;
          const effectiveStart = ex?.type === 'OVERRIDE' && ex.startsAt ? ex.startsAt : occ.start;
          if (effectiveStart.getTime() <= now.getTime()) continue; // already started

          for (const reminder of event.reminders) {
            const fireAt = effectiveStart.getTime() - reminder.minutesBefore * 60_000;
            if (fireAt > now.getTime()) continue; // not time yet

            try {
              await prisma.$transaction(async (tx) => {
                // Claim first — the unique constraint makes this the idempotency gate.
                await tx.sentReminder.create({
                  data: {
                    organizationId: event.organizationId,
                    eventId: event.id,
                    reminderId: reminder.id,
                    occurrenceStart: occ.start,
                  },
                });
                for (const att of event.attendees) {
                  await tx.outboxMessage.create({
                    data: {
                      type: 'email.send',
                      payload: {
                        to: att.user.email,
                        subject: `Reminder: ${event.title}`,
                        text: `Reminder for "${event.title}".\nStarts: ${effectiveStart.toISOString()}${
                          event.location ? `\nLocation: ${event.location}` : ''
                        }`,
                        kind: 'event_reminder',
                        organizationId: event.organizationId,
                      } as Prisma.InputJsonValue,
                    },
                  });
                }
              });
              enqueued += 1;
            } catch (err) {
              if (!isUniqueViolation(err)) throw err; // already sent → skip
            }
          }
        }
      }
      if (enqueued > 0) logger.info({ count: enqueued }, 'reminder sweep enqueued reminders');
    } catch (error) {
      logger.error({ err: error }, 'reminder sweep failed');
    } finally {
      if (!stopped) timer = setTimeout(() => void sweep(), intervalSeconds * 1000);
    }
  }

  timer = setTimeout(() => void sweep(), 7_000);
  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
