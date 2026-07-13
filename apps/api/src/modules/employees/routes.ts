import {
  activityDtoSchema,
  applyTemplateBodySchema,
  applyTemplateResultSchema,
  createEmployeeBodySchema,
  employeeDtoSchema,
  employeeIdParamsSchema,
  employeeListQuerySchema,
  hasPermission,
  paginatedSchema,
  paginationQuerySchema,
  SENSITIVE_EMPLOYEE_FIELDS,
  updateEmployeeBodySchema,
  type CreateEmployeeBody,
  type OrganizationRole,
  type UpdateEmployeeBody,
} from '@businessos/types';
import type { Prisma } from '@businessos/db';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { errors } from '../../lib/errors.js';
import { toActivityDto } from '../../lib/mappers-domain.js';
import { toEmployeeDto } from '../../lib/mappers-personnel.js';
import { toPaginated, toSkipTake } from '../../lib/pagination.js';
import { orgContext, requirePermission } from '../../plugins/auth.js';
import { auditContext, recordAudit } from '../audit/service.js';
import { recordActivity } from '../activity/service.js';

const employeeInclude = {
  manager: { select: { id: true, firstName: true, lastName: true } },
  user: { select: { id: true, name: true, email: true } },
} as const;

function canReadSensitive(request: FastifyRequest): boolean {
  const role = request.membership?.role;
  return role ? hasPermission(role as OrganizationRole, 'personnel.read_sensitive') : false;
}

/** '' → null for optional text fields. */
function emptyToNull(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return value.length === 0 ? null : value;
}

/** Rejects sensitive-field writes from callers without personnel.read_sensitive. */
function assertSensitiveWriteAllowed(
  request: FastifyRequest,
  body: CreateEmployeeBody | UpdateEmployeeBody,
): void {
  const touchesSensitive = SENSITIVE_EMPLOYEE_FIELDS.some((field) => field in body);
  if (touchesSensitive && !canReadSensitive(request)) {
    throw errors.forbidden('You do not have permission to modify sensitive personal data');
  }
}

async function validateManagerAndUser(
  app: FastifyInstance,
  organizationId: string,
  refs: { managerId?: string | null; userId?: string | null },
  selfId?: string,
): Promise<void> {
  if (refs.managerId) {
    if (refs.managerId === selfId) {
      throw errors.badRequest('invalid_manager', 'An employee cannot be their own manager');
    }
    const manager = await app.prisma.employee.findFirst({
      where: { id: refs.managerId, organizationId },
      select: { id: true },
    });
    if (!manager)
      throw errors.badRequest('invalid_manager', 'Manager not found in this organization');
  }
  if (refs.userId) {
    const member = await app.prisma.organizationMember.findFirst({
      where: { organizationId, userId: refs.userId },
      select: { id: true },
    });
    if (!member)
      throw errors.badRequest('invalid_user', 'User is not a member of this organization');
    const taken = await app.prisma.employee.findFirst({
      where: { organizationId, userId: refs.userId, ...(selfId ? { id: { not: selfId } } : {}) },
      select: { id: true },
    });
    if (taken)
      throw errors.conflict('user_already_linked', 'This user is already linked to an employee');
  }
}

function toDbDate(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined;
  return value ? new Date(value) : null;
}

