import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type {
  AttachmentDownloadDto,
  CustomerDto,
  InvoiceDto,
  Paginated,
  ProjectDto,
  RecordingDto,
  TaskDto,
} from '@businessos/types';
import {
  api,
  createCallLogViaApi,
  createCustomerViaApi,
  createOrgViaApi,
  createProjectViaApi,
  createTestContext,
  createUser,
  createVoiceNoteViaApi,
  destroyTestContext,
  errorCode,
  truncateAll,
  uploadVoiceNoteViaApi,
  WEB_ORIGIN,
  SESSION_COOKIE,
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

/** Counts outbox rows of a given type (the transcription pipeline seam). */
async function outboxCount(type: string): Promise<number> {
  return ctx.prisma.outboxMessage.count({ where: { type } });
}

describe('recordings (Phase 8)', () => {
  let owner: Actor;
  let orgId: string;
  let customer: CustomerDto;
  let project: ProjectDto;

  beforeEach(async () => {
    await truncateAll(ctx.prisma);
    owner = await createUser(ctx.app, `p8-owner-${Date.now()}@test.local`);
    orgId = (await createOrgViaApi(ctx.app, owner, 'Voice Notes AB')).id;
    customer = await createCustomerViaApi(ctx, owner);
    project = await createProjectViaApi(ctx, owner);
  });

  // --- Upload -----------------------------------------------------------------

  describe('voice-note upload', () => {
    it('uploads a voice note, queues transcription, and writes a recording.uploaded outbox row', async () => {
      const res = await uploadVoiceNoteViaApi(ctx.app, owner, {
        title: 'Site visit notes',
        durationSeconds: 42,
      });
      expect(res.statusCode).toBe(201);
      const rec = res.json<RecordingDto>();
      expect(rec.source).toBe('VOICE_NOTE');
      expect(rec.title).toBe('Site visit notes');
      expect(rec.status).toBe('UPLOADED');
      expect(rec.transcriptStatus).toBe('PENDING');
      expect(rec.hasAudio).toBe(true);
      expect(rec.durationSeconds).toBe(42);
      expect(rec.sizeBytes).toBeGreaterThan(0);
      expect(rec.contentType).toBe('audio/webm');
      // Never leak the storage key; only the derived flag is exposed.
      expect(rec).not.toHaveProperty('storageKey');
      expect(rec.segments).toEqual([]);

      // The transactional-outbox row is the seam the worker consumes.
      const rows = await ctx.prisma.outboxMessage.findMany({
        where: { type: 'recording.uploaded' },
      });
      expect(rows).toHaveLength(1);
      const payload = rows[0]!.payload as { recordingId: string; organizationId: string };
      expect(payload.recordingId).toBe(rec.id);
      expect(payload.organizationId).toBe(orgId);

      // The row is persisted in this org and still PENDING (no relay runs in-process).
      const row = await ctx.prisma.recording.findUniqueOrThrow({ where: { id: rec.id } });
      expect(row.organizationId).toBe(orgId);
      expect(row.transcriptStatus).toBe('PENDING');
      expect(row.storageKey).not.toBeNull();
    });

    it('inherits and validates business links on upload', async () => {
      const rec = await createVoiceNoteViaApi(ctx.app, owner, {
        customerId: customer.id,
        projectId: project.id,
      });
      expect(rec.customerId).toBe(customer.id);
      expect(rec.projectId).toBe(project.id);
    });

    it('rejects an unsupported content type (400 unsupported_type)', async () => {
      const res = await uploadVoiceNoteViaApi(ctx.app, owner, {
        contentType: 'text/plain',
        filename: 'note.txt',
      });
      expect(res.statusCode).toBe(400);
      expect(errorCode(res.body)).toBe('unsupported_type');
      // Nothing was persisted and no transcription was queued.
      expect(await ctx.prisma.recording.count({ where: { organizationId: orgId } })).toBe(0);
      expect(await outboxCount('recording.uploaded')).toBe(0);
    });

    it('rejects a multipart request with no file part (400 no_file)', async () => {
      const boundary = '----BusinessOSNoFile';
      const payload = Buffer.from(
        `--${boundary}\r\n` +
          'Content-Disposition: form-data; name="notafile"\r\n\r\n' +
          'just a field\r\n' +
          `--${boundary}--\r\n`,
      );
      const res = await ctx.app.inject({
        method: 'POST',
        url: '/v1/recordings/voice-notes?title=Empty',
        headers: {
          origin: WEB_ORIGIN,
          'content-type': `multipart/form-data; boundary=${boundary}`,
        },
        cookies: { [SESSION_COOKIE]: owner.cookie },
        payload,
      });
      expect(res.statusCode).toBe(400);
      expect(errorCode(res.body)).toBe('no_file');
    });
  });

  // --- Call logs --------------------------------------------------------------

  describe('call logs', () => {
    it('creates a call log with no audio and nothing to transcribe', async () => {
      const res = await api(ctx.app, 'POST', '/v1/recordings/call-logs', {
        session: owner,
        body: {
          title: 'Customer called about invoice',
          direction: 'INBOUND',
          fromNumber: '+46701234567',
          durationSeconds: 130,
          notes: 'Wants a copy of last month invoice.',
          customerId: customer.id,
        },
      });
      expect(res.statusCode).toBe(201);
      const rec = res.json<RecordingDto>();
      expect(rec.source).toBe('CALL');
      expect(rec.hasAudio).toBe(false);
      expect(rec.transcriptStatus).toBe('NONE');
      expect(rec.direction).toBe('INBOUND');
      expect(rec.fromNumber).toBe('+46701234567');
      // Notes seed the transcript text so call logs are searchable/convertible.
      expect(rec.transcriptText).toBe('Wants a copy of last month invoice.');
      expect(rec.customerId).toBe(customer.id);
      // A call log never queues transcription.
      expect(await outboxCount('recording.uploaded')).toBe(0);
    });
  });

  // --- Detail / update / delete ----------------------------------------------

  describe('detail, update, delete', () => {
    it('returns detail with transcript segments', async () => {
      const rec = await createVoiceNoteViaApi(ctx.app, owner, { title: 'With segments' });
      // Seed segments directly (transcription runs in the worker, not in-process).
      await ctx.prisma.transcriptSegment.createMany({
        data: [
          { organizationId: orgId, recordingId: rec.id, startMs: 0, endMs: 2000, text: 'Hello there.', sortOrder: 0 },
          { organizationId: orgId, recordingId: rec.id, startMs: 2000, endMs: 4000, text: 'Second part.', sortOrder: 1 },
        ],
      });
      const res = await api(ctx.app, 'GET', `/v1/recordings/${rec.id}`, { session: owner });
      expect(res.statusCode).toBe(200);
      const detail = res.json<RecordingDto>();
      expect(detail.segments).toHaveLength(2);
      expect(detail.segments.map((s) => s.text)).toEqual(['Hello there.', 'Second part.']);
      // Ordered by sortOrder.
      expect(detail.segments[0]!.sortOrder).toBe(0);
      expect(detail.segments[1]!.startMs).toBe(2000);
    });

    it('updates title, links a customer, and unlinks it via null', async () => {
      const rec = await createVoiceNoteViaApi(ctx.app, owner, { title: 'Draft title' });

      const renamed = await api(ctx.app, 'PATCH', `/v1/recordings/${rec.id}`, {
        session: owner,
        body: { title: 'Final title', customerId: customer.id },
      });
      expect(renamed.statusCode).toBe(200);
      expect(renamed.json<RecordingDto>().title).toBe('Final title');
      expect(renamed.json<RecordingDto>().customerId).toBe(customer.id);

      const unlinked = await api(ctx.app, 'PATCH', `/v1/recordings/${rec.id}`, {
        session: owner,
        body: { customerId: null },
      });
      expect(unlinked.statusCode).toBe(200);
      expect(unlinked.json<RecordingDto>().customerId).toBeNull();
    });

    it('rejects an empty PATCH (400 validation_error — "Nothing to update")', async () => {
      const rec = await createVoiceNoteViaApi(ctx.app, owner);
      const res = await api(ctx.app, 'PATCH', `/v1/recordings/${rec.id}`, {
        session: owner,
        body: {},
      });
      expect(res.statusCode).toBe(400);
      expect(errorCode(res.body)).toBe('validation_error');
    });

    it('rejects linking a customer from another org (400 unknown_customer)', async () => {
      const stranger = await createUser(ctx.app, `p8-stranger-${Date.now()}@test.local`);
      await createOrgViaApi(ctx.app, stranger, 'Stranger AB');
      const foreign = await createCustomerViaApi(ctx, stranger);
      const rec = await createVoiceNoteViaApi(ctx.app, owner);
      const res = await api(ctx.app, 'PATCH', `/v1/recordings/${rec.id}`, {
        session: owner,
        body: { customerId: foreign.id },
      });
      expect(res.statusCode).toBe(400);
      expect(errorCode(res.body)).toBe('unknown_customer');
    });

    it('deletes a recording (204) then GET is 404', async () => {
      const rec = await createVoiceNoteViaApi(ctx.app, owner);
      const del = await api(ctx.app, 'DELETE', `/v1/recordings/${rec.id}`, { session: owner });
      expect(del.statusCode).toBe(204);
      const get = await api(ctx.app, 'GET', `/v1/recordings/${rec.id}`, { session: owner });
      expect(get.statusCode).toBe(404);
      expect(await ctx.prisma.recording.count({ where: { id: rec.id } })).toBe(0);
    });
  });

  // --- Audio download ---------------------------------------------------------

  describe('audio download', () => {
    it('returns a signed URL for a voice note', async () => {
      const rec = await createVoiceNoteViaApi(ctx.app, owner);
      const res = await api(ctx.app, 'GET', `/v1/recordings/${rec.id}/audio`, { session: owner });
      expect(res.statusCode).toBe(200);
      const dto = res.json<AttachmentDownloadDto>();
      expect(dto.url).toMatch(/^https?:\/\//);
      expect(dto.expiresInSeconds).toBeGreaterThan(0);
    });

    it('rejects download for a call log with no audio (400 no_audio)', async () => {
      const call = await createCallLogViaApi(ctx, owner);
      const res = await api(ctx.app, 'GET', `/v1/recordings/${call.id}/audio`, { session: owner });
      expect(res.statusCode).toBe(400);
      expect(errorCode(res.body)).toBe('no_audio');
    });
  });

  // --- Retranscribe -----------------------------------------------------------

  describe('retranscribe', () => {
    it('re-queues a voice note and writes a fresh outbox row', async () => {
      const rec = await createVoiceNoteViaApi(ctx.app, owner);
      expect(await outboxCount('recording.uploaded')).toBe(1);
      // Simulate the worker having completed the first pass.
      await ctx.prisma.recording.update({
        where: { id: rec.id },
        data: { status: 'TRANSCRIBED', transcriptStatus: 'COMPLETED', transcriptText: 'done' },
      });

      const res = await api(ctx.app, 'POST', `/v1/recordings/${rec.id}/retranscribe`, {
        session: owner,
      });
      expect(res.statusCode).toBe(200);
      const dto = res.json<RecordingDto>();
      expect(dto.status).toBe('UPLOADED');
      expect(dto.transcriptStatus).toBe('PENDING');
      // A fresh outbox row (new envelope id) means the consumer's idempotency
      // ledger does not suppress the re-run.
      expect(await outboxCount('recording.uploaded')).toBe(2);
    });

    it('rejects retranscribe on a call log with no audio (400 no_audio)', async () => {
      const call = await createCallLogViaApi(ctx, owner);
      const res = await api(ctx.app, 'POST', `/v1/recordings/${call.id}/retranscribe`, {
        session: owner,
      });
      expect(res.statusCode).toBe(400);
      expect(errorCode(res.body)).toBe('no_audio');
    });
  });

  // --- List / search / filter / paginate -------------------------------------

  describe('list, search, filter, paginate', () => {
    it('searches by title', async () => {
      await createVoiceNoteViaApi(ctx.app, owner, { title: 'Gearbox inspection' });
      await createVoiceNoteViaApi(ctx.app, owner, { title: 'Paint order' });

      const res = await api(ctx.app, 'GET', '/v1/recordings?search=gearbox', { session: owner });
      expect(res.statusCode).toBe(200);
      const page = res.json<Paginated<RecordingDto>>();
      expect(page.items).toHaveLength(1);
      expect(page.items[0]!.title).toBe('Gearbox inspection');
    });

    it('searches by transcript text', async () => {
      const rec = await createVoiceNoteViaApi(ctx.app, owner, { title: 'Untitled note' });
      await ctx.prisma.recording.update({
        where: { id: rec.id },
        data: { transcriptText: 'Please confirm the crankshaft measurements.' },
      });
      // A call log whose notes seed transcript text is searchable the same way.
      await createCallLogViaApi(ctx, owner, { title: 'Random call', notes: 'unrelated content' });

      const res = await api(ctx.app, 'GET', '/v1/recordings?search=crankshaft', { session: owner });
      const page = res.json<Paginated<RecordingDto>>();
      expect(page.items.map((r) => r.id)).toEqual([rec.id]);
    });

    it('filters by source=CALL', async () => {
      await createVoiceNoteViaApi(ctx.app, owner);
      await createVoiceNoteViaApi(ctx.app, owner);
      const call = await createCallLogViaApi(ctx, owner);

      const res = await api(ctx.app, 'GET', '/v1/recordings?source=CALL', { session: owner });
      const page = res.json<Paginated<RecordingDto>>();
      expect(page.items).toHaveLength(1);
      expect(page.items[0]!.id).toBe(call.id);
      expect(page.items.every((r) => r.source === 'CALL')).toBe(true);
    });

    it('paginates with a stable envelope shape', async () => {
      for (let i = 0; i < 3; i += 1) await createVoiceNoteViaApi(ctx.app, owner);

      const res = await api(ctx.app, 'GET', '/v1/recordings?page=1&pageSize=2', { session: owner });
      const page = res.json<Paginated<RecordingDto>>();
      expect(page.page).toBe(1);
      expect(page.pageSize).toBe(2);
      expect(page.totalItems).toBe(3);
      expect(page.totalPages).toBe(2);
      expect(page.items).toHaveLength(2);

      const p2 = await api(ctx.app, 'GET', '/v1/recordings?page=2&pageSize=2', { session: owner });
      expect(p2.json<Paginated<RecordingDto>>().items).toHaveLength(1);
    });

    it('list rows omit transcript segments (detail-only join)', async () => {
      const rec = await createVoiceNoteViaApi(ctx.app, owner);
      await ctx.prisma.transcriptSegment.create({
        data: { organizationId: orgId, recordingId: rec.id, startMs: 0, endMs: 1000, text: 'x', sortOrder: 0 },
      });
      const res = await api(ctx.app, 'GET', '/v1/recordings', { session: owner });
      const page = res.json<Paginated<RecordingDto>>();
      expect(page.items[0]!.segments).toEqual([]);
    });
  });

  // --- Convert to a task ------------------------------------------------------

  describe('convert to task', () => {
    it('creates a task, back-links the recording, and inherits customer/project', async () => {
      const rec = await createVoiceNoteViaApi(ctx.app, owner, {
        title: 'Follow up with customer',
        customerId: customer.id,
        projectId: project.id,
      });
      // Give it a transcript so the task description is derived from it.
      await ctx.prisma.recording.update({
        where: { id: rec.id },
        data: { transcriptText: '  Call   the customer   back tomorrow.  ' },
      });

      const res = await api(ctx.app, 'POST', `/v1/recordings/${rec.id}/task`, {
        session: owner,
        body: {},
      });
      expect(res.statusCode).toBe(201);
      const task = res.json<TaskDto>();
      expect(task.title).toBe('Follow up with customer');
      // transcriptSnippet collapses whitespace.
      expect(task.description).toBe('Call the customer back tomorrow.');
      expect(task.customer?.id).toBe(customer.id);
      expect(task.project?.id).toBe(project.id);

      // The recording now back-links the task it produced.
      const detail = await api(ctx.app, 'GET', `/v1/recordings/${rec.id}`, { session: owner });
      expect(detail.json<RecordingDto>().taskId).toBe(task.id);
    });

    it('accepts an explicit title and due date', async () => {
      const rec = await createVoiceNoteViaApi(ctx.app, owner);
      const res = await api(ctx.app, 'POST', `/v1/recordings/${rec.id}/task`, {
        session: owner,
        body: { title: 'Explicit task title', dueDate: '2026-09-01T09:00:00.000Z' },
      });
      expect(res.statusCode).toBe(201);
      const task = res.json<TaskDto>();
      expect(task.title).toBe('Explicit task title');
      expect(task.dueDate).toBe('2026-09-01T09:00:00.000Z');
    });

    it('refuses to convert a recording already linked to a task (no silent clobber)', async () => {
      const rec = await createVoiceNoteViaApi(ctx.app, owner);
      const first = await api(ctx.app, 'POST', `/v1/recordings/${rec.id}/task`, {
        session: owner,
        body: {},
      });
      expect(first.statusCode).toBe(201);
      const firstTaskId = first.json<TaskDto>().id;

      const again = await api(ctx.app, 'POST', `/v1/recordings/${rec.id}/task`, {
        session: owner,
        body: {},
      });
      expect(again.statusCode).toBe(409);
      expect(errorCode(again.body)).toBe('already_linked_to_task');

      // The original link is preserved — nothing was overwritten.
      const detail = await api(ctx.app, 'GET', `/v1/recordings/${rec.id}`, { session: owner });
      expect(detail.json<RecordingDto>().taskId).toBe(firstTaskId);
    });
  });

  // --- Convert to a DRAFT invoice --------------------------------------------

  describe('convert to invoice', () => {
    it('refuses to invoice a recording with no linked customer (400 no_customer)', async () => {
      const rec = await createVoiceNoteViaApi(ctx.app, owner);
      const res = await api(ctx.app, 'POST', `/v1/recordings/${rec.id}/invoice`, {
        session: owner,
        body: { unitPriceMinor: 150000, quantity: 2, taxRatePercent: 25 },
      });
      expect(res.statusCode).toBe(400);
      expect(errorCode(res.body)).toBe('no_customer');
    });

    it('creates a DRAFT invoice with correct money once a customer is linked', async () => {
      const rec = await createVoiceNoteViaApi(ctx.app, owner, { customerId: customer.id });
      const res = await api(ctx.app, 'POST', `/v1/recordings/${rec.id}/invoice`, {
        session: owner,
        body: { description: 'On-site consultation', unitPriceMinor: 150000, quantity: 2, taxRatePercent: 25 },
      });
      expect(res.statusCode).toBe(201);
      const invoice = res.json<InvoiceDto>();
      expect(invoice.status).toBe('DRAFT');
      expect(invoice.customer.id).toBe(customer.id);
      // 150000 * 2 = 300000 net; 25% tax = 75000; total = 375000.
      expect(invoice.subtotalMinor).toBe(300000);
      expect(invoice.taxMinor).toBe(75000);
      expect(invoice.totalMinor).toBe(375000);
      expect(invoice.lineItems).toHaveLength(1);
      const line = invoice.lineItems[0]!;
      expect(line.description).toBe('On-site consultation');
      expect(line.unitPriceMinor).toBe(150000);
      expect(line.quantity).toBe(2);
      expect(line.taxRatePercent).toBe(25);
      expect(line.lineTotalMinor).toBe(375000);
    });
  });

  // --- Not found --------------------------------------------------------------

  it('returns 404 for an unknown recording id', async () => {
    const unknown = '00000000-0000-0000-0000-000000000000';
    const res = await api(ctx.app, 'GET', `/v1/recordings/${unknown}`, { session: owner });
    expect(res.statusCode).toBe(404);
  });
});
