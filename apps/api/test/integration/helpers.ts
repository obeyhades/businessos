import { createPrismaClient, type PrismaClient } from '@businessos/db';
import type {
  AccountDto,
  AssignableRole,
  CalendarDto,
  ContactDto,
  CreateAccountBody,
  CreateCalendarBody,
  CreateContactBody,
  CreateCustomerBody,
  CreateEmployeeBody,
  CreateFiscalYearBody,
  CreateInvoiceBody,
  CreateEmailAccountBody,
  CreateEmailLabelBody,
  CreateMessageBody,
  CreateProductBody,
  CreateProjectBody,
  CreateQuoteBody,
  CreateTaskBody,
  CreateTemplateBody,
  CustomerDto,
  EmailAccountDto,
  EmailLabelDto,
  EmailMessageDto,
  EmailThreadDetailDto,
  EmployeeDto,
  EntityKind,
  EventDto,
  EventStatus,
  EventVisibility,
  FiscalYearDto,
  InvitationDto,
  InvoiceDto,
  LineItemInput,
  OnboardingTemplateDto,
  OrganizationDto,
  ProductDto,
  ProjectDto,
  QuoteDto,
  RecordingDto,
  RecurrenceFreq,
  SessionDto,
  TaskDto,
  VoucherDto,
  VoucherLineInput,
} from '@businessos/types';
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import { buildApp } from '../../src/app.js';
import type { ApiConfig } from '../../src/config.js';

export const TEST_DATABASE_URL =
  process.env.DATABASE_URL_TEST ??
  'postgresql://businessos:businessos@localhost:5432/businessos_test';

export const WEB_ORIGIN = 'http://localhost:3100';
export const SESSION_COOKIE = 'bos_session';
export const DEFAULT_PASSWORD = 'Sup3rSecret!Pass';

export const testConfig: ApiConfig = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'error',
  API_PORT: 3101,
  API_HOST: '127.0.0.1',
  DATABASE_URL: TEST_DATABASE_URL,
  SESSION_SECRET: 'integration-test-only-secret-0123456789-abcdefghij',
  WEB_ORIGIN,
  APP_BASE_URL: WEB_ORIGIN,
  S3_ENDPOINT: process.env.S3_ENDPOINT ?? 'http://localhost:9000',
  S3_ACCESS_KEY: process.env.S3_ACCESS_KEY ?? 'businessos',
  S3_SECRET_KEY: process.env.S3_SECRET_KEY ?? 'businessos-dev-secret',
  S3_BUCKET: process.env.S3_BUCKET ?? 'businessos',
  S3_REGION: process.env.S3_REGION ?? 'us-east-1',
  INBOUND_EMAIL_SECRET: 'test-inbound-secret',
};

export interface TestContext {
  app: FastifyInstance;
  prisma: PrismaClient;
}

export async function createTestContext(): Promise<TestContext> {
  const prisma = createPrismaClient({ databaseUrl: TEST_DATABASE_URL });
  const app = await buildApp({ config: testConfig, prisma, logger: false });
  await app.ready();
  return { app, prisma };
}

/** app.close() also disconnects prisma via the app's onClose hook. */
export async function destroyTestContext(ctx: TestContext): Promise<void> {
  await ctx.app.close();
}

const ALL_TABLES = [
  'users',
  'organizations',
  'organization_members',
  'sessions',
  'invitations',
  'password_reset_tokens',
  'audit_logs',
  'outbox_messages',
  'processed_messages',
  'failed_jobs',
  // Phase 2 tables. Truncating customers/organizations already cascades to the
  // children, but they are listed explicitly so the reset is obvious and order
  // independent (CASCADE covers the FKs either way).
  'activities',
  'file_attachments',
  'comments',
  'tasks',
  'projects',
  'customer_contacts',
  'customers',
  // Phase 3 personnel tables. Truncating employees/onboarding_templates already
  // cascades to their children, but every table is listed explicitly so the
  // reset is order independent and obvious.
  'employee_notes',
  'certifications',
  'absence_requests',
  'employee_documents',
  'onboarding_template_items',
  'onboarding_templates',
  'employees',
  // Phase 4 billing tables. Children are listed before parents and the sequence
  // table is included so document numbers restart from 1 between tests; CASCADE
  // makes the order redundant but the intent is explicit.
  'number_sequences',
  'credit_note_line_items',
  'credit_notes',
  'payments',
  'invoice_line_items',
  'invoices',
  'quote_line_items',
  'quotes',
  'products',
];

