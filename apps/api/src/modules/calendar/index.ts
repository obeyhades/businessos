import type { FastifyInstance } from 'fastify';
import { registerCalendarRoutes } from './calendars.routes.js';
import { registerEventRoutes } from './events.routes.js';
import { registerAgendaRoutes } from './agenda.routes.js';

/**
 * Phase 6 — Calendar & tasks. Team + personal calendars; events with
 * attendees/RSVP, reminders, recurrence (expanded server-side), per-occurrence
 * exceptions, business-context links, PRIVATE-event scoping, a merged agenda,
 * and free/busy.
 */
export function registerCalendarModuleRoutes(app: FastifyInstance): void {
  registerCalendarRoutes(app);
  registerEventRoutes(app);
  registerAgendaRoutes(app);
}
