import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CertificationDto, EmployeeDto, ExpiringCertificationDto } from '@businessos/types';
import {
  api,
  createEmployeeViaApi,
  createOrgViaApi,
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

/** N days from now as YYYY-MM-DD (UTC). */
function daysFromNow(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

describe('certifications', () => {
  let owner: Actor;
  let employee: EmployeeDto;

  beforeEach(async () => {
    await truncateAll(ctx.prisma);
    owner = await createUser(ctx.app, 'owner@example.com');
    await createOrgViaApi(ctx.app, owner, 'Acme AB');
    employee = await createEmployeeViaApi(ctx, owner, { firstName: 'Erik', lastName: 'Eklund' });
  });

  it('supports the full CRUD lifecycle', async () => {
    const create = await api(ctx.app, 'POST', `/v1/employees/${employee.id}/certifications`, {
      session: owner,
      body: { name: 'Hot Work Permit', issuer: 'SVEBRA', expiresAt: daysFromNow(25) },
    });
    expect(create.statusCode).toBe(201);
    const cert = create.json<CertificationDto>();
    expect(cert).toMatchObject({ name: 'Hot Work Permit', issuer: 'SVEBRA' });

    const list = await api(ctx.app, 'GET', `/v1/employees/${employee.id}/certifications`, {
      session: owner,
    });
    expect(list.statusCode).toBe(200);
    expect(list.json<CertificationDto[]>().map((c) => c.id)).toContain(cert.id);

    const patch = await api(
      ctx.app,
      'PATCH',
      `/v1/employees/${employee.id}/certifications/${cert.id}`,
      { session: owner, body: { issuer: 'Renewed Issuer' } },
    );
    expect(patch.statusCode).toBe(200);
    expect(patch.json<CertificationDto>().issuer).toBe('Renewed Issuer');

    const del = await api(
      ctx.app,
      'DELETE',
      `/v1/employees/${employee.id}/certifications/${cert.id}`,
      { session: owner },
    );
    expect(del.statusCode).toBe(204);
    expect(await ctx.prisma.certification.count({ where: { id: cert.id } })).toBe(0);
  });

  it('expiring endpoint returns only certs within the window, each with an employee ref', async () => {
    const soon = await api(ctx.app, 'POST', `/v1/employees/${employee.id}/certifications`, {
      session: owner,
      body: { name: 'Expiring Soon', expiresAt: daysFromNow(10) },
    });
    const later = await api(ctx.app, 'POST', `/v1/employees/${employee.id}/certifications`, {
      session: owner,
      body: { name: 'Expiring Later', expiresAt: daysFromNow(400) },
    });
    const soonId = soon.json<CertificationDto>().id;
    const laterId = later.json<CertificationDto>().id;

    const response = await api(ctx.app, 'GET', '/v1/certifications/expiring?withinDays=30', {
      session: owner,
    });
    expect(response.statusCode).toBe(200);
    const results = response.json<ExpiringCertificationDto[]>();
    const ids = results.map((c) => c.id);
    expect(ids).toContain(soonId);
    expect(ids).not.toContain(laterId);

    const soonResult = results.find((c) => c.id === soonId);
    expect(soonResult?.employee).toMatchObject({ id: employee.id, name: 'Erik Eklund' });
  });

  it('expiring endpoint defaults to a 60-day window', async () => {
    await api(ctx.app, 'POST', `/v1/employees/${employee.id}/certifications`, {
      session: owner,
      body: { name: 'Within Default', expiresAt: daysFromNow(50) },
    });
    await api(ctx.app, 'POST', `/v1/employees/${employee.id}/certifications`, {
      session: owner,
      body: { name: 'Outside Default', expiresAt: daysFromNow(120) },
    });
    const response = await api(ctx.app, 'GET', '/v1/certifications/expiring', { session: owner });
    expect(response.statusCode).toBe(200);
    const names = response.json<ExpiringCertificationDto[]>().map((c) => c.name);
    expect(names).toContain('Within Default');
    expect(names).not.toContain('Outside Default');
  });
});