export async function truncateAll(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${ALL_TABLES.join(', ')} CASCADE`);
}

// Every request gets its own client IP so the per-IP rate limits on the auth
// routes never interfere with test volume.
let ipCounter = 0;
function nextIp(): string {
  ipCounter += 1;
  return `10.${(ipCounter >> 16) & 255}.${(ipCounter >> 8) & 255}.${ipCounter & 255}`;
}

export interface Actor {
  cookie: string;
  userId: string;
  email: string;
}

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
const UNSAFE_METHODS = new Set<Method>(['POST', 'PATCH', 'PUT', 'DELETE']);

export interface ApiRequestOptions {
  session?: Actor;
  body?: unknown;
  /**
   * Origin header control: undefined sends WEB_ORIGIN on unsafe methods
   * (matching a browser + satisfying the CSRF check), null omits the header,
   * a string sends that exact value.
   */
  origin?: string | null;
}

export async function api(
  app: FastifyInstance,
  method: Method,
  url: string,
  options: ApiRequestOptions = {},
): Promise<LightMyRequestResponse> {
  const headers: Record<string, string> = {};
  if (options.origin !== null) {
    const origin = options.origin ?? (UNSAFE_METHODS.has(method) ? WEB_ORIGIN : undefined);
    if (origin !== undefined) headers.origin = origin;
  }
  const inject: InjectOptions = {
    method,
    url,
    headers,
    remoteAddress: nextIp(),
  };
  if (options.body !== undefined) inject.payload = options.body as InjectOptions['payload'];
  if (options.session) inject.cookies = { [SESSION_COOKIE]: options.session.cookie };
  return app.inject(inject);
}

export function sessionCookieFrom(response: LightMyRequestResponse): string {
  const cookie = response.cookies.find((c) => c.name === SESSION_COOKIE);
  if (!cookie || !cookie.value) {
    throw new Error(`Expected a ${SESSION_COOKIE} cookie on the response`);
  }
  return cookie.value;
}

function expectStatus(response: LightMyRequestResponse, expected: number, action: string): void {
  if (response.statusCode !== expected) {
    throw new Error(
      `${action} returned ${response.statusCode}, expected ${expected}: ${response.body}`,
    );
  }
}

/** Registers a fresh user through the API; the returned cookie is a live session. */
export async function createUser(
  app: FastifyInstance,
  email: string,
  password: string = DEFAULT_PASSWORD,
  name = 'Test User',
): Promise<Actor> {
  const response = await api(app, 'POST', '/v1/auth/register', {
    body: { email, password, name },
  });
  expectStatus(response, 201, `register ${email}`);
  const session = response.json<SessionDto>();
  return { cookie: sessionCookieFrom(response), userId: session.user.id, email };
}

export async function login(
  app: FastifyInstance,
  email: string,
  password: string = DEFAULT_PASSWORD,
): Promise<Actor> {
  const response = await api(app, 'POST', '/v1/auth/login', { body: { email, password } });
  expectStatus(response, 200, `login ${email}`);
  const session = response.json<SessionDto>();
  return { cookie: sessionCookieFrom(response), userId: session.user.id, email };
}

/** Creates an organization; the actor's session becomes active in it server-side. */
export async function createOrgViaApi(
  app: FastifyInstance,
  actor: Actor,
  name: string,
): Promise<OrganizationDto> {
  const response = await api(app, 'POST', '/v1/organizations', {
    session: actor,
    body: { name },
  });
  expectStatus(response, 201, `create organization ${name}`);
  return response.json<OrganizationDto>();
}

interface EmailPayload {
  kind?: string;
  to?: string;
  text?: string;
}

/**
 * The DB only stores the invitation token's hash; the raw token exists solely
 * in the emailed link, which lands in the transactional outbox. Reading it
 * from there is both the only way to get it and proof of the outbox write.
 */
export async function rawTokenFromOutbox(
  prisma: PrismaClient,
  kind: 'invitation' | 'password_reset',
  to: string,
): Promise<string> {
  const rows = await prisma.outboxMessage.findMany({
    where: { type: 'email.send' },
    orderBy: { occurredAt: 'desc' },
  });
  for (const row of rows) {
    const payload = row.payload as EmailPayload;
    if (payload.kind === kind && payload.to === to && payload.text) {
      const token = /token=([A-Za-z0-9_-]+)/.exec(payload.text)?.[1];
      if (token) return token;
    }
  }
  throw new Error(`No ${kind} email for ${to} found in outbox_messages`);
}

export interface InvitationWithToken {
  invitation: InvitationDto;
  token: string;
}

export async function inviteViaApi(
  ctx: TestContext,
  inviter: Actor,
  email: string,
  role: AssignableRole,
): Promise<InvitationWithToken> {
  const response = await api(ctx.app, 'POST', '/v1/organizations/current/invitations', {
    session: inviter,
    body: { email, role },
  });
  expectStatus(response, 201, `invite ${email} as ${role}`);
  const token = await rawTokenFromOutbox(ctx.prisma, 'invitation', email);
  return { invitation: response.json<InvitationDto>(), token };
}

export async function acceptInvitation(
  app: FastifyInstance,
  actor: Actor,
  token: string,
): Promise<LightMyRequestResponse> {
  return api(app, 'POST', `/v1/invitations/${token}/accept`, { session: actor });
}

/** Full flow: invite, register the invitee, accept. Returns the member's live session. */
export async function addMemberViaInvitation(
  ctx: TestContext,
  inviter: Actor,
  email: string,
  role: AssignableRole,
): Promise<Actor> {
  const { token } = await inviteViaApi(ctx, inviter, email, role);
  const member = await createUser(ctx.app, email);
  const response = await acceptInvitation(ctx.app, member, token);
  expectStatus(response, 200, `accept invitation for ${email}`);
  return member;
}

// --- Phase 2 factories -----------------------------------------------------

let seq = 0;
function nextSeq(): number {
  seq += 1;
  return seq;
}

/** Maps an entity kind to its plural REST path segment (mirrors the api-client). */
export const KIND_PATH: Record<EntityKind, 'customers' | 'projects' | 'tasks'> = {
  customer: 'customers',
  project: 'projects',
  task: 'tasks',
};

/** Creates a customer through the API using the actor's active organization. */
export async function createCustomerViaApi(
  ctx: TestContext,
  session: Actor,
  overrides: Partial<CreateCustomerBody> = {},
): Promise<CustomerDto> {
  const response = await api(ctx.app, 'POST', '/v1/customers', {
    session,
    body: { name: `Customer ${nextSeq()}`, ...overrides },
  });
  expectStatus(response, 201, 'create customer');
  return response.json<CustomerDto>();
}

/** Creates a project through the API using the actor's active organization. */
export async function createProjectViaApi(
  ctx: TestContext,
  session: Actor,
  overrides: Partial<CreateProjectBody> = {},
): Promise<ProjectDto> {
  const response = await api(ctx.app, 'POST', '/v1/projects', {
    session,
    body: { name: `Project ${nextSeq()}`, ...overrides },
  });
  expectStatus(response, 201, 'create project');
  return response.json<ProjectDto>();
}

/** Creates a task through the API using the actor's active organization. */
export async function createTaskViaApi(
  ctx: TestContext,
  session: Actor,
  overrides: Partial<CreateTaskBody> = {},
): Promise<TaskDto> {
  const response = await api(ctx.app, 'POST', '/v1/tasks', {
    session,
    body: { title: `Task ${nextSeq()}`, ...overrides },
  });
  expectStatus(response, 201, 'create task');
  return response.json<TaskDto>();
}

/** Adds a contact to a customer through the API. */
export async function addContactViaApi(
  ctx: TestContext,
  session: Actor,
  customerId: string,
  overrides: Partial<CreateContactBody> = {},
): Promise<ContactDto> {
  const response = await api(ctx.app, 'POST', `/v1/customers/${customerId}/contacts`, {
    session,
    body: { name: `Contact ${nextSeq()}`, ...overrides },
  });
  expectStatus(response, 201, 'add contact');
  return response.json<ContactDto>();
}

export interface UploadFile {
  filename: string;
  contentType: string;
  content: Buffer;
}

/** Builds a single-part multipart/form-data body (field name 'file'). */
export function buildMultipart(file: UploadFile): { payload: Buffer; contentType: string } {
  const boundary = `----BusinessOSTest${Math.random().toString(16).slice(2)}`;
  const head = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${file.filename}"\r\n` +
      `Content-Type: ${file.contentType}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    payload: Buffer.concat([head, file.content, tail]),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

/**
 * Uploads an attachment to a Phase 2 entity via app.inject with a hand-built
 * multipart body (the JSON api() wrapper can't carry a file part).
 */
export async function uploadAttachmentViaApi(
  app: FastifyInstance,
  session: Actor,
  kind: EntityKind,
  entityId: string,
  file: UploadFile,
): Promise<LightMyRequestResponse> {
  const { payload, contentType } = buildMultipart(file);
  return app.inject({
    method: 'POST',
    url: `/v1/${KIND_PATH[kind]}/${entityId}/attachments`,
    headers: { origin: WEB_ORIGIN, 'content-type': contentType },
    cookies: { [SESSION_COOKIE]: session.cookie },
    remoteAddress: nextIp(),
    payload,
  });
}

// --- Phase 3 factories -----------------------------------------------------

/** Creates an employee through the API using the actor's active organization. */
export async function createEmployeeViaApi(
  ctx: TestContext,
  session: Actor,
  overrides: Partial<CreateEmployeeBody> = {},
): Promise<EmployeeDto> {
  const n = nextSeq();
  const response = await api(ctx.app, 'POST', '/v1/employees', {
    session,
    body: { firstName: 'Emp', lastName: `Employee ${n}`, ...overrides },
  });
  expectStatus(response, 201, 'create employee');
  return response.json<EmployeeDto>();
}

/** Creates an onboarding template (with items) through the API. */
export async function createTemplateViaApi(
  ctx: TestContext,
  session: Actor,
  overrides: Partial<CreateTemplateBody> = {},
): Promise<OnboardingTemplateDto> {
  const response = await api(ctx.app, 'POST', '/v1/onboarding-templates', {
    session,
    body: { name: `Template ${nextSeq()}`, items: [], ...overrides },
  });
  expectStatus(response, 201, 'create onboarding template');
  return response.json<OnboardingTemplateDto>();
}

/**
 * Uploads an employee document via app.inject with a hand-built multipart body.
 * category and sensitive travel as query params (not form fields).
 */
export async function uploadEmployeeDocumentViaApi(
  app: FastifyInstance,
  session: Actor,
  employeeId: string,
  file: UploadFile,
  query: { category?: string; sensitive?: boolean } = {},
): Promise<LightMyRequestResponse> {
  const { payload, contentType } = buildMultipart(file);
  const params = new URLSearchParams();
  if (query.category !== undefined) params.set('category', query.category);
  if (query.sensitive !== undefined) params.set('sensitive', String(query.sensitive));
  const qs = params.toString();
  return app.inject({
    method: 'POST',
    url: `/v1/employees/${employeeId}/documents${qs ? `?${qs}` : ''}`,
    headers: { origin: WEB_ORIGIN, 'content-type': contentType },
    cookies: { [SESSION_COOKIE]: session.cookie },
    remoteAddress: nextIp(),
    payload,
  });
}

// --- Phase 4 (billing) factories -------------------------------------------

/** A fixed issue/due date pair so document dates are deterministic in specs. */
export const ISSUE_DATE = '2026-01-15';
export const DUE_DATE = '2026-02-14';

/** Creates a catalogue product through the API. */
export async function createProductViaApi(
  ctx: TestContext,
  session: Actor,
  overrides: Partial<CreateProductBody> = {},
): Promise<ProductDto> {
  const response = await api(ctx.app, 'POST', '/v1/products', {
    session,
    body: { name: `Product ${nextSeq()}`, ...overrides },
  });
  expectStatus(response, 201, 'create product');
  return response.json<ProductDto>();
}

/** Creates a DRAFT quote through the API. */
export async function createQuoteViaApi(
  ctx: TestContext,
  session: Actor,
  customerId: string,
  lineItems: LineItemInput[],
  overrides: Partial<CreateQuoteBody> = {},
): Promise<QuoteDto> {
  const response = await api(ctx.app, 'POST', '/v1/quotes', {
    session,
    body: { customerId, issueDate: ISSUE_DATE, lineItems, ...overrides },
  });
  expectStatus(response, 201, 'create quote');
  return response.json<QuoteDto>();
}

/** Creates a DRAFT invoice through the API. */
export async function createInvoiceViaApi(
  ctx: TestContext,
  session: Actor,
  customerId: string,
  lineItems: LineItemInput[],
  overrides: Partial<CreateInvoiceBody> = {},
): Promise<InvoiceDto> {
  const response = await api(ctx.app, 'POST', '/v1/invoices', {
    session,
    body: { customerId, issueDate: ISSUE_DATE, dueDate: DUE_DATE, lineItems, ...overrides },
  });
  expectStatus(response, 201, 'create invoice');
  return response.json<InvoiceDto>();
}

/** Finalizes a draft invoice, assigning it a number and freezing it. */
export async function finalizeInvoiceViaApi(
  ctx: TestContext,
  session: Actor,
  invoiceId: string,
): Promise<InvoiceDto> {
  const response = await api(ctx.app, 'POST', `/v1/invoices/${invoiceId}/finalize`, { session });
  expectStatus(response, 200, 'finalize invoice');
  return response.json<InvoiceDto>();
}

// --- Phase 5 (bookkeeping) factories ---------------------------------------

/** Extracts the machine-readable error code from an error-envelope response body. */
export function errorCode(body: string): string {
  return (JSON.parse(body) as { error: { code: string } }).error.code;
}

/**
 * Creates a chart-of-accounts account. Codes are auto-uniquified from a global
 * counter (offset into the 1000-range) unless one is supplied in overrides.
 */
export async function createAccountViaApi(
  ctx: TestContext,
  session: Actor,
  overrides: Partial<CreateAccountBody> = {},
): Promise<AccountDto> {
  const n = nextSeq();
  const response = await api(ctx.app, 'POST', '/v1/accounting/accounts', {
    session,
    body: { code: String(1000 + n), name: `Account ${n}`, type: 'ASSET', ...overrides },
  });
  expectStatus(response, 201, 'create account');
  return response.json<AccountDto>();
}

/** A single debit line for the given account (credit side defaults to 0). */
export function debit(accountId: string, amountMinor: number): VoucherLineInput {
  return { accountId, debitMinor: amountMinor } as VoucherLineInput;
}

/** A single credit line for the given account (debit side defaults to 0). */
export function credit(accountId: string, amountMinor: number): VoucherLineInput {
  return { accountId, creditMinor: amountMinor } as VoucherLineInput;
}

/** Creates a DRAFT voucher with the supplied lines. */
export async function createVoucherViaApi(
  ctx: TestContext,
  session: Actor,
  lines: VoucherLineInput[],
  overrides: Partial<{ date: string; description: string }> = {},
): Promise<VoucherDto> {
  const response = await api(ctx.app, 'POST', '/v1/accounting/vouchers', {
    session,
    body: { date: '2026-06-15', description: `Voucher ${nextSeq()}`, lines, ...overrides },
  });
  expectStatus(response, 201, 'create voucher');
  return response.json<VoucherDto>();
}

/** Posts a draft voucher (draft → posted); returns the response for status checks. */
export async function postVoucherViaApi(
  ctx: TestContext,
  session: Actor,
  voucherId: string,
): Promise<VoucherDto> {
  const response = await api(ctx.app, 'POST', `/v1/accounting/vouchers/${voucherId}/post`, {
    session,
  });
  expectStatus(response, 200, 'post voucher');
  return response.json<VoucherDto>();
}

/**
 * Creates a fiscal year. Defaults to calendar 2026 with auto-generated monthly
 * (OPEN) periods, so a voucher dated in 2026 has a covering, postable period.
 */
export async function createFiscalYearViaApi(
  ctx: TestContext,
  session: Actor,
  overrides: Partial<CreateFiscalYearBody> = {},
): Promise<FiscalYearDto> {
  const response = await api(ctx.app, 'POST', '/v1/accounting/fiscal-years', {
    session,
    body: {
      name: `FY ${nextSeq()}`,
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      generateMonthlyPeriods: true,
      ...overrides,
    },
  });
  expectStatus(response, 201, 'create fiscal year');
  return response.json<FiscalYearDto>();
}

// --- Phase 6 (calendar) factories ------------------------------------------

/**
 * 2026-01-05 is a Monday (UTC), 2026-01-07 a Wednesday. Anchoring event times to
 * these fixed dates keeps weekday-based recurrence assertions stable regardless
 * of when the suite runs. UTC weekday numbers: Sun=0 … Sat=6.
 */
export const MONDAY = '2026-01-05';
export const WEEKDAY = { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 } as const;

/** Builds an ISO-8601 UTC instant with a Z offset, e.g. isoAt('2026-01-05', 9) → 09:00:00Z. */
export function isoAt(date: string, hour: number, minute = 0): string {
  const hh = String(hour).padStart(2, '0');
  const mm = String(minute).padStart(2, '0');
  return `${date}T${hh}:${mm}:00.000Z`;
}

/** Loose input shape for POST /v1/events (server applies zod defaults). */
export interface CreateEventInput {
  calendarId: string;
  title?: string;
  description?: string | null;
  location?: string | null;
  startsAt: string;
  endsAt: string;
  allDay?: boolean;
  timezone?: string;
  status?: EventStatus;
  visibility?: EventVisibility;
  customerId?: string | null;
  projectId?: string | null;
  taskId?: string | null;
  recurrence?: {
    freq: RecurrenceFreq;
    interval?: number;
    byWeekday?: number[];
    count?: number | null;
    until?: string | null;
  } | null;
  reminders?: Array<{ minutesBefore: number; method?: 'EMAIL' }>;
  attendeeUserIds?: string[];
}

/** Creates a calendar through the API using the actor's active organization. */
export async function createCalendarViaApi(
  ctx: TestContext,
  session: Actor,
  overrides: Partial<CreateCalendarBody> = {},
): Promise<CalendarDto> {
  const response = await api(ctx.app, 'POST', '/v1/calendars', {
    session,
    body: { name: `Calendar ${nextSeq()}`, ...overrides },
  });
  expectStatus(response, 201, 'create calendar');
  return response.json<CalendarDto>();
}

/** Marks a calendar as the org default (there is no default until one is set). */
export async function makeCalendarDefault(
  ctx: TestContext,
  session: Actor,
  calendarId: string,
): Promise<CalendarDto> {
  const response = await api(ctx.app, 'PATCH', `/v1/calendars/${calendarId}`, {
    session,
    body: { isDefault: true },
  });
  expectStatus(response, 200, 'set calendar default');
  return response.json<CalendarDto>();
}

/** Creates a calendar event through the API; title defaults if omitted. */
export async function createEventViaApi(
  ctx: TestContext,
  session: Actor,
  body: CreateEventInput,
): Promise<EventDto> {
  const response = await api(ctx.app, 'POST', '/v1/events', {
    session,
    body: { title: `Event ${nextSeq()}`, ...body },
  });
  expectStatus(response, 201, 'create event');
  return response.json<EventDto>();
}

// --- Phase 7 (email) factories ----------------------------------------------

/** The shared secret the inbound webhook expects (mirrors testConfig). */
export const INBOUND_SECRET = testConfig.INBOUND_EMAIL_SECRET;

/** A unique, lower-case mailbox/sender address. */
export function uniqueAddress(prefix = 'mailbox'): string {
  return `${prefix}-${nextSeq()}@test.local`;
}

/** A unique RFC 5322 Message-ID for synthetic inbound mail. */
export function uniqueRfcMessageId(hint = 'ext'): string {
  return `<${hint}-${nextSeq()}-${Date.now()}@sender.example>`;
}

/** Creates a mailbox through the API (SHARED unless overridden). */
export async function createEmailAccountViaApi(
  ctx: TestContext,
  session: Actor,
  overrides: Partial<CreateEmailAccountBody> = {},
): Promise<EmailAccountDto> {
  const response = await api(ctx.app, 'POST', '/v1/email/accounts', {
    session,
    body: { address: uniqueAddress(), ...overrides },
  });
  expectStatus(response, 201, 'create email account');
  return response.json<EmailAccountDto>();
}

/** Creates an email label through the API. */
export async function createEmailLabelViaApi(
  ctx: TestContext,
  session: Actor,
  overrides: Partial<CreateEmailLabelBody> = {},
): Promise<EmailLabelDto> {
  const response = await api(ctx.app, 'POST', '/v1/email/labels', {
    session,
    body: { name: `Label ${nextSeq()}`, ...overrides },
  });
  expectStatus(response, 201, 'create email label');
  return response.json<EmailLabelDto>();
}

/** Composes a DRAFT (new thread, or a reply when threadId is set). */
export async function composeDraftViaApi(
  ctx: TestContext,
  session: Actor,
  body: Partial<CreateMessageBody> & { accountId: string },
): Promise<EmailMessageDto> {
  const n = nextSeq();
  const response = await api(ctx.app, 'POST', '/v1/email/messages', {
    session,
    body: {
      to: [`recipient-${n}@customer.example`],
      subject: `Subject ${n}`,
      bodyText: `Body ${n}`,
      ...body,
    },
  });
  expectStatus(response, 201, 'compose draft');
  return response.json<EmailMessageDto>();
}

/** Sends a draft; returns the thread detail (the message is now QUEUED). */
export async function sendMessageViaApi(
  ctx: TestContext,
  session: Actor,
  messageId: string,
): Promise<EmailThreadDetailDto> {
  const response = await api(ctx.app, 'POST', `/v1/email/messages/${messageId}/send`, { session });
  expectStatus(response, 200, 'send message');
  return response.json<EmailThreadDetailDto>();
}

/** Loose input for the inbound webhook; subject/text default for brevity. */
export interface InboundEmailInput {
  to: string;
  from: string;
  fromName?: string;
  cc?: string[];
  subject?: string;
  text?: string;
  html?: string;
  messageId?: string;
  inReplyTo?: string;
  references?: string[];
  receivedAt?: string;
}

/**
 * POSTs to the inbound-ingestion webhook. Secret-authed, not session-authed:
 * pass null to omit the x-inbound-secret header or a string to override it.
 * No cookie is sent, so the CSRF origin check does not apply.
 */
export async function postInbound(
  app: FastifyInstance,
  body: InboundEmailInput,
  secret: string | null = INBOUND_SECRET,
): Promise<LightMyRequestResponse> {
  const headers: Record<string, string> = {};
  if (secret !== null) headers['x-inbound-secret'] = secret;
  return app.inject({
    method: 'POST',
    url: '/v1/email/inbound',
    headers,
    remoteAddress: nextIp(),
    payload: { subject: 'Inbound subject', text: 'Inbound body text', ...body },
  });
}

// --- Phase 8 (voice notes / telephony) factories ---------------------------

/**
 * Deterministic pseudo-audio bytes. The API validates by the declared MIME type
 * (not by sniffing the container) and the local stub transcriber hashes the
 * bytes, so any stable buffer is a valid stand-in for a real recording.
 */
export function buildAudio(seed = 'voice'): Buffer {
  return Buffer.from(`RIFF....WEBMmock-audio-${seed}-${'0'.repeat(64)}`);
}

export interface VoiceNoteUpload {
  title?: string;
  durationSeconds?: number;
  occurredAt?: string;
  customerId?: string;
  projectId?: string;
  taskId?: string;
  /** Override the declared MIME type (e.g. to test unsupported_type). */
  contentType?: string;
  filename?: string;
  content?: Buffer;
}

/**
 * Uploads a voice note via app.inject with a hand-built multipart body. The
 * recording route reads the first file part (field name is irrelevant) and its
 * metadata from query params, mirroring the api-client.
 */
export async function uploadVoiceNoteViaApi(
  app: FastifyInstance,
  session: Actor,
  opts: VoiceNoteUpload = {},
): Promise<LightMyRequestResponse> {
  const params = new URLSearchParams();
  params.set('title', opts.title ?? `Voice note ${nextSeq()}`);
  if (opts.durationSeconds !== undefined) params.set('durationSeconds', String(opts.durationSeconds));
  if (opts.occurredAt !== undefined) params.set('occurredAt', opts.occurredAt);
  if (opts.customerId !== undefined) params.set('customerId', opts.customerId);
  if (opts.projectId !== undefined) params.set('projectId', opts.projectId);
  if (opts.taskId !== undefined) params.set('taskId', opts.taskId);
  const { payload, contentType } = buildMultipart({
    filename: opts.filename ?? 'note.webm',
    contentType: opts.contentType ?? 'audio/webm',
    content: opts.content ?? buildAudio(),
  });
  return app.inject({
    method: 'POST',
    url: `/v1/recordings/voice-notes?${params.toString()}`,
    headers: { origin: WEB_ORIGIN, 'content-type': contentType },
    cookies: { [SESSION_COOKIE]: session.cookie },
    remoteAddress: nextIp(),
    payload,
  });
}

/** Uploads a voice note and asserts 201; returns the created recording. */
export async function createVoiceNoteViaApi(
  app: FastifyInstance,
  session: Actor,
  opts: VoiceNoteUpload = {},
): Promise<RecordingDto> {
  const response = await uploadVoiceNoteViaApi(app, session, opts);
  expectStatus(response, 201, 'upload voice note');
  return response.json<RecordingDto>();
}

/** Creates a call log (no audio) through the API; INBOUND unless overridden. */
export async function createCallLogViaApi(
  ctx: TestContext,
  session: Actor,
  overrides: Partial<{
    title: string;
    direction: 'INBOUND' | 'OUTBOUND';
    fromNumber: string;
    toNumber: string;
    durationSeconds: number;
    occurredAt: string;
    notes: string;
    customerId: string;
    projectId: string;
    taskId: string;
  }> = {},
): Promise<RecordingDto> {
  const response = await api(ctx.app, 'POST', '/v1/recordings/call-logs', {
    session,
    body: { title: `Call ${nextSeq()}`, direction: 'INBOUND', ...overrides },
  });
  expectStatus(response, 201, 'create call log');
  return response.json<RecordingDto>();
}
