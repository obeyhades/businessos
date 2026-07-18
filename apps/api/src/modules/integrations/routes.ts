import { randomUUID } from 'node:crypto';
import {
  createWebhookEndpointBodySchema,
  paginatedSchema,
  updateWebhookEndpointBodySchema,
  webhookDeliveryDtoSchema,
  webhookDeliveryListQuerySchema,
  webhookEndpointDtoSchema,
  webhookEndpointIdParamsSchema,
  webhookEndpointWithSecretDtoSchema,
  webhookPingResultSchema,
} from '@businessos/types';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { errors } from '../../lib/errors.js';
import { UnsafeUrlError, assertDeliverableUrl } from '../../lib/url-safety.js';
import { orgContext, requirePermission } from '../../plugins/auth.js';
import { auditContext, recordAudit } from '../audit/service.js';
import {
  generateWebhookSecret,
  sendWebhook,
  toWebhookDeliveryDto,
  toWebhookEndpointDto,
  toWebhookEndpointWithSecretDto,
} from './service.js';

const deliveryParamsSchema = webhookEndpointIdParamsSchema.extend({ deliveryId: z.string().uuid() });

export function registerIntegrationRoutes(app: FastifyInstance): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  async function validateUrl(url: string): Promise<void> {
    try {
      await assertDeliverableUrl(url, app.config.WEBHOOK_ALLOW_LOCAL);
    } catch (err) {
      if (err instanceof UnsafeUrlError) throw errors.badRequest('unsafe_url', err.message);
      throw err;
    }
  }

  // --- List endpoints --------------------------------------------------------
  r.route({
    method: 'GET',
    url: '/v1/webhooks',
    preHandler: [requirePermission('integrations.read')],
    schema: { tags: ['integrations'], response: { 200: z.array(webhookEndpointDtoSchema) } },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const rows = await app.prisma.webhookEndpoint.findMany({
        where: { organizationId },
        orderBy: { createdAt: 'desc' },
      });
      return reply.send(rows.map(toWebhookEndpointDto));
    },
  });

  // --- Create ----------------------------------------------------------------
  r.route({
    method: 'POST',
    url: '/v1/webhooks',
    preHandler: [requirePermission('integrations.manage')],
    schema: {
      tags: ['integrations'],
      body: createWebhookEndpointBodySchema,
      response: { 201: webhookEndpointWithSecretDtoSchema },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const body = request.body;
      await validateUrl(body.url);

      const created = await app.prisma.$transaction(async (tx) => {
        const endpoint = await tx.webhookEndpoint.create({
          data: {
            organizationId,
            url: body.url,
            description: body.description ?? null,
            secret: generateWebhookSecret(),
            eventTypes: body.eventTypes,
            enabled: body.enabled,
            createdById: request.currentUser?.id ?? null,
          },
        });
        await recordAudit(tx, {
          action: 'webhook_endpoint.created',
          organizationId,
          ...auditContext(request),
          entityType: 'webhook_endpoint',
          entityId: endpoint.id,
          metadata: { url: endpoint.url, eventTypes: endpoint.eventTypes },
        });
        return endpoint;
      });
      return reply.code(201).send(toWebhookEndpointWithSecretDto(created));
    },
  });

  // --- Get -------------------------------------------------------------------
  r.route({
    method: 'GET',
    url: '/v1/webhooks/:endpointId',
    preHandler: [requirePermission('integrations.read')],
    schema: {
      tags: ['integrations'],
      params: webhookEndpointIdParamsSchema,
      response: { 200: webhookEndpointDtoSchema },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const endpoint = await app.prisma.webhookEndpoint.findFirst({
        where: { id: request.params.endpointId, organizationId },
      });
      if (!endpoint) throw errors.notFound('Webhook endpoint');
      return reply.send(toWebhookEndpointDto(endpoint));
    },
  });

  // --- Update ----------------------------------------------------------------
  r.route({
    method: 'PATCH',
    url: '/v1/webhooks/:endpointId',
    preHandler: [requirePermission('integrations.manage')],
    schema: {
      tags: ['integrations'],
      params: webhookEndpointIdParamsSchema,
      body: updateWebhookEndpointBodySchema,
      response: { 200: webhookEndpointDtoSchema },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const body = request.body;
      const existing = await app.prisma.webhookEndpoint.findFirst({
        where: { id: request.params.endpointId, organizationId },
        select: { id: true },
      });
      if (!existing) throw errors.notFound('Webhook endpoint');
      if (body.url !== undefined) await validateUrl(body.url);

      const updated = await app.prisma.$transaction(async (tx) => {
        const endpoint = await tx.webhookEndpoint.update({
          where: { id: existing.id },
          data: {
            ...(body.url !== undefined ? { url: body.url } : {}),
            ...(body.description !== undefined ? { description: body.description } : {}),
            ...(body.eventTypes !== undefined ? { eventTypes: body.eventTypes } : {}),
            ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
          },
        });
        await recordAudit(tx, {
          action: 'webhook_endpoint.updated',
          organizationId,
          ...auditContext(request),
          entityType: 'webhook_endpoint',
          entityId: endpoint.id,
        });
        return endpoint;
      });
      return reply.send(toWebhookEndpointDto(updated));
    },
  });

  // --- Delete ----------------------------------------------------------------
  r.route({
    method: 'DELETE',
    url: '/v1/webhooks/:endpointId',
    preHandler: [requirePermission('integrations.manage')],
    schema: { tags: ['integrations'], params: webhookEndpointIdParamsSchema },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const endpoint = await app.prisma.webhookEndpoint.findFirst({
        where: { id: request.params.endpointId, organizationId },
        select: { id: true, url: true },
      });
      if (!endpoint) throw errors.notFound('Webhook endpoint');
      await app.prisma.$transaction(async (tx) => {
        // Deliveries cascade with the endpoint (FK onDelete: Cascade).
        await tx.webhookEndpoint.delete({ where: { id: endpoint.id } });
        await recordAudit(tx, {
          action: 'webhook_endpoint.deleted',
          organizationId,
          ...auditContext(request),
          entityType: 'webhook_endpoint',
          entityId: endpoint.id,
          metadata: { url: endpoint.url },
        });
      });
      return reply.code(204).send();
    },
  });

  // --- Rotate secret ---------------------------------------------------------
  r.route({
    method: 'POST',
    url: '/v1/webhooks/:endpointId/rotate-secret',
    preHandler: [requirePermission('integrations.manage')],
    schema: {
      tags: ['integrations'],
      params: webhookEndpointIdParamsSchema,
      response: { 200: webhookEndpointWithSecretDtoSchema },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const existing = await app.prisma.webhookEndpoint.findFirst({
        where: { id: request.params.endpointId, organizationId },
        select: { id: true },
      });
      if (!existing) throw errors.notFound('Webhook endpoint');
      const updated = await app.prisma.$transaction(async (tx) => {
        const endpoint = await tx.webhookEndpoint.update({
          where: { id: existing.id },
          data: { secret: generateWebhookSecret() },
        });
        await recordAudit(tx, {
          action: 'webhook_endpoint.secret_rotated',
          organizationId,
          ...auditContext(request),
          entityType: 'webhook_endpoint',
          entityId: endpoint.id,
        });
        return endpoint;
      });
      return reply.send(toWebhookEndpointWithSecretDto(updated));
    },
  });

  // --- Ping (synchronous test delivery) --------------------------------------
  r.route({
    method: 'POST',
    url: '/v1/webhooks/:endpointId/ping',
    preHandler: [requirePermission('integrations.manage')],
    schema: {
      tags: ['integrations'],
      params: webhookEndpointIdParamsSchema,
      response: { 200: webhookPingResultSchema },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const endpoint = await app.prisma.webhookEndpoint.findFirst({
        where: { id: request.params.endpointId, organizationId },
      });
      if (!endpoint) throw errors.notFound('Webhook endpoint');

      const deliveryId = randomUUID();
      const result = await sendWebhook(
        endpoint.url,
        endpoint.secret,
        'ping',
        deliveryId,
        endpoint.id,
        {
          id: randomUUID(),
          type: 'ping',
          payload: { endpointId: endpoint.id, message: 'Test delivery from BusinessOS.' },
          occurredAt: new Date().toISOString(),
        },
        app.config.WEBHOOK_ALLOW_LOCAL,
      );
      await recordAudit(app.prisma, {
        action: 'webhook_endpoint.pinged',
        organizationId,
        ...auditContext(request),
        entityType: 'webhook_endpoint',
        entityId: endpoint.id,
        metadata: { delivered: result.delivered, responseStatus: result.responseStatus ?? null },
      });
      return reply.send({
        delivered: result.delivered,
        responseStatus: result.responseStatus ?? null,
        error: result.error ?? null,
      });
    },
  });

  // --- Deliveries ------------------------------------------------------------
  r.route({
    method: 'GET',
    url: '/v1/webhooks/:endpointId/deliveries',
    preHandler: [requirePermission('integrations.read')],
    schema: {
      tags: ['integrations'],
      params: webhookEndpointIdParamsSchema,
      querystring: webhookDeliveryListQuerySchema,
      response: { 200: paginatedSchema(webhookDeliveryDtoSchema) },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const { status, page, pageSize } = request.query;
      const endpoint = await app.prisma.webhookEndpoint.findFirst({
        where: { id: request.params.endpointId, organizationId },
        select: { id: true },
      });
      if (!endpoint) throw errors.notFound('Webhook endpoint');

      const where = { organizationId, endpointId: endpoint.id, ...(status ? { status } : {}) };
      const [rows, totalItems] = await app.prisma.$transaction([
        app.prisma.webhookDelivery.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        app.prisma.webhookDelivery.count({ where }),
      ]);
      return reply.send({
        items: rows.map(toWebhookDeliveryDto),
        page,
        pageSize,
        totalItems,
        totalPages: Math.max(1, Math.ceil(totalItems / pageSize)),
      });
    },
  });

  // --- Redeliver -------------------------------------------------------------
  r.route({
    method: 'POST',
    url: '/v1/webhooks/:endpointId/deliveries/:deliveryId/redeliver',
    preHandler: [requirePermission('integrations.manage')],
    schema: {
      tags: ['integrations'],
      params: deliveryParamsSchema,
      response: { 200: webhookDeliveryDtoSchema },
    },
    handler: async (request, reply) => {
      const { organizationId } = orgContext(request);
      const delivery = await app.prisma.webhookDelivery.findFirst({
        where: {
          id: request.params.deliveryId,
          organizationId,
          endpointId: request.params.endpointId,
        },
        select: { id: true },
      });
      if (!delivery) throw errors.notFound('Delivery');
      const updated = await app.prisma.$transaction(async (tx) => {
        // Requeue: PENDING + due now + full retry budget again. The retry sweep
        // picks it up and re-attempts.
        const row = await tx.webhookDelivery.update({
          where: { id: delivery.id },
          data: { status: 'PENDING', attempts: 0, error: null, nextAttemptAt: new Date() },
        });
        await recordAudit(tx, {
          action: 'webhook_delivery.redelivered',
          organizationId,
          ...auditContext(request),
          entityType: 'webhook_delivery',
          entityId: row.id,
        });
        return row;
      });
      return reply.send(toWebhookDeliveryDto(updated));
    },
  });
}
