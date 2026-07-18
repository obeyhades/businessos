import { createHmac } from 'node:crypto';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPrismaClient, type PrismaClient } from '@businessos/db';
import {
  WEBHOOK_DELIVERY_HEADER,
  WEBHOOK_ENDPOINT_HEADER,
  WEBHOOK_EVENT_HEADER,
  WEBHOOK_SIGNATURE_HEADER,
} from '@businessos/types';
import type {
  OrganizationDto,
  Paginated,
  WebhookDeliveryDto,
  WebhookEndpointDto,
  WebhookEndpointWithSecretDto,
  WebhookPingResult,
} from '@businessos/types';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import {
  TEST_DATABASE_URL,
  api,
  createOrgViaApi,
  createTestContext,
  createTaskViaApi,
  createUser,
  createWebhookViaApi,
  destroyTestContext,
  errorCode,
  seedWebhookDelivery,
  testConfig,
  truncateAll,
  type Actor,
  type TestContext,
} from './helpers.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});

afterAll(async () => {
  await destroyTestContext(ctx);
});

// --- A throwaway loopback receiver the ping test delivers to -----------------

interface CapturedRequest {
  method: string;
  headers: IncomingHttpHeaders;
  body: string;
}

interface Receiver {
  url: string;
  received: Promise<CapturedRequest>;
  close: () => Promise<void>;
}

