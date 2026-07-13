import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { EmployeeDocumentDto, EmployeeDto } from '@businessos/types';
import {
  addMemberViaInvitation,
  api,
  createEmployeeViaApi,
  createOrgViaApi,
  createTestContext,
  createUser,
  destroyTestContext,
  truncateAll,
  uploadEmployeeDocumentViaApi,
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

const textFile = (name = 'contract.txt') => ({
  filename: name,
  contentType: 'text/plain',
  content: Buffer.from('employee document body'),
});

// The happy paths exercise the real MinIO/S3 backend configured in testConfig
// (localhost:9000, bucket 'businessos'). If MinIO is unavailable, put() fails
// and those tests surface it.
describe('employee documents', () => {
  let owner: Actor;
  let manager: Actor;
  let employee: EmployeeDto;

  beforeEach(async () => {
    await truncateAll(ctx.prisma);
    owner = await createUser(ctx.app, 'owner@example.com');
    await createOrgViaApi(ctx.app, owner, 'Acme AB');
    manager = await addMemberViaInvitation(ctx, owner, 'manager@example.com', 'MANAGER');
    employee = await createEmployeeViaApi(ctx, owner, { firstName: 'Fatima', lastName: 'Nilsson' });
  });

  it('uploads a sensitive document with category+sensitive query params (201)', async () => {
    const response = await uploadEmployeeDocumentViaApi(ctx.app, owner, employee.id, textFile(), {
      category: 'CONTRACT',
      sensitive: true,
    });
    expect(response.statusCode, response.body).toBe(201);
    const doc = response.json<EmployeeDocumentDto>();
    expect(doc).toMatchObject({
      fileName: 'contract.txt',
      contentType: 'text/plain',
      category: 'CONTRACT',
      isSensitive: true,
    });
    expect(doc.uploadedBy?.id).toBe(owner.userId);
  });

  it('rejects an unsupported mimetype (400 unsupported_type, no MinIO write)', async () => {
    const response = await uploadEmployeeDocumentViaApi(
      ctx.app,
      owner,
      employee.id,
      { filename: 'evil.exe', contentType: 'application/x-msdownload', content: Buffer.from('MZ') },
      { category: 'OTHER' },
    );
    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('unsupported_type');
    expect(await ctx.prisma.employeeDocument.count()).toBe(0);
  });

  it('a MANAGER uploading sensitive=true is forbidden (403)', async () => {
    const response = await uploadEmployeeDocumentViaApi(ctx.app, manager, employee.id, textFile(), {
      category: 'CONTRACT',
      sensitive: true,
    });
    expect(response.statusCode).toBe(403);
    expect(await ctx.prisma.employeeDocument.count()).toBe(0);
  });

  // The `sensitive` query flag uses booleanQueryParam, so "false" is honoured:
  // a MANAGER (personnel.manage, not read_sensitive) can upload a non-sensitive
  // document, and it is stored with isSensitive = false.
  it('a MANAGER can upload a non-sensitive document (201)', async () => {
    const response = await uploadEmployeeDocumentViaApi(
      ctx.app,
      manager,
      employee.id,
      textFile('policy.txt'),
      { category: 'POLICY', sensitive: false },
    );
    expect(response.statusCode, response.body).toBe(201);
    expect(response.json<EmployeeDocumentDto>().isSensitive).toBe(false);
  });

  it('MANAGER list excludes sensitive docs', async () => {
    const sensitive = await uploadEmployeeDocumentViaApi(ctx.app, owner, employee.id, textFile(), {
      category: 'CONTRACT',
      sensitive: true,
    });
    const sensitiveId = sensitive.json<EmployeeDocumentDto>().id;

    const ownerList = await api(ctx.app, 'GET', `/v1/employees/${employee.id}/documents`, {
      session: owner,
    });
    expect(ownerList.json<EmployeeDocumentDto[]>().map((d) => d.id)).toContain(sensitiveId);

    const managerList = await api(ctx.app, 'GET', `/v1/employees/${employee.id}/documents`, {
      session: manager,
    });
    expect(managerList.json<EmployeeDocumentDto[]>().map((d) => d.id)).not.toContain(sensitiveId);
  });

  it('MANAGER list includes non-sensitive docs', async () => {
    const open = await uploadEmployeeDocumentViaApi(
      ctx.app,
      owner,
      employee.id,
      textFile('handbook.txt'),
      { category: 'POLICY', sensitive: false },
    );
    const openId = open.json<EmployeeDocumentDto>().id;
    const managerList = await api(ctx.app, 'GET', `/v1/employees/${employee.id}/documents`, {
      session: manager,
    });
    expect(managerList.json<EmployeeDocumentDto[]>().map((d) => d.id)).toContain(openId);
  });

  it('download-url of a sensitive doc hides existence from MANAGER (404) but signs for OWNER (200)', async () => {
    const upload = await uploadEmployeeDocumentViaApi(ctx.app, owner, employee.id, textFile(), {
      category: 'CONTRACT',
      sensitive: true,
    });
    const docId = upload.json<EmployeeDocumentDto>().id;

    const asManager = await api(
      ctx.app,
      'GET',
      `/v1/employees/${employee.id}/documents/${docId}/download-url`,
      { session: manager },
    );
    expect(asManager.statusCode).toBe(404);

    const asOwner = await api(
      ctx.app,
      'GET',
      `/v1/employees/${employee.id}/documents/${docId}/download-url`,
      { session: owner },
    );
    expect(asOwner.statusCode).toBe(200);
    expect(asOwner.json<{ url: string }>().url).toContain('http');
  });

  it('deletes a document (204)', async () => {
    const upload = await uploadEmployeeDocumentViaApi(
      ctx.app,
      owner,
      employee.id,
      textFile('deleteme.txt'),
      { category: 'OTHER', sensitive: false },
    );
    const docId = upload.json<EmployeeDocumentDto>().id;
    const del = await api(ctx.app, 'DELETE', `/v1/employees/${employee.id}/documents/${docId}`, {
      session: owner,
    });
    expect(del.statusCode).toBe(204);
    expect(await ctx.prisma.employeeDocument.count({ where: { id: docId } })).toBe(0);
  });
});
