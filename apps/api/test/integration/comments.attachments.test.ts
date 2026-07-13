import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ALLOWED_ATTACHMENT_TYPES,
  MAX_ATTACHMENT_BYTES,
  type AttachmentDownloadDto,
  type AttachmentDto,
  type CommentDto,
  type EntityKind,
} from '@businessos/types';
import {
  addMemberViaInvitation,
  api,
  createCustomerViaApi,
  createOrgViaApi,
  createProjectViaApi,
  createTaskViaApi,
  createTestContext,
  createUser,
  destroyTestContext,
  truncateAll,
  uploadAttachmentViaApi,
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

describe('comments', () => {
  let owner: Actor;
  let orgId: string;

  beforeEach(async () => {
    await truncateAll(ctx.prisma);
    owner = await createUser(ctx.app, 'owner@example.com');
    orgId = (await createOrgViaApi(ctx.app, owner, 'Acme AB')).id;
  });

  it('create / list / delete on a customer, project and task', async () => {
    const customer = await createCustomerViaApi(ctx, owner, { name: 'Comment Customer' });
    const project = await createProjectViaApi(ctx, owner, { name: 'Comment Project' });
    const task = await createTaskViaApi(ctx, owner, { title: 'Comment Task' });

    const targets: Array<{ kind: EntityKind; path: string; id: string }> = [
      { kind: 'customer', path: 'customers', id: customer.id },
      { kind: 'project', path: 'projects', id: project.id },
      { kind: 'task', path: 'tasks', id: task.id },
    ];

    for (const t of targets) {
      const created = await api(ctx.app, 'POST', `/v1/${t.path}/${t.id}/comments`, {
        session: owner,
        body: { body: `Hello on ${t.kind}` },
      });
      expect(created.statusCode, `${t.kind} create`).toBe(201);
      const comment = created.json<CommentDto>();
      expect(comment.body).toBe(`Hello on ${t.kind}`);
      expect(comment.author?.id).toBe(owner.userId);

      const list = await api(ctx.app, 'GET', `/v1/${t.path}/${t.id}/comments`, { session: owner });
      expect(list.statusCode).toBe(200);
      expect(list.json<CommentDto[]>().map((c) => c.id)).toContain(comment.id);

      // A comment.added activity is recorded on the parent chain.
      const commentActivity = await ctx.prisma.activity.findFirst({
        where: { organizationId: orgId, type: 'comment.added' },
        orderBy: { createdAt: 'desc' },
      });
      expect(commentActivity).not.toBeNull();

      const del = await api(ctx.app, 'DELETE', `/v1/${t.path}/${t.id}/comments/${comment.id}`, {
        session: owner,
      });
      expect(del.statusCode, `${t.kind} delete`).toBe(204);
      const after = await api(ctx.app, 'GET', `/v1/${t.path}/${t.id}/comments`, { session: owner });
      expect(after.json<CommentDto[]>().map((c) => c.id)).not.toContain(comment.id);
    }
  });

  it('an author can delete their own comment; a non-author reader cannot (403)', async () => {
    // EMPLOYEE holds tasks.manage, so can author a task comment. READONLY can
    // read the task but is neither author nor manager, so cannot delete it.
    const employee = await addMemberViaInvitation(ctx, owner, 'employee@example.com', 'EMPLOYEE');
    const readonly = await addMemberViaInvitation(ctx, owner, 'readonly@example.com', 'READONLY');
    const task = await createTaskViaApi(ctx, owner, { title: 'Shared Task' });

    const created = await api(ctx.app, 'POST', `/v1/tasks/${task.id}/comments`, {
      session: employee,
      body: { body: 'authored by employee' },
    });
    expect(created.statusCode).toBe(201);
    const commentId = created.json<CommentDto>().id;

    // Non-author reader is forbidden (author check fails, no tasks.manage... it
    // actually has tasks.read only -> 403 from the authorship guard).
    const readonlyDelete = await api(
      ctx.app,
      'DELETE',
      `/v1/tasks/${task.id}/comments/${commentId}`,
      { session: readonly },
    );
    expect(readonlyDelete.statusCode).toBe(403);
    expect(await ctx.prisma.comment.count({ where: { id: commentId } })).toBe(1);

    // The author deletes their own comment successfully.
    const authorDelete = await api(
      ctx.app,
      'DELETE',
      `/v1/tasks/${task.id}/comments/${commentId}`,
      { session: employee },
    );
    expect(authorDelete.statusCode).toBe(204);
    expect(await ctx.prisma.comment.count({ where: { id: commentId } })).toBe(0);
  });

  it("a manager (non-author) can delete another member's comment via the manage branch", async () => {
    const employee = await addMemberViaInvitation(ctx, owner, 'employee2@example.com', 'EMPLOYEE');
    const task = await createTaskViaApi(ctx, owner, { title: 'Manager Deletes' });
    const created = await api(ctx.app, 'POST', `/v1/tasks/${task.id}/comments`, {
      session: employee,
      body: { body: 'employee note' },
    });
    const commentId = created.json<CommentDto>().id;

    // Owner is not the author but holds tasks.manage.
    const del = await api(ctx.app, 'DELETE', `/v1/tasks/${task.id}/comments/${commentId}`, {
      session: owner,
    });
    expect(del.statusCode).toBe(204);
  });

  it('rejects an empty comment body (400)', async () => {
    const customer = await createCustomerViaApi(ctx, owner, { name: 'Validation' });
    const response = await api(ctx.app, 'POST', `/v1/customers/${customer.id}/comments`, {
      session: owner,
      body: { body: '   ' },
    });
    expect(response.statusCode).toBe(400);
  });
});

describe('attachments', () => {
  let owner: Actor;

  beforeEach(async () => {
    await truncateAll(ctx.prisma);
    owner = await createUser(ctx.app, 'owner@example.com');
    await createOrgViaApi(ctx.app, owner, 'Acme AB');
  });

  it('rejects a disallowed mimetype with 400 unsupported_type (no MinIO needed)', async () => {
    const customer = await createCustomerViaApi(ctx, owner, { name: 'Attach Validation' });
    const response = await uploadAttachmentViaApi(ctx.app, owner, 'customer', customer.id, {
      filename: 'evil.exe',
      contentType: 'application/x-msdownload',
      content: Buffer.from('MZ'),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('unsupported_type');
    expect(await ctx.prisma.fileAttachment.count()).toBe(0);
  });

  // Oversized uploads are truncated by @fastify/multipart (throwFileSizeLimit:
  // false) so the route's own guard reports a clean 400 file_too_large.
  it('rejects an oversized file with 400 file_too_large', async () => {
    const customer = await createCustomerViaApi(ctx, owner, { name: 'Big File' });
    const oversized = Buffer.alloc(MAX_ATTACHMENT_BYTES + 1024, 0x61);
    const response = await uploadAttachmentViaApi(ctx.app, owner, 'customer', customer.id, {
      filename: 'huge.txt',
      contentType: 'text/plain',
      content: oversized,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('file_too_large');
    expect(await ctx.prisma.fileAttachment.count()).toBe(0);
  });

  it('rejects a request with no file part (400 no_file, no MinIO needed)', async () => {
    const customer = await createCustomerViaApi(ctx, owner, { name: 'No File' });
    const boundary = '----BusinessOSEmpty';
    const response = await ctx.app.inject({
      method: 'POST',
      url: `/v1/customers/${customer.id}/attachments`,
      headers: {
        origin: 'http://localhost:3100',
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      cookies: { bos_session: owner.cookie },
      payload: Buffer.from(`--${boundary}--\r\n`),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('no_file');
  });

  // The happy path exercises the real MinIO/S3 backend configured in testConfig
  // (localhost:9000, bucket 'businessos'). If MinIO is unavailable the put()
  // call fails and this test surfaces it.
  it('uploads a valid file, returns a signed download url, then deletes (204)', async () => {
    expect(ALLOWED_ATTACHMENT_TYPES).toContain('text/plain');
    const task = await createTaskViaApi(ctx, owner, { title: 'With Attachment' });

    const upload = await uploadAttachmentViaApi(ctx.app, owner, 'task', task.id, {
      filename: 'note.txt',
      contentType: 'text/plain',
      content: Buffer.from('hello businessos'),
    });
    expect(upload.statusCode, upload.body).toBe(201);
    const attachment = upload.json<AttachmentDto>();
    expect(attachment).toMatchObject({
      fileName: 'note.txt',
      contentType: 'text/plain',
      size: Buffer.from('hello businessos').byteLength,
    });
    expect(attachment.uploadedBy?.id).toBe(owner.userId);

    const list = await api(ctx.app, 'GET', `/v1/tasks/${task.id}/attachments`, { session: owner });
    expect(list.statusCode).toBe(200);
    expect(list.json<AttachmentDto[]>().map((a) => a.id)).toContain(attachment.id);

    const download = await api(
      ctx.app,
      'GET',
      `/v1/tasks/${task.id}/attachments/${attachment.id}/download-url`,
      { session: owner },
    );
    expect(download.statusCode).toBe(200);
    const signed = download.json<AttachmentDownloadDto>();
    expect(signed.url).toMatch(/^https?:\/\//);
    expect(signed.expiresInSeconds).toBeGreaterThan(0);

    const del = await api(ctx.app, 'DELETE', `/v1/tasks/${task.id}/attachments/${attachment.id}`, {
      session: owner,
    });
    expect(del.statusCode).toBe(204);
    expect(await ctx.prisma.fileAttachment.count({ where: { id: attachment.id } })).toBe(0);
  });
});