/** Starts a one-shot http server on 127.0.0.1 that records the first request. */
async function startReceiver(status = 200): Promise<Receiver> {
  let resolveReceived!: (req: CapturedRequest) => void;
  const received = new Promise<CapturedRequest>((resolve) => {
    resolveReceived = resolve;
  });
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk as Buffer));
    req.on('end', () => {
      resolveReceived({
        method: req.method ?? '',
        headers: req.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      });
      res.statusCode = status;
      res.end('ok');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/hook`,
    received,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe('webhook endpoints (Phase 9)', () => {
  let owner: Actor;
  let orgA: OrganizationDto;

  beforeEach(async () => {
    await truncateAll(ctx.prisma);
    owner = await createUser(ctx.app, `p9-webhooks-${Date.now()}@test.local`);
    orgA = await createOrgViaApi(ctx.app, owner, 'Webhooks AB');
  });

  describe('CRUD', () => {
    it('create returns the raw secret + a hint; list/get expose only the hint', async () => {
      const created = await createWebhookViaApi(ctx, owner, {
        url: 'https://hooks.example.com/a',
        description: 'Primary',
        eventTypes: ['task.completed', 'invoice.finalized'],
      });
      expect(created.secret).toMatch(/^whsec_/);
      expect(created.secretHint).toBe(`…${created.secret.slice(-4)}`);
      expect(created.eventTypes).toEqual(['task.completed', 'invoice.finalized']);
      expect(created.enabled).toBe(true);

      const list = await api(ctx.app, 'GET', '/v1/webhooks', { session: owner });
      expect(list.statusCode).toBe(200);
      const rows = list.json<WebhookEndpointDto[]>();
      expect(rows).toHaveLength(1);
      // The secret must never appear on a list/get DTO — only the hint.
      expect(rows[0]).not.toHaveProperty('secret');
      expect(rows[0]!.secretHint).toBe(created.secretHint);
      expect(list.body).not.toContain(created.secret);

      const get = await api(ctx.app, 'GET', `/v1/webhooks/${created.id}`, { session: owner });
      expect(get.statusCode).toBe(200);
      expect(get.json<WebhookEndpointDto>()).not.toHaveProperty('secret');
      expect(get.body).not.toContain(created.secret);
    });

    it('de-duplicates event types and enforces at-least-one', async () => {
      const created = await createWebhookViaApi(ctx, owner, {
        eventTypes: ['task.completed', 'task.completed'],
      });
      expect(created.eventTypes).toEqual(['task.completed']);

      const empty = await api(ctx.app, 'POST', '/v1/webhooks', {
        session: owner,
        body: { url: 'https://hooks.example.com/x', eventTypes: [] },
      });
      expect(empty.statusCode).toBe(400);
      expect(errorCode(empty.body)).toBe('validation_error');
    });

    it('updates url, description, eventTypes and enabled', async () => {
      const created = await createWebhookViaApi(ctx, owner);
      const res = await api(ctx.app, 'PATCH', `/v1/webhooks/${created.id}`, {
        session: owner,
        body: {
          url: 'https://hooks.example.com/updated',
          description: 'Renamed',
          eventTypes: ['invoice.finalized'],
          enabled: false,
        },
      });
      expect(res.statusCode).toBe(200);
      const dto = res.json<WebhookEndpointDto>();
      expect(dto.url).toBe('https://hooks.example.com/updated');
      expect(dto.description).toBe('Renamed');
      expect(dto.eventTypes).toEqual(['invoice.finalized']);
      expect(dto.enabled).toBe(false);
    });

    it('rejects an empty PATCH with validation_error', async () => {
      const created = await createWebhookViaApi(ctx, owner);
      const res = await api(ctx.app, 'PATCH', `/v1/webhooks/${created.id}`, {
        session: owner,
        body: {},
      });
      expect(res.statusCode).toBe(400);
      expect(errorCode(res.body)).toBe('validation_error');
    });

    it('delete returns 204, then the endpoint is 404', async () => {
      const created = await createWebhookViaApi(ctx, owner);
      const del = await api(ctx.app, 'DELETE', `/v1/webhooks/${created.id}`, { session: owner });
      expect(del.statusCode).toBe(204);
      const get = await api(ctx.app, 'GET', `/v1/webhooks/${created.id}`, { session: owner });
      expect(get.statusCode).toBe(404);
      const del2 = await api(ctx.app, 'DELETE', `/v1/webhooks/${created.id}`, { session: owner });
      expect(del2.statusCode).toBe(404);
    });
  });

  describe('URL shape guard', () => {
    it('rejects a non-http(s) scheme (ftp://) at the schema with validation_error', async () => {
      const res = await api(ctx.app, 'POST', '/v1/webhooks', {
        session: owner,
        body: { url: 'ftp://example.com/hook', eventTypes: ['*'] },
      });
      expect(res.statusCode).toBe(400);
      expect(errorCode(res.body)).toBe('validation_error');
    });

    it('rejects a syntactically invalid URL with validation_error', async () => {
      const res = await api(ctx.app, 'POST', '/v1/webhooks', {
        session: owner,
        body: { url: 'not a url', eventTypes: ['*'] },
      });
      expect(res.statusCode).toBe(400);
      expect(errorCode(res.body)).toBe('validation_error');
    });
  });

  describe('rotate-secret', () => {
    it('returns a different secret each rotation and keeps the hint in step', async () => {
      const created = await createWebhookViaApi(ctx, owner);
      const rotated = await api(ctx.app, 'POST', `/v1/webhooks/${created.id}/rotate-secret`, {
        session: owner,
      });
      expect(rotated.statusCode).toBe(200);
      const dto = rotated.json<WebhookEndpointWithSecretDto>();
      expect(dto.secret).toMatch(/^whsec_/);
      expect(dto.secret).not.toBe(created.secret);
      expect(dto.secretHint).toBe(`…${dto.secret.slice(-4)}`);
    });
  });

  describe('ping', () => {
    it('delivers to a live loopback receiver with a valid HMAC signature', async () => {
      const receiver = await startReceiver(200);
      try {
        const endpoint = await createWebhookViaApi(ctx, owner, {
          url: receiver.url,
          eventTypes: ['*'],
        });
        const res = await api(ctx.app, 'POST', `/v1/webhooks/${endpoint.id}/ping`, {
          session: owner,
        });
        expect(res.statusCode).toBe(200);
        const result = res.json<WebhookPingResult>();
        expect(result.delivered).toBe(true);
        expect(result.responseStatus).toBe(200);
        expect(result.error).toBeNull();

        const captured = await receiver.received;
        expect(captured.method).toBe('POST');
        expect(captured.headers[WEBHOOK_EVENT_HEADER]).toBe('ping');
        expect(captured.headers[WEBHOOK_ENDPOINT_HEADER]).toBe(endpoint.id);
        expect(typeof captured.headers[WEBHOOK_DELIVERY_HEADER]).toBe('string');

        // Recompute the signature over the RAW body exactly as an integrator would.
        const sig = captured.headers[WEBHOOK_SIGNATURE_HEADER] as string;
        const match = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(sig);
        expect(match).not.toBeNull();
        const [, t, v1] = match!;
        const expected = createHmac('sha256', endpoint.secret)
          .update(`${t}.${captured.body}`)
          .digest('hex');
        expect(v1).toBe(expected);
      } finally {
        await receiver.close();
      }
    });

    it('reports delivered=false with the upstream status when the receiver 500s', async () => {
      const receiver = await startReceiver(500);
      try {
        const endpoint = await createWebhookViaApi(ctx, owner, { url: receiver.url });
        const res = await api(ctx.app, 'POST', `/v1/webhooks/${endpoint.id}/ping`, {
          session: owner,
        });
        expect(res.statusCode).toBe(200);
        const result = res.json<WebhookPingResult>();
        expect(result.delivered).toBe(false);
        expect(result.responseStatus).toBe(500);
      } finally {
        await receiver.close();
      }
    });
  });

  describe('deliveries', () => {
    it('lists a seeded delivery and redeliver requeues it (PENDING, attempts 0, due now)', async () => {
      const endpoint = await createWebhookViaApi(ctx, owner);
      const deliveryId = await seedWebhookDelivery(ctx.prisma, {
        organizationId: orgA.id,
        endpointId: endpoint.id,
        status: 'FAILED',
        attempts: 6,
        responseStatus: 500,
        error: 'HTTP 500',
      });

      const list = await api(ctx.app, 'GET', `/v1/webhooks/${endpoint.id}/deliveries`, {
        session: owner,
      });
      expect(list.statusCode).toBe(200);
      const page = list.json<Paginated<WebhookDeliveryDto>>();
      expect(page.totalItems).toBe(1);
      const row = page.items[0]!;
      expect(row.id).toBe(deliveryId);
      expect(row.status).toBe('FAILED');
      expect(row.attempts).toBe(6);

      const redeliver = await api(
        ctx.app,
        'POST',
        `/v1/webhooks/${endpoint.id}/deliveries/${deliveryId}/redeliver`,
        { session: owner },
      );
      expect(redeliver.statusCode).toBe(200);
      const requeued = redeliver.json<WebhookDeliveryDto>();
      expect(requeued.status).toBe('PENDING');
      expect(requeued.attempts).toBe(0);
      expect(requeued.error).toBeNull();
      expect(requeued.nextAttemptAt).not.toBeNull();
    });

    it('paginates and filters deliveries by status', async () => {
      const endpoint = await createWebhookViaApi(ctx, owner);
      for (let i = 0; i < 3; i += 1) {
        await seedWebhookDelivery(ctx.prisma, {
          organizationId: orgA.id,
          endpointId: endpoint.id,
          status: 'FAILED',
        });
      }
      for (let i = 0; i < 2; i += 1) {
        await seedWebhookDelivery(ctx.prisma, {
          organizationId: orgA.id,
          endpointId: endpoint.id,
          status: 'SUCCEEDED',
          responseStatus: 200,
          error: null,
          deliveredAt: new Date(),
        });
      }

      const firstPage = await api(
        ctx.app,
        'GET',
        `/v1/webhooks/${endpoint.id}/deliveries?pageSize=2&page=1`,
        { session: owner },
      );
      const fp = firstPage.json<Paginated<WebhookDeliveryDto>>();
      expect(fp.items).toHaveLength(2);
      expect(fp.totalItems).toBe(5);
      expect(fp.totalPages).toBe(3);

      const succeeded = await api(
        ctx.app,
        'GET',
        `/v1/webhooks/${endpoint.id}/deliveries?status=SUCCEEDED`,
        { session: owner },
      );
      const sp = succeeded.json<Paginated<WebhookDeliveryDto>>();
      expect(sp.totalItems).toBe(2);
      expect(sp.items.every((d) => d.status === 'SUCCEEDED')).toBe(true);

      const failed = await api(
        ctx.app,
        'GET',
        `/v1/webhooks/${endpoint.id}/deliveries?status=FAILED`,
        { session: owner },
      );
      expect(failed.json<Paginated<WebhookDeliveryDto>>().totalItems).toBe(3);
    });
  });

  describe('event fan-out source', () => {
    it('completing a task writes a task.completed outbox row (the worker fans this to endpoints)', async () => {
      const task = await createTaskViaApi(ctx, owner);
      const res = await api(ctx.app, 'PATCH', `/v1/tasks/${task.id}`, {
        session: owner,
        body: { status: 'DONE' },
      });
      expect(res.statusCode).toBe(200);

      const outboxRow = await ctx.prisma.outboxMessage.findFirst({
        where: { type: 'task.completed' },
        orderBy: { occurredAt: 'desc' },
      });
      expect(outboxRow).not.toBeNull();
      const payload = outboxRow!.payload as { organizationId: string; taskId: string };
      expect(payload.organizationId).toBe(orgA.id);
      expect(payload.taskId).toBe(task.id);
    });
  });
});

// The route validates the URL with WEBHOOK_ALLOW_LOCAL off exactly as production
// does, so the SSRF block is asserted at the HTTP boundary (not just in the unit
// test). A dedicated app + Prisma client is used so closing it never disconnects
// the shared test context's client.
describe('webhook SSRF guard at the route in production mode (WEBHOOK_ALLOW_LOCAL=false)', () => {
  let prodPrisma: PrismaClient;
  let prodApp: FastifyInstance;
  let prodOwner: Actor;

  beforeAll(async () => {
    prodPrisma = createPrismaClient({ databaseUrl: TEST_DATABASE_URL });
    prodApp = await buildApp({
      config: { ...testConfig, WEBHOOK_ALLOW_LOCAL: false },
      prisma: prodPrisma,
      logger: false,
    });
    await prodApp.ready();
  });

  afterAll(async () => {
    await prodApp.close();
  });

  beforeEach(async () => {
    await truncateAll(prodPrisma);
    prodOwner = await createUser(prodApp, `p9-prod-${Date.now()}@test.local`);
    await createOrgViaApi(prodApp, prodOwner, 'Prod Mode AB');
  });

  it('rejects an http:// URL (https is mandatory) with unsafe_url', async () => {
    const res = await api(prodApp, 'POST', '/v1/webhooks', {
      session: prodOwner,
      body: { url: 'http://hooks.example.com/a', eventTypes: ['*'] },
    });
    expect(res.statusCode).toBe(400);
    expect(errorCode(res.body)).toBe('unsafe_url');
  });

  it('rejects an https URL whose host is a loopback/private IP with unsafe_url', async () => {
    for (const url of ['https://127.0.0.1/hook', 'https://10.0.0.5/hook']) {
      const res = await api(prodApp, 'POST', '/v1/webhooks', {
        session: prodOwner,
        body: { url, eventTypes: ['*'] },
      });
      expect(res.statusCode).toBe(400);
      expect(errorCode(res.body)).toBe('unsafe_url');
    }
  });

  it('still accepts an https URL to a public IP literal', async () => {
    const res = await api(prodApp, 'POST', '/v1/webhooks', {
      session: prodOwner,
      body: { url: 'https://8.8.8.8/hook', eventTypes: ['*'] },
    });
    expect(res.statusCode).toBe(201);
  });
});
