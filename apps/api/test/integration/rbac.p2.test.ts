import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { hasPermission, type OrganizationRole } from '@businessos/types';
import {
  addMemberViaInvitation,
  api,
  createCustomerViaApi,
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

// Expectations are derived from packages/types/src/permissions.ts. The asserts
// below double-check the intent against hasPermission so a matrix change is
// caught rather than silently diverging from the tests.
describe('RBAC (Phase 2)', () => {
  let owner: Actor;
  let employee: Actor;
  let readonly: Actor;
  let accountant: Actor;

  beforeEach(async () => {
    await truncateAll(ctx.prisma);
    owner = await createUser(ctx.app, 'owner@example.com');
    await createOrgViaApi(ctx.app, owner, 'Acme AB');
    employee = await addMemberViaInvitation(ctx, owner, 'employee@example.com', 'EMPLOYEE');
    readonly = await addMemberViaInvitation(ctx, owner, 'readonly@example.com', 'READONLY');
    accountant = await addMemberViaInvitation(ctx, owner, 'accountant@example.com', 'ACCOUNTANT');
  });

  function sanityCheckMatrix(role: OrganizationRole): void {
    // The reads every Phase 2 role in this suite is expected to hold.
    expect(hasPermission(role, 'customers.read')).toBe(true);
    expect(hasPermission(role, 'projects.read')).toBe(true);
    expect(hasPermission(role, 'tasks.read')).toBe(true);
  }

  describe('EMPLOYEE', () => {
    it('can read customers, projects and tasks', async () => {
      sanityCheckMatrix('EMPLOYEE');
      for (const path of ['customers', 'projects', 'tasks']) {
        const response = await api(ctx.app, 'GET', `/v1/${path}`, { session: employee });
        expect(response.statusCode, path).toBe(200);
      }
    });

    it('can manage tasks (POST /v1/tasks -> 201)', async () => {
      expect(hasPermission('EMPLOYEE', 'tasks.manage')).toBe(true);
      const response = await api(ctx.app, 'POST', '/v1/tasks', {
        session: employee,
        body: { title: 'Employee task' },
      });
      expect(response.statusCode).toBe(201);
    });

    it('cannot manage customers or projects (403)', async () => {
      expect(hasPermission('EMPLOYEE', 'customers.manage')).toBe(false);
      expect(hasPermission('EMPLOYEE', 'projects.manage')).toBe(false);
      const customer = await api(ctx.app, 'POST', '/v1/customers', {
        session: employee,
        body: { name: 'Nope' },
      });
      expect(customer.statusCode).toBe(403);
      const project = await api(ctx.app, 'POST', '/v1/projects', {
        session: employee,
        body: { name: 'Nope' },
      });
      expect(project.statusCode).toBe(403);
    });
  });

  describe('READONLY', () => {
    it('can read every Phase 2 list endpoint (200)', async () => {
      sanityCheckMatrix('READONLY');
      for (const path of ['customers', 'projects', 'tasks']) {
        const response = await api(ctx.app, 'GET', `/v1/${path}`, { session: readonly });
        expect(response.statusCode, path).toBe(200);
      }
    });

    it('is forbidden from every *.manage write (403)', async () => {
      expect(hasPermission('READONLY', 'customers.manage')).toBe(false);
      expect(hasPermission('READONLY', 'projects.manage')).toBe(false);
      expect(hasPermission('READONLY', 'tasks.manage')).toBe(false);

      const customer = await api(ctx.app, 'POST', '/v1/customers', {
        session: readonly,
        body: { name: 'Nope' },
      });
      expect(customer.statusCode).toBe(403);
      const project = await api(ctx.app, 'POST', '/v1/projects', {
        session: readonly,
        body: { name: 'Nope' },
      });
      expect(project.statusCode).toBe(403);
      const task = await api(ctx.app, 'POST', '/v1/tasks', {
        session: readonly,
        body: { title: 'Nope' },
      });
      expect(task.statusCode).toBe(403);
    });

    it('cannot add a comment (comment create needs *.manage) -> 403', async () => {
      // Owner provisions a customer the READONLY member can see but not comment on.
      const customer = await createCustomerViaApi(ctx, owner, { name: 'Commentable' });
      const response = await api(ctx.app, 'POST', `/v1/customers/${customer.id}/comments`, {
        session: readonly,
        body: { body: 'I should not be allowed' },
      });
      expect(response.statusCode).toBe(403);
    });
  });

  describe('ACCOUNTANT', () => {
    it('can read customers, projects and tasks (200)', async () => {
      sanityCheckMatrix('ACCOUNTANT');
      for (const path of ['customers', 'projects', 'tasks']) {
        const response = await api(ctx.app, 'GET', `/v1/${path}`, { session: accountant });
        expect(response.statusCode, path).toBe(200);
      }
    });

    it('cannot manage customers (403)', async () => {
      expect(hasPermission('ACCOUNTANT', 'customers.manage')).toBe(false);
      const response = await api(ctx.app, 'POST', '/v1/customers', {
        session: accountant,
        body: { name: 'Nope' },
      });
      expect(response.statusCode).toBe(403);
    });

    it('cannot manage projects (403)', async () => {
      expect(hasPermission('ACCOUNTANT', 'projects.manage')).toBe(false);
      const response = await api(ctx.app, 'POST', '/v1/projects', {
        session: accountant,
        body: { name: 'Nope' },
      });
      expect(response.statusCode).toBe(403);
    });
  });
});
