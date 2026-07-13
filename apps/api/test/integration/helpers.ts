import { createPrismaClient, type PrismaClient } from '@businessos/db';
import type { AssignableRole, InvitationDto, OrganizationDto, SessionDto } from '@businessos/types';
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
