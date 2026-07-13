import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createTestContext, destroyTestContext, type TestContext } from './helpers.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});

afterAll(async () => {
  await destroyTestContext(ctx);
});

describe('health endpoints', () => {
  it('GET /healthz returns 200 ok', async () => {
    const response = await api(ctx.app, 'GET', '/healthz');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok' });
  });

  it('GET /readyz returns 200 with the database check ok', async () => {
    const response = await api(ctx.app, 'GET', '/readyz');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ready', checks: { database: 'ok' } });
  });
});
