import {
  calendarDtoSchema,
  calendarIdParamsSchema,
  createCalendarBodySchema,
  updateCalendarBodySchema,
} from '@businessos/types';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { errors } from '../../lib/errors.js';
import { orgContext, requirePermission } from '../../plugins/auth.js';
import { auditContext, recordAudit } from '../audit/service.js';
import { toCalendarDto } from './mappers.js';

export function registerCalendarRoutes(app: FastifyInstance): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.route({
    method: 'GET',
    url: '/v1/calendars',
    preHandler: [requirePermission('calendar.read')],
    schema: { tags: ['calendars'], response: { 200: z.array(calendarDtoSchema) } },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const userId = request.currentUser?.id;
      // Team calendars are shared; personal calendars are visible only to owners.
      const calendars = await app.prisma.calendar.findMany({
        where: {
          organizationId,
          OR: [{ type: 'TEAM' }, { ownerId: userId ?? '' }],
        },
        orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      });
      return reply.send(calendars.map(toCalendarDto));
    },
  });

  r.route({
    method: 'POST',
    url: '/v1/calendars',
    preHandler: [requirePermission('calendar.manage')],
    schema: {
      tags: ['calendars'],
      body: createCalendarBodySchema,
      response: { 201: calendarDtoSchema },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const body = request.body;
      const calendar = await app.prisma.$transaction(async (tx) => {
        const created = await tx.calendar.create({
          data: {
            organizationId,
            name: body.name,
            color: body.color,
            type: body.type,
            ownerId: body.type === 'PERSONAL' ? (request.currentUser?.id ?? null) : null,
            createdById: request.currentUser?.id ?? null,
          },
        });
        await recordAudit(tx, {
          action: 'calendar.created',
          organizationId,
          ...auditContext(request),
          entityType: 'calendar',
          entityId: created.id,
          metadata: { name: created.name, type: created.type },
        });
        return created;
      });
      return reply.code(201).send(toCalendarDto(calendar));
    },
  });

  r.route({
    method: 'PATCH',
    url: '/v1/calendars/:calendarId',
    preHandler: [requirePermission('calendar.manage')],
    schema: {
      tags: ['calendars'],
      params: calendarIdParamsSchema,
      body: updateCalendarBodySchema,
      response: { 200: calendarDtoSchema },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const existing = await app.prisma.calendar.findFirst({
        where: { id: request.params.calendarId, organizationId },
      });
      if (!existing) throw errors.notFound('Calendar');
      const body = request.body;
      const calendar = await app.prisma.$transaction(async (tx) => {
        // At most one default calendar per org.
        if (body.isDefault === true) {
          await tx.calendar.updateMany({
            where: { organizationId, isDefault: true, NOT: { id: existing.id } },
            data: { isDefault: false },
          });
        }
        const updated = await tx.calendar.update({
          where: { id: existing.id },
          data: {
            ...(body.name !== undefined ? { name: body.name } : {}),
            ...(body.color !== undefined ? { color: body.color } : {}),
            ...(body.isDefault !== undefined ? { isDefault: body.isDefault } : {}),
          },
        });
        await recordAudit(tx, {
          action: 'calendar.updated',
          organizationId,
          ...auditContext(request),
          entityType: 'calendar',
          entityId: existing.id,
          metadata: { fields: Object.keys(body) },
        });
        return updated;
      });
      return reply.send(toCalendarDto(calendar));
    },
  });

  r.route({
    method: 'DELETE',
    url: '/v1/calendars/:calendarId',
    preHandler: [requirePermission('calendar.manage')],
    schema: { tags: ['calendars'], params: calendarIdParamsSchema },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const existing = await app.prisma.calendar.findFirst({
        where: { id: request.params.calendarId, organizationId },
      });
      if (!existing) throw errors.notFound('Calendar');
      if (existing.isDefault) {
        throw errors.conflict('calendar_is_default', 'The default calendar cannot be deleted');
      }
      const eventCount = await app.prisma.calendarEvent.count({
        where: { calendarId: existing.id, organizationId },
      });
      if (eventCount > 0) {
        throw errors.conflict(
          'calendar_in_use',
          'Move or delete its events before deleting this calendar',
        );
      }
      await app.prisma.$transaction(async (tx) => {
        await tx.calendar.delete({ where: { id: existing.id } });
        await recordAudit(tx, {
          action: 'calendar.deleted',
          organizationId,
          ...auditContext(request),
          entityType: 'calendar',
          entityId: existing.id,
          metadata: { name: existing.name },
        });
      });
      return reply.code(204).send();
    },
  });
}
