import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  api,
  createTestContext,
  createUser,
  destroyTestContext,
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

describe('CSRF protection', () => {
  let user: Actor;

  beforeEach(async () => {
    await truncateAll(ctx.prisma);
    user = await createUser(ctx.app, 'user@example.com');
  });

  it('rejects a cookie-authenticated POST without an Origin header (403 csrf_rejected)', async () => {
    const response = await api(ctx.app, 'POST', '/v1/organizations', {
      session: user,
      body: { name: 'CSRF Org' },
      origin: null,
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: 'csrf_rejected' } });
    expect(await ctx.prisma.organization.count()).toBe(0);
  });

  it('rejects a cookie-authenticated POST from a foreign Origin (403)', async () => {
    const response = await api(ctx.app, 'POST', '/v1/organizations', {
      session: user,
      body: { name: 'CSRF Org' },
      origin: 'https://evil.example.com',
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: 'csrf_rejected' } });
  });

  it('allows GET requests without an Origin header', async () => {
    const response = await api(ctx.app, 'GET', '/v1/auth/session', {
      session: user,
      origin: null,
    });
    expect(response.statusCode).toBe(200);
  });

  it('allows a POST without a session cookie and without an Origin header', async () => {
    const response = await api(ctx.app, 'POST', '/v1/auth/login', {
      body: { email: 'user@example.com', password: 'wrong-password-1' },
      origin: null,
    });
    // 401 because the password is wrong — but not 403 csrf_rejected.
    expect(response.statusCode).toBe(401);
  });
});

describe('response serialization', () => {
  beforeEach(async () => {
    await truncateAll(ctx.prisma);
  });

  it('never leaks passwordHash through /v1/auth/session', async () => {
    const user = await createUser(ctx.app, 'user@example.com');
    const response = await api(ctx.app, 'GET', '/v1/auth/session', { session: user });
    expect(response.statusCode).toBe(200);

    expect(response.body).not.toContain('passwordHash');
    expect(response.body).not.toContain('password_hash');
    expect(response.body).not.toContain('$argon2');

    // The stored hash value itself must not appear either.
    const dbUser = await ctx.prisma.user.findUniqueOrThrow({ where: { id: user.userId } });
    expect(response.body).not.toContain(dbUser.passwordHash);
  });

  it('never leaks passwordHash through the register response', async () => {
    const response = await api(ctx.app, 'POST', '/v1/auth/register', {
      body: { email: 'fresh@example.com', password: 'Sup3rSecret!Pass', name: 'Fresh' },
    });
    expect(response.statusCode).toBe(201);
    expect(response.body).not.toContain('passwordHash');
    expect(response.body).not.toContain('$argon2');
  });
});
