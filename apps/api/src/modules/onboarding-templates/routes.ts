import {
  createTemplateBodySchema,
  onboardingTemplateDtoSchema,
  templateIdParamsSchema,
  updateTemplateBodySchema,
} from '@businessos/types';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { errors } from '../../lib/errors.js';
import { toOnboardingTemplateDto } from '../../lib/mappers-personnel.js';
import { orgContext, requirePermission } from '../../plugins/auth.js';
import { auditContext, recordAudit } from '../audit/service.js';

const withItems = { items: { orderBy: { sortOrder: 'asc' as const } } };

export function registerOnboardingTemplateRoutes(app: FastifyInstance): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.route({
    method: 'GET',
    url: '/v1/onboarding-templates',
    preHandler: [requirePermission('personnel.read')],
    schema: {
      tags: ['onboarding-templates'],
      response: { 200: z.array(onboardingTemplateDtoSchema) },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const templates = await app.prisma.onboardingTemplate.findMany({
        where: { organizationId },
        include: withItems,
        orderBy: { name: 'asc' },
      });
      return reply.send(templates.map(toOnboardingTemplateDto));
    },
  });

  r.route({
    method: 'POST',
    url: '/v1/onboarding-templates',
    preHandler: [requirePermission('personnel.manage')],
    schema: {
      tags: ['onboarding-templates'],
      body: createTemplateBodySchema,
      response: { 201: onboardingTemplateDtoSchema },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const body = request.body;
      const template = await app.prisma.$transaction(async (tx) => {
        const created = await tx.onboardingTemplate.create({
          data: {
            organizationId,
            name: body.name,
            description: body.description ?? null,
            type: body.type,
            createdById: request.currentUser?.id ?? null,
            items: {
              create: body.items.map((item, index) => ({
                organizationId,
                title: item.title,
                description: item.description ?? null,
                dueOffsetDays: item.dueOffsetDays,
                sortOrder: index,
              })),
            },
          },
          include: withItems,
        });
        await recordAudit(tx, {
          action: 'onboarding_template.created',
          organizationId,
          ...auditContext(request),
          entityType: 'onboarding_template',
          entityId: created.id,
          metadata: { name: created.name, itemCount: body.items.length },
        });
        return created;
      });
      return reply.code(201).send(toOnboardingTemplateDto(template));
    },
  });

  r.route({
    method: 'GET',
    url: '/v1/onboarding-templates/:templateId',
    preHandler: [requirePermission('personnel.read')],
    schema: {
      tags: ['onboarding-templates'],
      params: templateIdParamsSchema,
      response: { 200: onboardingTemplateDtoSchema },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const template = await app.prisma.onboardingTemplate.findFirst({
        where: { id: request.params.templateId, organizationId },
        include: withItems,
      });
      if (!template) throw errors.notFound('Template');
      return reply.send(toOnboardingTemplateDto(template));
    },
  });

  r.route({
    method: 'PATCH',
    url: '/v1/onboarding-templates/:templateId',
    preHandler: [requirePermission('personnel.manage')],
    schema: {
      tags: ['onboarding-templates'],
      params: templateIdParamsSchema,
      body: updateTemplateBodySchema,
      response: { 200: onboardingTemplateDtoSchema },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const existing = await app.prisma.onboardingTemplate.findFirst({
        where: { id: request.params.templateId, organizationId },
      });
      if (!existing) throw errors.notFound('Template');
      const body = request.body;

      const updated = await app.prisma.$transaction(async (tx) => {
        // Replacing the item list wholesale keeps ordering deterministic.
        if (body.items !== undefined) {
          await tx.onboardingTemplateItem.deleteMany({ where: { templateId: existing.id } });
        }
        const result = await tx.onboardingTemplate.update({
          where: { id: existing.id },
          data: {
            ...(body.name !== undefined ? { name: body.name } : {}),
            ...(body.description !== undefined ? { description: body.description } : {}),
            ...(body.type !== undefined ? { type: body.type } : {}),
            ...(body.items !== undefined
              ? {
                  items: {
                    create: body.items.map((item, index) => ({
                      organizationId,
                      title: item.title,
                      description: item.description ?? null,
                      dueOffsetDays: item.dueOffsetDays,
                      sortOrder: index,
                    })),
                  },
                }
              : {}),
          },
          include: withItems,
        });
        await recordAudit(tx, {
          action: 'onboarding_template.updated',
          organizationId,
          ...auditContext(request),
          entityType: 'onboarding_template',
          entityId: existing.id,
          metadata: { fields: Object.keys(body) },
        });
        return result;
      });
      return reply.send(toOnboardingTemplateDto(updated));
    },
  });

  r.route({
    method: 'DELETE',
    url: '/v1/onboarding-templates/:templateId',
    preHandler: [requirePermission('personnel.manage')],
    schema: { tags: ['onboarding-templates'], params: templateIdParamsSchema },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const existing = await app.prisma.onboardingTemplate.findFirst({
        where: { id: request.params.templateId, organizationId },
      });
      if (!existing) throw errors.notFound('Template');
      await app.prisma.$transaction(async (tx) => {
        await tx.onboardingTemplate.delete({ where: { id: existing.id } });
        await recordAudit(tx, {
          action: 'onboarding_template.deleted',
          organizationId,
          ...auditContext(request),
          entityType: 'onboarding_template',
          entityId: existing.id,
        });
      });
      return reply.code(204).send();
    },
  });
}
