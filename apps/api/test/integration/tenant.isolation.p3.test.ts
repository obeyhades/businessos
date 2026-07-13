import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type {
  EmployeeDto,
  OnboardingTemplateDto,
  Paginated,
  SearchResponse,
} from '@businessos/types';
import {
  api,
  createEmployeeViaApi,
  createOrgViaApi,
  createTemplateViaApi,
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

// Every Phase 3 resource must be invisible and immutable across org boundaries.
describe('tenant isolation (Phase 3 personnel)', () => {
  let userA: Actor;
  let userB: Actor;
  let orgAId: string;

  let employeeA: EmployeeDto;
  let employeeB: EmployeeDto;
  let templateA: OnboardingTemplateDto;
  let certAId: string;
  let absenceAId: string;

  beforeEach(async () => {
    await truncateAll(ctx.prisma);
    userA = await createUser(ctx.app, 'owner-a@example.com');
    userB = await createUser(ctx.app, 'owner-b@example.com');
    orgAId = (await createOrgViaApi(ctx.app, userA, 'Org Alpha')).id;
    await createOrgViaApi(ctx.app, userB, 'Org Beta');

    employeeA = await createEmployeeViaApi(ctx, userA, {
      firstName: 'Alpha',
      lastName: 'Secretperson',
      jobTitle: 'Alpha Secret Role',
      personalIdNumber: '19900101-1234',
    });
    templateA = await createTemplateViaApi(ctx, userA, {
      name: 'Alpha Onboarding',
      items: [{ title: 'A item', dueOffsetDays: 0 }],
    });

    const cert = await api(ctx.app, 'POST', `/v1/employees/${employeeA.id}/certifications`, {
      session: userA,
      body: { name: 'Alpha Cert' },
    });
    certAId = cert.json<{ id: string }>().id;
    const absence = await api(ctx.app, 'POST', `/v1/employees/${employeeA.id}/absence-requests`, {
      session: userA,
      body: { type: 'VACATION', startDate: '2026-08-01', endDate: '2026-08-05' },
    });
    absenceAId = absence.json<{ id: string }>().id;

    // Org B gets its own employee so its lists are not trivially empty.
    employeeB = await createEmployeeViaApi(ctx, userB, { firstName: 'Beta', lastName: 'Own' });
  });

  it("B's employee list excludes org A rows", async () => {
    const response = await api(ctx.app, 'GET', '/v1/employees?pageSize=100', { session: userB });
    expect(response.statusCode).toBe(200);
    const ids = response.json<Paginated<EmployeeDto>>().items.map((e) => e.id);
    expect(ids).not.toContain(employeeA.id);
    expect(ids).toContain(employeeB.id);
  });

  it("B cannot GET, PATCH or DELETE A's employee (404)", async () => {
    expect(
      (await api(ctx.app, 'GET', `/v1/employees/${employeeA.id}`, { session: userB })).statusCode,
    ).toBe(404);
    const patch = await api(ctx.app, 'PATCH', `/v1/employees/${employeeA.id}`, {
      session: userB,
      body: { jobTitle: 'Hijacked' },
    });
    expect(patch.statusCode).toBe(404);
    const del = await api(ctx.app, 'DELETE', `/v1/employees/${employeeA.id}`, { session: userB });
    expect(del.statusCode).toBe(404);
    const row = await ctx.prisma.employee.findUniqueOrThrow({ where: { id: employeeA.id } });
    expect(row.jobTitle).toBe('Alpha Secret Role');
  });

  it("B cannot add a note, cert, absence or document to A's employee (404 on parent)", async () => {
    const note = await api(ctx.app, 'POST', `/v1/employees/${employeeA.id}/notes`, {
      session: userB,
      body: { body: 'intruding' },
    });
    // read_sensitive is checked before the parent lookup, so B (owner of its own
    // org, holding read_sensitive) sees a 404 not a 403 here.
    expect(note.statusCode).toBe(404);

    const cert = await api(ctx.app, 'POST', `/v1/employees/${employeeA.id}/certifications`, {
      session: userB,
      body: { name: 'Intruder Cert' },
    });
    expect(cert.statusCode).toBe(404);

    const absence = await api(ctx.app, 'POST', `/v1/employees/${employeeA.id}/absence-requests`, {
      session: userB,
      body: { type: 'SICK', startDate: '2026-09-01', endDate: '2026-09-02' },
    });
    expect(absence.statusCode).toBe(404);

    const docs = await api(ctx.app, 'GET', `/v1/employees/${employeeA.id}/documents`, {
      session: userB,
    });
    expect(docs.statusCode).toBe(404);

    // Nothing was written into org A.
    expect(await ctx.prisma.employeeNote.count({ where: { organizationId: orgAId } })).toBe(0);
    expect(await ctx.prisma.certification.count({ where: { employeeId: employeeA.id } })).toBe(1);
  });

  it("B cannot list A's notes, certs or absences (404)", async () => {
    expect(
      (await api(ctx.app, 'GET', `/v1/employees/${employeeA.id}/notes`, { session: userB }))
        .statusCode,
    ).toBe(404);
    expect(
      (
        await api(ctx.app, 'GET', `/v1/employees/${employeeA.id}/certifications`, {
          session: userB,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await api(ctx.app, 'GET', `/v1/employees/${employeeA.id}/absence-requests`, {
          session: userB,
        })
      ).statusCode,
    ).toBe(404);
  });

  it("B cannot review or cancel A's absence (404)", async () => {
    const review = await api(ctx.app, 'POST', `/v1/absence-requests/${absenceAId}/review`, {
      session: userB,
      body: { decision: 'APPROVED' },
    });
    expect(review.statusCode).toBe(404);
    const cancel = await api(ctx.app, 'POST', `/v1/absence-requests/${absenceAId}/cancel`, {
      session: userB,
    });
    expect(cancel.statusCode).toBe(404);
    const row = await ctx.prisma.absenceRequest.findUniqueOrThrow({ where: { id: absenceAId } });
    expect(row.status).toBe('PENDING');
  });

  it("B cannot PATCH or DELETE A's certification (404)", async () => {
    const patch = await api(
      ctx.app,
      'PATCH',
      `/v1/employees/${employeeA.id}/certifications/${certAId}`,
      { session: userB, body: { name: 'Hijacked' } },
    );
    expect(patch.statusCode).toBe(404);
    const del = await api(
      ctx.app,
      'DELETE',
      `/v1/employees/${employeeA.id}/certifications/${certAId}`,
      { session: userB },
    );
    expect(del.statusCode).toBe(404);
    expect(await ctx.prisma.certification.count({ where: { id: certAId } })).toBe(1);
  });

  it("B's org-wide absence list excludes org A rows", async () => {
    const response = await api(ctx.app, 'GET', '/v1/absence-requests?pageSize=100', {
      session: userB,
    });
    expect(response.statusCode).toBe(200);
    const ids = response.json<Paginated<{ id: string }>>().items.map((a) => a.id);
    expect(ids).not.toContain(absenceAId);
  });

  it("B's search never returns org A employees", async () => {
    for (const q of ['Alpha', 'Secretperson', 'Secret Role']) {
      const response = await api(ctx.app, 'GET', `/v1/search?q=${encodeURIComponent(q)}`, {
        session: userB,
      });
      expect(response.statusCode).toBe(200);
      const ids = response.json<SearchResponse>().results.map((r) => r.id);
      expect(ids, `search "${q}"`).not.toContain(employeeA.id);
    }
  });

  it("B's onboarding-template list excludes org A templates", async () => {
    const response = await api(ctx.app, 'GET', '/v1/onboarding-templates', { session: userB });
    expect(response.statusCode).toBe(200);
    const ids = response.json<OnboardingTemplateDto[]>().map((t) => t.id);
    expect(ids).not.toContain(templateA.id);
    expect(
      (await api(ctx.app, 'GET', `/v1/onboarding-templates/${templateA.id}`, { session: userB }))
        .statusCode,
    ).toBe(404);
  });

  it("B cannot apply A's template to B's own employee (invalid_template)", async () => {
    const response = await api(ctx.app, 'POST', `/v1/employees/${employeeB.id}/apply-template`, {
      session: userB,
      body: { templateId: templateA.id },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('invalid_template');
  });

  it("B cannot apply any template against A's employee (404 on parent)", async () => {
    const response = await api(ctx.app, 'POST', `/v1/employees/${employeeA.id}/apply-template`, {
      session: userB,
      body: { templateId: templateA.id },
    });
    expect(response.statusCode).toBe(404);
  });
});
