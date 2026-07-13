import {
  createEmployeeNoteBodySchema,
  employeeIdParamsSchema,
  employeeNoteDtoSchema,
  employeeNoteIdParamsSchema,
} from '@businessos/types';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { errors } from '../../lib/errors.js';
import { toEmployeeNoteDto } from '../../lib/mappers-personnel.js';
import { orgContext, requirePermission } from '../../plugins/auth.js';
import { auditContext, recordAudit } from '../audit/service.js';

async function assertEmployee(
  app: FastifyInstance,
  organizationId: string,
  employeeId: string,
): Promise<void> {
  const employee = await app.prisma.employee.findFirst({
    where: { id: employeeId, organizationId },
    select: { id: true },
  });
  if (!employee) throw errors.notFound('Employee');
}

/**
 * Internal notes are the most sensitive personnel data — both reading and
 * writing require personnel.read_sensitive (stricter than directory access).
 */
export function registerEmployeeNoteRoutes(app: FastifyInstance): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.route({
    method: 'GET',
    url: '/v1/employees/:employeeId/notes',
    preHandler: [requirePermission('personnel.read_sensitive')],
    schema: {
      tags: ['employee-notes'],
      params: employeeIdParamsSchema,
      response: { 200: z.array(employeeNoteDtoSchema) },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      await assertEmployee(app, organizationId, request.params.employeeId);
      const notes = await app.prisma.employeeNote.findMany({
        where: { organizationId, employeeId: request.params.employeeId },
        include: { author: true },
        orderBy: { createdAt: 'desc' },
      });
      return reply.send(notes.map(toEmployeeNoteDto));
    },
  });

  r.route({
    method: 'POST',
    url: '/v1/employees/:employeeId/notes',
    preHandler: [requirePermission('personnel.read_sensitive')],
    schema: {
      tags: ['employee-notes'],
      params: employeeIdParamsSchema,
      body: createEmployeeNoteBodySchema,
      response: { 201: employeeNoteDtoSchema },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      await assertEmployee(app, organizationId, request.params.employeeId);
      const note = await app.prisma.$transaction(async (tx) => {
        const created = await tx.employeeNote.create({
          data: {
            organizationId,
            employeeId: request.params.employeeId,
            authorId: request.currentUser?.id ?? null,
            body: request.body.body,
          },
          include: { author: true },
        });
        await recordAudit(tx, {
          action: 'employee_note.created',
          organizationId,
          ...auditContext(request),
          entityType: 'employee_note',
          entityId: created.id,
          metadata: { employeeId: request.params.employeeId },
        });
        // Deliberately NOT recorded as a timeline Activity: notes are
        // read_sensitive-only, so even their existence must not surface to
        // personnel.read viewers via the employee timeline / activity feed.
        return created;
      });
      return reply.code(201).send(toEmployeeNoteDto(note));
    },
  });

  r.route({
    method: 'DELETE',
    url: '/v1/employees/:employeeId/notes/:noteId',
    preHandler: [requirePermission('personnel.read_sensitive')],
    schema: { tags: ['employee-notes'], params: employeeNoteIdParamsSchema },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const note = await app.prisma.employeeNote.findFirst({
        where: {
          id: request.params.noteId,
          organizationId,
          employeeId: request.params.employeeId,
        },
      });
      if (!note) throw errors.notFound('Note');
      await app.prisma.$transaction(async (tx) => {
        await tx.employeeNote.delete({ where: { id: note.id } });
        await recordAudit(tx, {
          action: 'employee_note.deleted',
          organizationId,
          ...auditContext(request),
          entityType: 'employee_note',
          entityId: note.id,
        });
      });
      return reply.code(204).send();
    },
  });
}