export function registerEmployeeRoutes(app: FastifyInstance): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.route({
    method: 'GET',
    url: '/v1/employees',
    preHandler: [requirePermission('personnel.read')],
    schema: {
      tags: ['employees'],
      querystring: employeeListQuerySchema,
      response: { 200: paginatedSchema(employeeDtoSchema) },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const query = request.query;
      const { skip, take } = toSkipTake(query);
      const where: Prisma.EmployeeWhereInput = {
        organizationId,
        ...(query.status ? { employmentStatus: query.status } : {}),
        ...(query.department
          ? { department: { equals: query.department, mode: 'insensitive' } }
          : {}),
        ...(query.managerId ? { managerId: query.managerId } : {}),
        ...(query.search
          ? {
              OR: [
                { firstName: { contains: query.search, mode: 'insensitive' } },
                { lastName: { contains: query.search, mode: 'insensitive' } },
                { workEmail: { contains: query.search, mode: 'insensitive' } },
                { jobTitle: { contains: query.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      };
      const [rows, total] = await Promise.all([
        app.prisma.employee.findMany({
          where,
          include: employeeInclude,
          orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
          skip,
          take,
        }),
        app.prisma.employee.count({ where }),
      ]);
      // Directory listing never includes sensitive data, regardless of role.
      return reply.send(
        toPaginated(
          rows.map((row) => toEmployeeDto(row, { includeSensitive: false })),
          total,
          query,
        ),
      );
    },
  });

  r.route({
    method: 'POST',
    url: '/v1/employees',
    preHandler: [requirePermission('personnel.manage')],
    schema: {
      tags: ['employees'],
      body: createEmployeeBodySchema,
      response: { 201: employeeDtoSchema },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const body = request.body;
      assertSensitiveWriteAllowed(request, body);
      await validateManagerAndUser(app, organizationId, body);

      const employee = await app.prisma.$transaction(async (tx) => {
        const created = await tx.employee.create({
          data: {
            organizationId,
            firstName: body.firstName,
            lastName: body.lastName,
            workEmail: emptyToNull(body.workEmail) ?? null,
            workPhone: emptyToNull(body.workPhone) ?? null,
            jobTitle: emptyToNull(body.jobTitle) ?? null,
            department: emptyToNull(body.department) ?? null,
            employmentStatus: body.employmentStatus,
            employmentType: body.employmentType,
            startDate: toDbDate(body.startDate) ?? null,
            endDate: toDbDate(body.endDate) ?? null,
            managerId: body.managerId ?? null,
            userId: body.userId ?? null,
            personalIdNumber: emptyToNull(body.personalIdNumber) ?? null,
            dateOfBirth: toDbDate(body.dateOfBirth) ?? null,
            homeAddress: emptyToNull(body.homeAddress) ?? null,
            homePostalCode: emptyToNull(body.homePostalCode) ?? null,
            homeCity: emptyToNull(body.homeCity) ?? null,
            personalEmail: emptyToNull(body.personalEmail) ?? null,
            personalPhone: emptyToNull(body.personalPhone) ?? null,
            emergencyContactName: emptyToNull(body.emergencyContactName) ?? null,
            emergencyContactPhone: emptyToNull(body.emergencyContactPhone) ?? null,
            emergencyContactRelation: emptyToNull(body.emergencyContactRelation) ?? null,
            createdById: request.currentUser?.id ?? null,
          },
          include: employeeInclude,
        });
        await recordAudit(tx, {
          action: 'employee.created',
          organizationId,
          ...auditContext(request),
          entityType: 'employee',
          entityId: created.id,
          metadata: { name: `${created.firstName} ${created.lastName}` },
        });
        await recordActivity(tx, {
          organizationId,
          actorUserId: request.currentUser?.id ?? null,
          type: 'employee.created',
          ref: { employeeId: created.id },
          metadata: { name: `${created.firstName} ${created.lastName}` },
        });
        return created;
      });
      // The creator sees back whatever their role permits.
      return reply
        .code(201)
        .send(toEmployeeDto(employee, { includeSensitive: canReadSensitive(request) }));
    },
  });

  r.route({
    method: 'GET',
    url: '/v1/employees/:employeeId',
    preHandler: [requirePermission('personnel.read')],
    schema: {
      tags: ['employees'],
      params: employeeIdParamsSchema,
      response: { 200: employeeDtoSchema },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const employee = await app.prisma.employee.findFirst({
        where: { id: request.params.employeeId, organizationId },
        include: employeeInclude,
      });
      if (!employee) throw errors.notFound('Employee');

      const includeSensitive = canReadSensitive(request);
      if (includeSensitive) {
        // Access logging: record who viewed an employee's sensitive record.
        await recordAudit(app.prisma, {
          action: 'employee.sensitive_viewed',
          organizationId,
          ...auditContext(request),
          entityType: 'employee',
          entityId: employee.id,
        });
      }
      return reply.send(toEmployeeDto(employee, { includeSensitive }));
    },
  });

  r.route({
    method: 'PATCH',
    url: '/v1/employees/:employeeId',
    preHandler: [requirePermission('personnel.manage')],
    schema: {
      tags: ['employees'],
      params: employeeIdParamsSchema,
      body: updateEmployeeBodySchema,
      response: { 200: employeeDtoSchema },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const body = request.body;
      assertSensitiveWriteAllowed(request, body);
      const existing = await app.prisma.employee.findFirst({
        where: { id: request.params.employeeId, organizationId },
      });
      if (!existing) throw errors.notFound('Employee');
      await validateManagerAndUser(app, organizationId, body, existing.id);

      const statusChanged =
        body.employmentStatus !== undefined && body.employmentStatus !== existing.employmentStatus;

      const data: Prisma.EmployeeUpdateInput = {};
      const setText = (key: keyof UpdateEmployeeBody, target: keyof Prisma.EmployeeUpdateInput) => {
        if (body[key] !== undefined) {
          (data as Record<string, unknown>)[target] = emptyToNull(body[key] as string | null);
        }
      };
      if (body.firstName !== undefined) data.firstName = body.firstName;
      if (body.lastName !== undefined) data.lastName = body.lastName;
      setText('workEmail', 'workEmail');
      setText('workPhone', 'workPhone');
      setText('jobTitle', 'jobTitle');
      setText('department', 'department');
      if (body.employmentStatus !== undefined) data.employmentStatus = body.employmentStatus;
      if (body.employmentType !== undefined) data.employmentType = body.employmentType;
      if (body.startDate !== undefined) data.startDate = toDbDate(body.startDate);
      if (body.endDate !== undefined) data.endDate = toDbDate(body.endDate);
      if (body.managerId !== undefined)
        data.manager = body.managerId ? { connect: { id: body.managerId } } : { disconnect: true };
      if (body.userId !== undefined)
        data.user = body.userId ? { connect: { id: body.userId } } : { disconnect: true };
      setText('personalIdNumber', 'personalIdNumber');
      if (body.dateOfBirth !== undefined) data.dateOfBirth = toDbDate(body.dateOfBirth);
      setText('homeAddress', 'homeAddress');
      setText('homePostalCode', 'homePostalCode');
      setText('homeCity', 'homeCity');
      setText('personalEmail', 'personalEmail');
      setText('personalPhone', 'personalPhone');
      setText('emergencyContactName', 'emergencyContactName');
      setText('emergencyContactPhone', 'emergencyContactPhone');
      setText('emergencyContactRelation', 'emergencyContactRelation');

      const updated = await app.prisma.$transaction(async (tx) => {
        const result = await tx.employee.update({
          where: { id: existing.id },
          data,
          include: employeeInclude,
        });
        await recordAudit(tx, {
          action: statusChanged ? 'employee.status_changed' : 'employee.updated',
          organizationId,
          ...auditContext(request),
          entityType: 'employee',
          entityId: existing.id,
          metadata: { fields: Object.keys(body) },
        });
        if (statusChanged) {
          await recordActivity(tx, {
            organizationId,
            actorUserId: request.currentUser?.id ?? null,
            type: 'employee.status_changed',
            ref: { employeeId: existing.id },
            metadata: { from: existing.employmentStatus, to: body.employmentStatus },
          });
        }
        return result;
      });
      return reply.send(toEmployeeDto(updated, { includeSensitive: canReadSensitive(request) }));
    },
  });

  r.route({
    method: 'DELETE',
    url: '/v1/employees/:employeeId',
    preHandler: [requirePermission('personnel.manage')],
    schema: { tags: ['employees'], params: employeeIdParamsSchema },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const existing = await app.prisma.employee.findFirst({
        where: { id: request.params.employeeId, organizationId },
      });
      if (!existing) throw errors.notFound('Employee');
      await app.prisma.$transaction(async (tx) => {
        await tx.employee.delete({ where: { id: existing.id } });
        await recordAudit(tx, {
          action: 'employee.deleted',
          organizationId,
          ...auditContext(request),
          entityType: 'employee',
          entityId: existing.id,
          metadata: { name: `${existing.firstName} ${existing.lastName}` },
        });
      });
      return reply.code(204).send();
    },
  });

  // Onboarding automation: turn a checklist template into real, dated tasks.
  r.route({
    method: 'POST',
    url: '/v1/employees/:employeeId/apply-template',
    preHandler: [requirePermission('personnel.manage')],
    schema: {
      tags: ['employees'],
      params: employeeIdParamsSchema,
      body: applyTemplateBodySchema,
      response: { 201: applyTemplateResultSchema },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const employee = await app.prisma.employee.findFirst({
        where: { id: request.params.employeeId, organizationId },
        include: { manager: { select: { userId: true } } },
      });
      if (!employee) throw errors.notFound('Employee');

      const template = await app.prisma.onboardingTemplate.findFirst({
        where: { id: request.body.templateId, organizationId },
        include: { items: { orderBy: { sortOrder: 'asc' } } },
      });
      if (!template)
        throw errors.badRequest('invalid_template', 'Template not found in this organization');

      // Assignee precedence: explicit → employee's manager's user → the actor.
      let assigneeId =
        request.body.assigneeId ?? employee.manager?.userId ?? request.currentUser?.id ?? null;
      if (assigneeId) {
        const member = await app.prisma.organizationMember.findFirst({
          where: { organizationId, userId: assigneeId },
          select: { id: true },
        });
        if (!member) assigneeId = null;
      }
      const baseDate = employee.startDate ?? new Date();

      const createdTaskCount = await app.prisma.$transaction(async (tx) => {
        for (const item of template.items) {
          const dueDate = new Date(baseDate);
          dueDate.setUTCDate(dueDate.getUTCDate() + item.dueOffsetDays);
          await tx.task.create({
            data: {
              organizationId,
              title: item.title,
              description: item.description,
              status: 'TODO',
              priority: 'MEDIUM',
              dueDate,
              employeeId: employee.id,
              assigneeId,
              createdById: request.currentUser?.id ?? null,
            },
          });
        }
        await recordAudit(tx, {
          action: 'onboarding_template.applied',
          organizationId,
          ...auditContext(request),
          entityType: 'employee',
          entityId: employee.id,
          metadata: { templateId: template.id, taskCount: template.items.length },
        });
        await recordActivity(tx, {
          organizationId,
          actorUserId: request.currentUser?.id ?? null,
          type: 'employee.onboarding_started',
          ref: { employeeId: employee.id },
          metadata: { template: template.name, taskCount: template.items.length },
        });
        return template.items.length;
      });

      return reply.code(201).send({ createdTaskCount });
    },
  });

  r.route({
    method: 'GET',
    url: '/v1/employees/:employeeId/activity',
    preHandler: [requirePermission('personnel.read')],
    schema: {
      tags: ['employees'],
      params: employeeIdParamsSchema,
      querystring: paginationQuerySchema,
      response: { 200: paginatedSchema(activityDtoSchema) },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const employee = await app.prisma.employee.findFirst({
        where: { id: request.params.employeeId, organizationId },
        select: { id: true },
      });
      if (!employee) throw errors.notFound('Employee');
      const { skip, take } = toSkipTake(request.query);
      const where = { organizationId, employeeId: employee.id };
      const [rows, total] = await Promise.all([
        app.prisma.activity.findMany({
          where,
          include: { actor: true },
          orderBy: { createdAt: 'desc' },
          skip,
          take,
        }),
        app.prisma.activity.count({ where }),
      ]);
      return reply.send(toPaginated(rows.map(toActivityDto), total, request.query));
    },
  });
}
