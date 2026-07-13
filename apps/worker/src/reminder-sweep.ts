import { expandOccurrences, type RecurrenceSpec } from '@businessos/types';
import { Prisma, type PrismaClient } from '@businessos/db';
import type { Logger } from 'pino';

// Look far enough ahead to cover the largest reminder lead time (4 weeks) with
// headroom, while bounding recurrence expansion per event.
const LOOKAHEAD_MS = 30 * 24 * 60 * 60 * 1000;
/** Max events processed per sweep (a warning fires if this is hit). */
const EVENT_BATCH = 500;
/** A reminder whose occurrence started more than this long ago is skipped
 *  (avoids blasting stale reminders after downtime), while still allowing
 *  minutesBefore=0 "at start" reminders to fire when they become due. */
const MISS_GRACE_MS = 5 * 60 * 1000;

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
        take: EVENT_BATCH,
      });
      if (events.length === EVENT_BATCH) {
        logger.warn({ batch: EVENT_BATCH }, 'reminder sweep hit its event batch cap');
      }

      const nowMs = now.getTime();
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

        // Build the concrete occurrences to consider. The SentReminder claim is
        // keyed on the ORIGINAL occurrenceStart so it survives time-moving
        // overrides; the fire time uses the EFFECTIVE (possibly overridden) start.
        const targets: Array<{ occurrenceStart: Date; effectiveStart: Date }> = [];
        const seen = new Set<string>();
        for (const occ of occs) {
          const key = occ.start.toISOString();
          seen.add(key);
          const ex = exByStart.get(key);
          if (ex?.type === 'CANCELLED') continue;
          if (ex?.type === 'OVERRIDE' && ex.status === 'CANCELLED') continue; // cancelled via override
          const effectiveStart = ex?.type === 'OVERRIDE' && ex.startsAt ? ex.startsAt : occ.start;
          targets.push({ occurrenceStart: occ.start, effectiveStart });
        }
        // Overrides that moved an occurrence into the window from outside the
        // rule-expanded range (mirrors the read-path materialize logic).
        for (const ex of event.exceptions) {
          if (ex.type !== 'OVERRIDE' || !ex.startsAt || ex.status === 'CANCELLED') continue;
          if (seen.has(ex.occurrenceStart.toISOString())) continue;
          const t = ex.startsAt.getTime();
          if (t < nowMs || t > horizon.getTime()) continue;
          targets.push({ occurrenceStart: ex.occurrenceStart, effectiveStart: ex.startsAt });
        }

        for (const target of targets) {
          for (const reminder of event.reminders) {
            const fireAt = target.effectiveStart.getTime() - reminder.minutesBefore * 60_000;
            if (fireAt > nowMs) continue; // not time yet
            // Deliver 'at start' (minutesBefore=0) reminders too, but never blast
            // reminders whose occurrence already fully passed (e.g. after downtime).
            if (target.effectiveStart.getTime() < nowMs - MISS_GRACE_MS) continue;

            try {
              await prisma.$transaction(async (tx) => {
                // Claim first — the unique constraint makes this the idempotency gate.
                await tx.sentReminder.create({
                  data: {
                    organizationId: event.organizationId,
                    eventId: event.id,
                    reminderId: reminder.id,
                    occurrenceStart: target.occurrenceStart,
                  },
                });
                for (const att of event.attendees) {
                  await tx.outboxMessage.create({
                    data: {
                      type: 'email.send',
                      payload: {
                        to: att.user.email,
                        subject: `Reminder: ${event.title}`,
                        text: `Reminder for "${event.title}".\nStarts: ${target.effectiveStart.toISOString()}${
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
