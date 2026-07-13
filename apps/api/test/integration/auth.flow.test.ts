import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_PASSWORD,
  api,
  createTestContext,
  createUser,
  destroyTestContext,
  rawTokenFromOutbox,
  sessionCookieFrom,
  truncateAll,
  type TestContext,
} from './helpers.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});

beforeEach(async () => {
  await truncateAll(ctx.prisma);
});

afterAll(async () => {
  await destroyTestContext(ctx);
});

describe('auth flow', () => {
  it('register returns 201 and a session cookie that authenticates /v1/auth/session', async () => {
    const response = await api(ctx.app, 'POST', '/v1/auth/register', {
      body: { email: 'anna@example.com', password: DEFAULT_PASSWORD, name: 'Anna' },
    });
    expect(response.statusCode).toBe(201);
    const cookie = sessionCookieFrom(response);

    const session = await api(ctx.app, 'GET', '/v1/auth/session', {
      session: { cookie, userId: '', email: '' },
    });
    expect(session.statusCode).toBe(200);
    expect(session.json()).toMatchObject({
      user: { email: 'anna@example.com', name: 'Anna' },
      memberships: [],
      activeOrganizationId: null,
    });
  });

  it('rejects duplicate email with 409 email_taken', async () => {
    await createUser(ctx.app, 'anna@example.com');
    const response = await api(ctx.app, 'POST', '/v1/auth/register', {
      body: { email: 'anna@example.com', password: DEFAULT_PASSWORD, name: 'Anna Again' },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: { code: 'email_taken' } });
  });

  it('login with wrong password returns 401 and records a user.login_failed audit row', async () => {
    await createUser(ctx.app, 'anna@example.com');
    const response = await api(ctx.app, 'POST', '/v1/auth/login', {
      body: { email: 'anna@example.com', password: 'definitely-wrong-1' },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: { code: 'invalid_credentials' } });

    const audit = await ctx.prisma.auditLog.findFirst({
      where: { action: 'user.login_failed' },
    });
    expect(audit).not.toBeNull();
    expect(audit?.metadata).toMatchObject({ email: 'anna@example.com' });
  });

  it('logout kills the session — subsequent /v1/auth/session is 401', async () => {
    const anna = await createUser(ctx.app, 'anna@example.com');
    const logout = await api(ctx.app, 'POST', '/v1/auth/logout', { session: anna });
    expect(logout.statusCode).toBe(204);

    const session = await api(ctx.app, 'GET', '/v1/auth/session', { session: anna });
    expect(session.statusCode).toBe(401);
  });

  it('forgot-password returns 204 and writes an outbox email plus a reset token row', async () => {
    const anna = await createUser(ctx.app, 'anna@example.com');
    const response = await api(ctx.app, 'POST', '/v1/auth/forgot-password', {
      body: { email: 'anna@example.com' },
    });
    expect(response.statusCode).toBe(204);

    // Raw token in the outbox email, only its hash in the database.
    const token = await rawTokenFromOutbox(ctx.prisma, 'password_reset', 'anna@example.com');
    expect(token.length).toBeGreaterThanOrEqual(40);

    const rows = await ctx.prisma.passwordResetToken.findMany({
      where: { userId: anna.userId },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.usedAt).toBeNull();
    expect(rows[0]?.tokenHash).not.toBe(token);
  });

  it('forgot-password for an unknown email still returns 204 and leaks nothing', async () => {
    const response = await api(ctx.app, 'POST', '/v1/auth/forgot-password', {
      body: { email: 'nobody@example.com' },
    });
    expect(response.statusCode).toBe(204);
    expect(await ctx.prisma.outboxMessage.count()).toBe(0);
  });

  it('full password reset: old password rejected, new accepted, previous sessions revoked', async () => {
    const anna = await createUser(ctx.app, 'anna@example.com');
    await api(ctx.app, 'POST', '/v1/auth/forgot-password', {
      body: { email: 'anna@example.com' },
    });
    const token = await rawTokenFromOutbox(ctx.prisma, 'password_reset', 'anna@example.com');

    const newPassword = 'Brand-New-Passw0rd';
    const reset = await api(ctx.app, 'POST', '/v1/auth/reset-password', {
      body: { token, password: newPassword },
    });
    expect(reset.statusCode).toBe(204);

    // The pre-reset session must be revoked.
    const oldSession = await api(ctx.app, 'GET', '/v1/auth/session', { session: anna });
    expect(oldSession.statusCode).toBe(401);

    const oldLogin = await api(ctx.app, 'POST', '/v1/auth/login', {
      body: { email: 'anna@example.com', password: DEFAULT_PASSWORD },
    });
    expect(oldLogin.statusCode).toBe(401);

    const newLogin = await api(ctx.app, 'POST', '/v1/auth/login', {
      body: { email: 'anna@example.com', password: newPassword },
    });
    expect(newLogin.statusCode).toBe(200);
  });

  it('rejects a reused reset token with 400', async () => {
    await createUser(ctx.app, 'anna@example.com');
    await api(ctx.app, 'POST', '/v1/auth/forgot-password', {
      body: { email: 'anna@example.com' },
    });
    const token = await rawTokenFromOutbox(ctx.prisma, 'password_reset', 'anna@example.com');

    const first = await api(ctx.app, 'POST', '/v1/auth/reset-password', {
      body: { token, password: 'Brand-New-Passw0rd' },
    });
    expect(first.statusCode).toBe(204);

    const second = await api(ctx.app, 'POST', '/v1/auth/reset-password', {
      body: { token, password: 'Another-Passw0rd!' },
    });
    expect(second.statusCode).toBe(400);
    expect(second.json()).toMatchObject({ error: { code: 'invalid_reset_token' } });
  });

  it('rejects an expired reset token with 400', async () => {
    const anna = await createUser(ctx.app, 'anna@example.com');
    await api(ctx.app, 'POST', '/v1/auth/forgot-password', {
      body: { email: 'anna@example.com' },
    });
    const token = await rawTokenFromOutbox(ctx.prisma, 'password_reset', 'anna@example.com');

    await ctx.prisma.passwordResetToken.updateMany({
      where: { userId: anna.userId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const response = await api(ctx.app, 'POST', '/v1/auth/reset-password', {
      body: { token, password: 'Brand-New-Passw0rd' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: 'invalid_reset_token' } });
  });
});
